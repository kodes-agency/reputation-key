// BQC-3.5 — atomic identity command store contract tests.
//
// Every command must commit its state mutation (better-auth-owned
// invitation/member/organization rows — the app-owned write path) and its
// outbox_events row in ONE transaction, then emit on the in-process bus
// AFTER commit:
//   ['tx.start', 'tx.read'*, 'tx.state'+, 'tx.outbox', 'tx.commit', 'emit']
// Guarded mutations (already-member/already-invited, last-owner, missing
// rows, invitation lifecycle) roll back and record NO fact, emit nothing.
// A post-commit bus failure must not propagate (durable row already retained).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAtomicIdentityCommandStore } from './identity-command-store'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import {
  identityInvitationAccepted,
  identityInvitationCanceled,
  identityMemberInvited,
  identityMemberRemoved,
  identityMemberRoleChanged,
  identityOrganizationCreated,
  type IdentityInvitationAccepted,
} from '../domain/events'
import { isIdentityError } from '../domain/errors'
import type { AcceptedInvitation } from '../application/ports/identity-command-store.port'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  }),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

const NOW = new Date('2026-06-01T12:00:00.000Z')
const EXPIRES = new Date('2026-06-08T12:00:00.000Z')
const ORG_ID = organizationId('org-identity-cmd-000000000001')
const INVITER = userId('user-inviter-0000000000000001')
const INV_ID = invitationId('inv-identity-cmd-00000000001')

type MockTx = {
  execute: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

/** Flatten a drizzle SQL template into text + params (StringChunk vs raw params). */
function sqlChunks(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? []
  let text = ''
  const params: unknown[] = []
  for (const chunk of chunks) {
    if (chunk !== null && typeof chunk === 'object' && 'value' in chunk) {
      // StringChunk — literal SQL text
      text += ((chunk as { value: string[] }).value ?? []).join('')
    } else {
      // Raw interpolated param (string/number/Date/...)
      params.push(chunk)
      text += '?'
    }
  }
  return { text, params }
}

/**
 * Mocked drizzle transaction recording the crash-boundary ordering.
 * `selectQueue` — rows returned per SELECT call, in call order ([] default).
 * `updateReturning` — rows returned by UPDATE ... RETURNING ([] = no match).
 * `outboxRows` — captures every row sent to outbox_events.
 * `updateSets` — captures every UPDATE .set() payload (in call order).
 * `insertedRows` — captures every non-outbox INSERT .values() payload.
 * `executedRows` — captures every non-lock tx.execute() (raw SQL writes) as
 *   flattened text + params.
 */
function createMockDb(opts: {
  order: string[]
  selectQueue?: unknown[][]
  updateReturning?: unknown[]
  outboxRows?: Array<Record<string, unknown>>
  updateSets?: Array<Record<string, unknown>>
  insertedRows?: Array<Record<string, unknown>>
  executedRows?: Array<{ text: string; params: unknown[] }>
}) {
  const { order } = opts
  const tx: MockTx = {
    execute: vi.fn(async (query: unknown) => {
      const flat = sqlChunks(query)
      if (flat.text.includes('pg_advisory')) {
        order.push('tx.lock')
        return
      }
      order.push('tx.state')
      opts.executedRows?.push(flat)
    }),
    select: vi.fn(() => {
      order.push('tx.read')
      const rows = opts.selectQueue?.shift() ?? []
      const whereResult = Object.assign(Promise.resolve(rows), {
        for: vi.fn(async () => rows),
        limit: vi.fn(async () => rows),
      })
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => whereResult),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
          })),
        })),
      }
    }),
    insert: vi.fn((table: unknown) => {
      if (table === outboxEvents) {
        order.push('tx.outbox')
        return {
          values: vi.fn(async (row: Record<string, unknown>) => {
            opts.outboxRows?.push(row)
          }),
        }
      }
      order.push('tx.state')
      return {
        values: vi.fn(async (row: Record<string, unknown>) => {
          opts.insertedRows?.push(row)
        }),
      }
    }),
    update: vi.fn(() => {
      order.push('tx.state')
      return {
        set: vi.fn((values: Record<string, unknown>) => {
          opts.updateSets?.push(values)
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => opts.updateReturning ?? []),
            })),
          }
        }),
      }
    }),
    delete: vi.fn(() => {
      order.push('tx.state')
      return { where: vi.fn(async () => undefined) }
    }),
  }
  const db = {
    transaction: vi.fn(async (fn: (txArg: MockTx) => Promise<unknown>) => {
      order.push('tx.start')
      try {
        const result = await fn(tx)
        order.push('tx.commit')
        return result
      } catch (err) {
        order.push('tx.rollback')
        throw err
      }
    }),
  }
  return { db: db as unknown as Database, tx }
}

function makeEvents(order: string[], fail = false): EventBus {
  return {
    on: vi.fn(),
    emit: vi.fn(async () => {
      if (fail) throw new Error('bus down')
      order.push('emit')
    }),
    clear: vi.fn(),
  }
}

const invitedEvent = () =>
  identityMemberInvited({
    organizationId: ORG_ID,
    email: 'invitee@test.com',
    role: 'Staff',
    userId: INVITER,
    invitationId: INV_ID,
    occurredAt: NOW,
  })

const pendingInvitationRow = (overrides: Record<string, unknown> = {}) => ({
  id: INV_ID as string,
  organizationId: ORG_ID as string,
  email: 'invitee@test.com',
  role: 'member',
  status: 'pending',
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  propertyIds: JSON.stringify(['prop-a', 'prop-b']),
  inviterId: INVITER as string,
  teamId: null,
  createdAt: NOW,
  ...overrides,
})

describe('createAtomicIdentityCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('inviteMember', () => {
    const command = () => ({
      invitationId: INV_ID,
      organizationId: ORG_ID,
      email: 'Invitee@Test.com',
      role: 'member',
      inviterId: INVITER,
      propertyIds: ['prop-a', 'prop-b'],
      now: NOW,
      expiresAt: EXPIRES,
      event: invitedEvent(),
    })

    it('commits invitation insert + invited fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const executedRows: Array<{ text: string; params: unknown[] }> = []
      const { db } = createMockDb({
        order,
        selectQueue: [[], []],
        outboxRows,
        executedRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)
      const cmd = command()

      await store.inviteMember(cmd)

      expect(order).toEqual([
        'tx.start',
        'tx.read',
        'tx.read',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
      expect(executedRows).toHaveLength(1)
      expect(executedRows[0]!.text).toContain('INSERT INTO invitation')
      expect(executedRows[0]!.params).toEqual([
        INV_ID as string,
        ORG_ID as string,
        'invitee@test.com',
        'member',
        EXPIRES,
        JSON.stringify(['prop-a', 'prop-b']),
        INVITER as string,
        NOW,
      ])
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('identity.member.invited')
      expect(outboxRows[0]!.id).toBe(cmd.event.eventId)
    })

    it('throws already_exists and records nothing when the invitee is a member', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectQueue: [[{ id: 'member-existing' }]],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await expect(store.inviteMember(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'already_exists',
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.read', 'tx.rollback'])
    })

    it('throws already_exists when a pending invitation exists for the email', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectQueue: [[], [{ id: 'inv-pending' }]],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await expect(store.inviteMember(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'already_exists',
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.read', 'tx.read', 'tx.rollback'])
    })
  })

  describe('acceptInvitation', () => {
    const command = (
      buildEvent?: (accepted: AcceptedInvitation) => IdentityInvitationAccepted,
    ) => ({
      invitationId: INV_ID,
      acceptorEmail: 'Invitee@Test.com',
      acceptorUserId: userId('user-acceptor-00000000000001'),
      now: NOW,
      buildEvent:
        buildEvent ??
        ((accepted: AcceptedInvitation) =>
          identityInvitationAccepted({
            organizationId: accepted.organizationId,
            userId: userId('user-acceptor-00000000000001'),
            invitationId: INV_ID,
            propertyIds: accepted.propertyIds,
            occurredAt: NOW,
          })),
    })

    it('commits member insert + accepted update + fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const insertedRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectQueue: [[pendingInvitationRow()]],
        outboxRows,
        insertedRows,
        updateSets,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      const result = await store.acceptInvitation(command())

      expect(result).toEqual({
        organizationId: ORG_ID,
        propertyIds: ['prop-a', 'prop-b'],
      })
      expect(insertedRows).toHaveLength(1)
      expect(insertedRows[0]).toMatchObject({
        organizationId: ORG_ID as string,
        userId: 'user-acceptor-00000000000001',
        role: 'member',
      })
      expect(updateSets).toEqual([{ status: 'accepted' }])
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('identity.invitation.accepted')
      expect(order).toEqual([
        'tx.start',
        'tx.read',
        'tx.state',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
    })

    it('rejects when the acceptor email does not match — no fact, no emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectQueue: [[pendingInvitationRow({ email: 'other@test.com' })]],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await expect(store.acceptInvitation(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'forbidden',
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.read', 'tx.rollback'])
    })

    it('rejects an expired invitation — no fact', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        selectQueue: [
          [pendingInvitationRow({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })],
        ],
      })
      const store = createAtomicIdentityCommandStore(db, makeEvents(order))

      await expect(store.acceptInvitation(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
      )
      expect(order).toEqual(['tx.start', 'tx.read', 'tx.rollback'])
    })

    it('rejects a non-pending invitation — no fact', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        selectQueue: [[pendingInvitationRow({ status: 'accepted' })]],
      })
      const store = createAtomicIdentityCommandStore(db, makeEvents(order))

      await expect(store.acceptInvitation(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
      )
      expect(order).toEqual(['tx.start', 'tx.read', 'tx.rollback'])
    })

    it('marks the invitation rejected when the custom role vanished — no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        // invitation row (custom role), then role-definition lookup, then policy lookup
        selectQueue: [[pendingInvitationRow({ role: 'content-manager' })], [], []],
        outboxRows,
        updateSets,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await expect(store.acceptInvitation(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'forbidden',
      )
      expect(updateSets).toEqual([{ status: 'rejected' }])
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual([
        'tx.start',
        'tx.read',
        'tx.read',
        'tx.read',
        'tx.state',
        'tx.rollback',
      ])
    })
  })

  describe('cancelInvitation', () => {
    const command = () => ({
      invitationId: INV_ID,
      organizationId: ORG_ID,
      event: identityInvitationCanceled({
        organizationId: ORG_ID,
        invitationId: INV_ID,
        occurredAt: NOW,
      }),
    })

    it('commits status update + canceled fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateReturning: [{ id: INV_ID as string }],
        outboxRows,
        updateSets,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await store.cancelInvitation(command())

      expect(updateSets).toEqual([{ status: 'canceled' }])
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('identity.invitation.canceled')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('throws invitation_not_found and records nothing when no row matches', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateReturning: [], outboxRows })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await expect(store.cancelInvitation(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.rollback'])
    })
  })

  describe('removeMember', () => {
    const command = () => ({
      organizationId: ORG_ID,
      memberId: 'member-target',
      event: identityMemberRemoved({
        organizationId: ORG_ID,
        userId: userId('user-target-00000000000000001'),
        removedBy: INVITER,
        occurredAt: NOW,
      }),
    })

    it('takes the org lock, deletes the member + removed fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectQueue: [
          [{ id: 'member-target', organizationId: ORG_ID as string, role: 'member' }],
        ],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await store.removeMember(command())

      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('identity.member.removed')
      expect(order).toEqual([
        'tx.start',
        'tx.lock',
        'tx.read',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
    })

    it('throws last_owner when removing the final owner — no delete, no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectQueue: [
          [{ id: 'member-solo', organizationId: ORG_ID as string, role: 'owner' }],
          [{ role: 'owner' }],
        ],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await expect(store.removeMember(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'last_owner',
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.lock', 'tx.read', 'tx.read', 'tx.rollback'])
    })

    it('throws member_not_found when the row is gone — no fact', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, selectQueue: [[]] })
      const store = createAtomicIdentityCommandStore(db, makeEvents(order))

      await expect(store.removeMember(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'member_not_found',
      )
      expect(order).toEqual(['tx.start', 'tx.lock', 'tx.read', 'tx.rollback'])
    })
  })

  describe('changeMemberRole', () => {
    const command = () => ({
      organizationId: ORG_ID,
      memberId: 'member-target',
      newRole: 'admin',
      event: identityMemberRoleChanged({
        organizationId: ORG_ID,
        memberUserId: userId('user-target-00000000000000001'),
        previousRole: 'Staff',
        newRole: 'PropertyManager',
        userId: INVITER,
        occurredAt: NOW,
      }),
    })

    it('commits role update + role_changed fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectQueue: [
          [{ id: 'member-target', organizationId: ORG_ID as string, role: 'member' }],
        ],
        outboxRows,
        updateSets,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await store.changeMemberRole(command())

      expect(updateSets).toEqual([{ role: 'admin' }])
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('identity.member.role_changed')
      expect(order).toEqual([
        'tx.start',
        'tx.lock',
        'tx.read',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
    })

    it('throws last_owner when demoting the final owner — no update, no fact', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        selectQueue: [
          [{ id: 'member-solo', organizationId: ORG_ID as string, role: 'owner' }],
          [{ role: 'owner' }],
        ],
      })
      const store = createAtomicIdentityCommandStore(db, makeEvents(order))

      await expect(store.changeMemberRole(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'last_owner',
      )
      expect(order).toEqual(['tx.start', 'tx.lock', 'tx.read', 'tx.read', 'tx.rollback'])
    })
  })

  describe('registerOrganization', () => {
    const command = () => ({
      organizationId: organizationId('org-new-00000000-0000-0000-000000000001'),
      organizationName: 'Test Org',
      slug: 'test-org',
      ownerId: userId('user-owner-000000000000000001'),
      now: NOW,
      event: identityOrganizationCreated({
        organizationId: organizationId('org-new-00000000-0000-0000-000000000001'),
        organizationName: 'Test Org',
        slug: 'test-org',
        ownerId: userId('user-owner-000000000000000001'),
        occurredAt: NOW,
      }),
    })

    it('commits organization + owner member + created fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const insertedRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, selectQueue: [[]], outboxRows, insertedRows })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await store.registerOrganization(command())

      expect(insertedRows).toHaveLength(2)
      expect(insertedRows[0]).toMatchObject({
        id: 'org-new-00000000-0000-0000-000000000001',
        name: 'Test Org',
        slug: 'test-org',
      })
      expect(insertedRows[1]).toMatchObject({
        organizationId: 'org-new-00000000-0000-0000-000000000001',
        userId: 'user-owner-000000000000000001',
        role: 'owner',
      })
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('identity.organization.created')
      expect(order).toEqual([
        'tx.start',
        'tx.read',
        'tx.state',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
    })

    it('throws already_exists on a slug conflict — nothing persisted', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectQueue: [[{ id: 'org-existing' }]],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIdentityCommandStore(db, events)

      await expect(store.registerOrganization(command())).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'already_exists',
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.read', 'tx.rollback'])
    })
  })

  describe('emit failure isolation', () => {
    it('a post-commit bus failure does not propagate (durable row retained)', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateReturning: [{ id: INV_ID as string }],
        outboxRows,
      })
      const events = makeEvents(order, true)
      const store = createAtomicIdentityCommandStore(db, events)

      await store.cancelInvitation({
        invitationId: INV_ID,
        organizationId: ORG_ID,
        event: identityInvitationCanceled({
          organizationId: ORG_ID,
          invitationId: INV_ID,
          occurredAt: NOW,
        }),
      })

      expect(outboxRows).toHaveLength(1)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
    })
  })

  describe('identifier-only payload enforcement (schema allowlist, BQC-3.5 fixes)', () => {
    it('each migrated identity event passes schema validation with its real producer payload', () => {
      const cases: ReadonlyArray<{ tag: string; make: () => DomainEvent }> = [
        { tag: 'identity.member.invited', make: invitedEvent },
        {
          tag: 'identity.invitation.accepted',
          make: () =>
            identityInvitationAccepted({
              organizationId: ORG_ID,
              userId: INVITER,
              invitationId: INV_ID,
              propertyIds: ['prop-a'],
              occurredAt: NOW,
            }),
        },
        {
          tag: 'identity.invitation.canceled',
          make: () =>
            identityInvitationCanceled({
              organizationId: ORG_ID,
              invitationId: INV_ID,
              occurredAt: NOW,
            }),
        },
        {
          tag: 'identity.member.removed',
          make: () =>
            identityMemberRemoved({
              organizationId: ORG_ID,
              userId: userId('user-target-00000000000000001'),
              removedBy: INVITER,
              occurredAt: NOW,
            }),
        },
        {
          tag: 'identity.member.role_changed',
          make: () =>
            identityMemberRoleChanged({
              organizationId: ORG_ID,
              memberUserId: userId('user-target-00000000000000001'),
              previousRole: 'Staff',
              newRole: 'PropertyManager',
              userId: INVITER,
              occurredAt: NOW,
            }),
        },
        {
          tag: 'identity.organization.created',
          make: () =>
            identityOrganizationCreated({
              organizationId: ORG_ID,
              organizationName: 'Test Org',
              slug: 'test-org',
              ownerId: INVITER,
              occurredAt: NOW,
            }),
        },
      ]

      for (const { tag, make } of cases) {
        const row = toOutboxEvent(make())
        expect(row.eventType, tag).toBe(tag)
        expect(() => validateEventPayload(tag, 1, row.payload), tag).not.toThrow()
      }
    })

    it('member.role_changed keeps BOTH the target (memberUserId) and the actor (userId)', () => {
      // BQC-3.5 schema fix: the activity consumer reads event.memberUserId as
      // the audit resourceId — the v1 schema dropped it (denylist strip).
      const row = toOutboxEvent(
        identityMemberRoleChanged({
          organizationId: ORG_ID,
          memberUserId: userId('user-target-00000000000000001'),
          previousRole: 'Staff',
          newRole: 'PropertyManager',
          userId: INVITER,
          occurredAt: NOW,
        }),
      )
      const payload = row.payload as Record<string, unknown>
      expect(payload.memberUserId).toBe('user-target-00000000000000001')
      expect(payload.userId).toBe(INVITER as string)
      expect(payload.previousRole).toBe('Staff')
      expect(payload.newRole).toBe('PropertyManager')
    })
  })
})
