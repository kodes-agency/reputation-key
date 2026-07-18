// BQC-3.5 — atomic staff command store contract tests.
//
// Every command must commit its staff_assignments mutation and its
// outbox_events row in ONE transaction, then emit on the in-process bus
// AFTER commit:
//   ['tx.start', 'tx.read'?, 'tx.state'+, 'tx.outbox'+, 'tx.commit', 'emit'+]
// A duplicate-assignment guard or a missing soft-delete target rolls back —
// no fact, no emit. A post-commit bus failure must not propagate.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAtomicStaffCommandStore } from './staff-command-store'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import {
  organizationId,
  propertyId,
  staffAssignmentId,
  teamId,
  portalId,
  userId,
} from '#/shared/domain/ids'
import type { StaffAssignment } from '../domain/types'
import { staffAssigned, staffUnassigned } from '../domain/events'
import { isStaffError } from '../domain/errors'

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
const ORG_ID = organizationId('org-staff-cmd-0000000000000001')
const PROP_ID = propertyId('a0000000-0000-0000-0000-0000000000a1')
const USER_ID = userId('user-staff-cmd-000000000000000001')
const ASSIGNMENT_ID = staffAssignmentId('c0000000-0000-0000-0000-0000000000c1')
const PORTAL_ID = portalId('b0000000-0000-0000-0000-0000000000b1')
const TEAM_ID = teamId('d0000000-0000-0000-0000-0000000000d1')

function makeAssignment(overrides: Partial<StaffAssignment> = {}): StaffAssignment {
  return {
    id: ASSIGNMENT_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    propertyId: PROP_ID,
    teamId: null,
    portalId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

const assignedEvent = (assignment: StaffAssignment = makeAssignment()) =>
  staffAssigned({
    assignmentId: assignment.id,
    organizationId: assignment.organizationId,
    userId: assignment.userId,
    propertyId: assignment.propertyId,
    teamId: assignment.teamId,
    portalId: assignment.portalId,
    occurredAt: assignment.createdAt,
  })

const unassignedEvent = (assignment: StaffAssignment = makeAssignment()) =>
  staffUnassigned({
    assignmentId: assignment.id,
    organizationId: assignment.organizationId,
    userId: assignment.userId,
    propertyId: assignment.propertyId,
    portalId: assignment.portalId,
    occurredAt: NOW,
  })

type MockTx = {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

/**
 * Mocked drizzle transaction recording the crash-boundary ordering.
 * `selectRows` — rows returned by the duplicate guard SELECT.
 * `updateReturning` — rows returned by UPDATE ... RETURNING ([] = no live row).
 * `outboxRows` / `insertedRows` / `updateSets` — captured writes.
 */
function createMockDb(opts: {
  order: string[]
  selectRows?: unknown[]
  updateReturning?: unknown[]
  outboxRows?: Array<Record<string, unknown>>
  insertedRows?: Array<Record<string, unknown>>
  updateSets?: Array<Record<string, unknown>>
}) {
  const { order } = opts
  const tx: MockTx = {
    select: vi.fn(() => {
      order.push('tx.read')
      const rows = opts.selectRows ?? []
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows),
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

describe('createAtomicStaffCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('assignStaff', () => {
    it('commits insert + assigned fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const insertedRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, selectRows: [], outboxRows, insertedRows })
      const events = makeEvents(order)
      const store = createAtomicStaffCommandStore(db, events)
      const assignment = makeAssignment()
      const event = assignedEvent(assignment)

      const result = await store.assignStaff({ assignment, event })

      expect(result).toBe(assignment)
      expect(insertedRows).toHaveLength(1)
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('staff.assigned')
      expect(outboxRows[0]!.id).toBe(event.eventId)
      expect(order).toEqual([
        'tx.start',
        'tx.read',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
    })

    it('throws already_assigned and records nothing on a duplicate', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectRows: [{ id: 'existing-assignment' }],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicStaffCommandStore(db, events)

      await expect(
        store.assignStaff({ assignment: makeAssignment(), event: assignedEvent() }),
      ).rejects.toSatisfy(
        (e: unknown) => isStaffError(e) && e.code === 'already_assigned',
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.read', 'tx.rollback'])
    })
  })

  describe('unassignStaff', () => {
    it('commits soft-delete + unassigned fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateReturning: [{ id: ASSIGNMENT_ID as string }],
        outboxRows,
        updateSets,
      })
      const events = makeEvents(order)
      const store = createAtomicStaffCommandStore(db, events)
      const event = unassignedEvent()

      await store.unassignStaff({
        assignmentId: ASSIGNMENT_ID,
        organizationId: ORG_ID,
        event,
      })

      expect(updateSets).toHaveLength(1)
      expect(updateSets[0]!.deletedAt).toBeInstanceOf(Date)
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('staff.unassigned')
      expect(outboxRows[0]!.id).toBe(event.eventId)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('throws assignment_not_found and records nothing when the live row is gone', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateReturning: [], outboxRows })
      const events = makeEvents(order)
      const store = createAtomicStaffCommandStore(db, events)

      await expect(
        store.unassignStaff({
          assignmentId: ASSIGNMENT_ID,
          organizationId: ORG_ID,
          event: unassignedEvent(),
        }),
      ).rejects.toSatisfy(
        (e: unknown) => isStaffError(e) && e.code === 'assignment_not_found',
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.rollback'])
    })
  })

  describe('updatePortals', () => {
    it('commits ALL creates + removals + facts in ONE tx, then emits in loop order', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const created = makeAssignment({
        id: staffAssignmentId('c0000000-0000-0000-0000-0000000000c2'),
        portalId: PORTAL_ID,
      })
      const created2 = makeAssignment({
        id: staffAssignmentId('c0000000-0000-0000-0000-0000000000c3'),
        portalId: portalId('b0000000-0000-0000-0000-0000000000b2'),
        teamId: TEAM_ID,
      })
      const removed = makeAssignment({ portalId: PORTAL_ID })
      const { db } = createMockDb({
        order,
        updateReturning: [{ id: ASSIGNMENT_ID as string }],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicStaffCommandStore(db, events)

      await store.updatePortals({
        creates: [
          { assignment: created, event: assignedEvent(created) },
          { assignment: created2, event: assignedEvent(created2) },
        ],
        removals: [
          {
            assignmentId: removed.id,
            organizationId: ORG_ID,
            event: unassignedEvent(removed),
          },
        ],
      })

      expect(outboxRows).toHaveLength(3)
      expect(outboxRows.map((r) => r.eventType)).toEqual([
        'staff.assigned',
        'staff.assigned',
        'staff.unassigned',
      ])
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.outbox',
        'tx.state',
        'tx.outbox',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
        'emit',
        'emit',
      ])
    })

    it('a removal targeting a vanished row still commits the creates (pre-diff contract)', async () => {
      // The use case pre-diffs against rows it read; a concurrent delete can
      // still slip a removal through. The update no-ops (no RETURNING) — the
      // creates and their facts must still land in the same commit.
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const created = makeAssignment({ portalId: PORTAL_ID })
      const { db } = createMockDb({ order, updateReturning: [], outboxRows })
      const events = makeEvents(order)
      const store = createAtomicStaffCommandStore(db, events)

      await store.updatePortals({
        creates: [{ assignment: created, event: assignedEvent(created) }],
        removals: [
          {
            assignmentId: ASSIGNMENT_ID,
            organizationId: ORG_ID,
            event: unassignedEvent(),
          },
        ],
      })

      expect(outboxRows).toHaveLength(2)
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.outbox',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
        'emit',
      ])
    })
  })

  describe('emit failure isolation', () => {
    it('a post-commit bus failure does not propagate (durable row retained)', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, selectRows: [], outboxRows })
      const events = makeEvents(order, true)
      const store = createAtomicStaffCommandStore(db, events)

      const result = await store.assignStaff({
        assignment: makeAssignment(),
        event: assignedEvent(),
      })

      expect(result.id).toBe(ASSIGNMENT_ID)
      expect(outboxRows).toHaveLength(1)
      expect(order).toEqual(['tx.start', 'tx.read', 'tx.state', 'tx.outbox', 'tx.commit'])
    })
  })

  describe('identifier-only payload enforcement (schema allowlist, BQC-3.5 fixes)', () => {
    it('staff.assigned / staff.unassigned pass schema validation with real producer payloads', () => {
      const cases: ReadonlyArray<{ tag: string; make: () => DomainEvent }> = [
        { tag: 'staff.assigned', make: () => assignedEvent() },
        {
          tag: 'staff.assigned',
          make: () =>
            assignedEvent(makeAssignment({ teamId: TEAM_ID, portalId: PORTAL_ID })),
        },
        { tag: 'staff.unassigned', make: () => unassignedEvent() },
      ]

      for (const { tag, make } of cases) {
        const row = toOutboxEvent(make())
        expect(row.eventType, tag).toBe(tag)
        expect(() => validateEventPayload(tag, 1, row.payload), tag).not.toThrow()
      }
    })

    it('the recorded payload carries the fields the activity consumer reads', () => {
      const row = toOutboxEvent(assignedEvent())
      const payload = row.payload as Record<string, unknown>
      expect(payload.assignmentId).toBe(ASSIGNMENT_ID as string)
      expect(payload.userId).toBe(USER_ID as string)
      expect(payload.propertyId).toBe(PROP_ID as string)
      expect(payload.organizationId).toBe(ORG_ID as string)
      expect(payload).not.toHaveProperty('staffId')
    })
  })
})
