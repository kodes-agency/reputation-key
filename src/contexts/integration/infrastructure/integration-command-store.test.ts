// BQC-3.5 — atomic integration command store contract tests.
//
// Every command must commit its google_connections mutation and outbox_events
// fact in one transaction:
//   ['tx.start', 'tx.state'+, 'tx.outbox', 'tx.commit']
// A missing connection rolls back state and fact together.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAtomicIntegrationCommandStore as createProductionIntegrationCommandStore } from './integration-command-store'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleConnectionVisibilityChanged,
} from '../domain/events'
import { isIntegrationError } from '../domain/errors'
import { isUniqueViolationError } from '../application/ports/google-connection.repository'

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
const MUTATION_NOW = new Date('2026-06-01T12:34:56.789Z')

const createAtomicIntegrationCommandStore = (
  db: Database,
  clock: () => Date = () => MUTATION_NOW,
) => createProductionIntegrationCommandStore(db, clock)
const ORG_ID = organizationId('org-integration-cmd-00000000001')
const CONN_ID = googleConnectionId('6d000000-0000-0000-0000-000000000001')

function makeConnection(overrides: Partial<GoogleConnection> = {}): GoogleConnection {
  return {
    id: CONN_ID,
    organizationId: ORG_ID,
    googleSubject: 'subject-123',
    encryptedAccessToken: 'enc-a',
    encryptedRefreshToken: 'enc-r',
    tokenExpiresAt: new Date('2026-06-01T13:00:00.000Z'),
    scopes: ['scope-a'],
    connectedBy: userId('user-connector-000000000000001'),
    visibility: 'private',
    status: 'active',
    credentialUseState: 'active',
    cleanupMaterialDeadlineAt: null,
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    credentialAuthorizedBy:
      overrides.credentialAuthorizedBy ?? userId('user-connector-000000000000001'),
  }
}

function makeConnectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_ID as string,
    organizationId: ORG_ID as string,
    googleSubject: 'subject-123',
    encryptedAccessToken: 'enc-a',
    encryptedRefreshToken: 'enc-r',
    tokenExpiresAt: new Date('2026-06-01T13:00:00.000Z'),
    scopes: ['scope-a'],
    connectedBy: 'user-connector-000000000000001',
    credentialAuthorizedBy: 'user-connector-000000000000001',
    credentialAuthorizedAt: NOW,
    visibility: 'private',
    status: 'active',
    credentialUseState: 'active',
    cleanupMaterialDeadlineAt: null,
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

type MockTx = {
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

function createMockDb(opts: {
  order: string[]
  updateReturning?: unknown[]
  updateReturningQueue?: unknown[][]
  insertError?: unknown
  outboxRows?: Array<Record<string, unknown>>
  insertedRows?: Array<Record<string, unknown>>
  updateSets?: Array<Record<string, unknown>>
}) {
  const { order } = opts
  const tx: MockTx = {
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
          if (opts.insertError) throw opts.insertError
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
              returning: vi.fn(async () =>
                opts.updateReturningQueue
                  ? (opts.updateReturningQueue.shift() ?? [])
                  : (opts.updateReturning ?? []),
              ),
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

const connectedEvent = () =>
  integrationGoogleAccountConnected({
    connectionId: CONN_ID,
    organizationId: ORG_ID,
    userId: userId('user-connector-000000000000001'),
    occurredAt: NOW,
  })

describe('createAtomicIntegrationCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('connectGoogleAccount', () => {
    it('commits insert + connected fact in one transaction', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const insertedRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows, insertedRows })
      const store = createAtomicIntegrationCommandStore(db)
      const event = connectedEvent()

      await store.connectGoogleAccount({
        connection: makeConnection(),
        event,
      })

      expect(insertedRows).toHaveLength(1)
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('integration.google_account.connected')
      expect(outboxRows[0]!.id).toBe(event.eventId)
      expect(Object.keys(outboxRows[0]!.payload as object).sort()).toEqual([
        'connectionId',
        'correlationId',
        'organizationId',
        'userId',
      ])
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
    })

    it('maps a unique violation to UniqueViolationError and records no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        insertError: Object.assign(new Error('duplicate key'), { code: '23505' }),
        outboxRows,
      })
      const store = createAtomicIntegrationCommandStore(db)

      await expect(
        store.connectGoogleAccount({
          connection: makeConnection(),
          event: connectedEvent(),
        }),
      ).rejects.toSatisfy((e: unknown) => isUniqueViolationError(e))
      expect(outboxRows).toHaveLength(0)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.rollback'])
    })
  })

  describe('reconnectGoogleAccount', () => {
    it('commits reconnection update + connected fact in one transaction', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateReturning: [makeConnectionRow()],
        outboxRows,
        updateSets,
      })
      const store = createAtomicIntegrationCommandStore(db)

      const result = await store.reconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        googleSubject: 'google-subject-2',
        scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
        encryptedAccessToken: 'enc-a2',
        encryptedRefreshToken: 'enc-r2',
        tokenExpiresAt: new Date('2026-06-01T14:00:00.000Z'),
        visibility: 'organization',
        event: connectedEvent(),
      })

      expect(result.id).toBe(CONN_ID)
      expect(updateSets[0]).toMatchObject({
        status: 'active',
        visibility: 'organization',
        googleSubject: 'google-subject-2',
        scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
        updatedAt: MUTATION_NOW,
      })
      expect(outboxRows).toHaveLength(1)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
    })

    it('throws connection_not_found when the row vanished — no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateReturning: [], outboxRows })
      const store = createAtomicIntegrationCommandStore(db)

      await expect(
        store.reconnectGoogleAccount({
          organizationId: ORG_ID,
          connectionId: CONN_ID,
          googleSubject: 'google-subject-2',
          scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
          encryptedAccessToken: 'enc-a2',
          encryptedRefreshToken: 'enc-r2',
          tokenExpiresAt: NOW,
          visibility: 'private',
          event: connectedEvent(),
        }),
      ).rejects.toSatisfy(
        (e: unknown) => isIntegrationError(e) && e.code === 'connection_not_found',
      )
      expect(outboxRows).toHaveLength(0)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.rollback'])
    })
  })

  describe('disconnectGoogleAccount', () => {
    it('commits status + redaction + disconnected fact in one transaction', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateReturningQueue: [
          [{ id: CONN_ID as string }],
          [
            makeConnectionRow({
              status: 'disconnected',
              encryptedAccessToken: 'redacted',
              googleSubject: null,
            }),
          ],
        ],
        outboxRows,
        updateSets,
      })
      const clock = vi
        .fn<() => Date>()
        .mockReturnValueOnce(MUTATION_NOW)
        .mockReturnValueOnce(new Date('2099-01-01T00:00:00.000Z'))
      const store = createAtomicIntegrationCommandStore(db, clock)
      const event = integrationGoogleAccountDisconnected({
        connectionId: CONN_ID,
        organizationId: ORG_ID,
        occurredAt: NOW,
      })

      const result = await store.disconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        event,
      })

      expect(updateSets[0]).toMatchObject({
        status: 'disconnected',
        updatedAt: MUTATION_NOW,
      })
      expect(updateSets[1]).toMatchObject({
        encryptedAccessToken: 'redacted',
        encryptedRefreshToken: 'redacted',
        googleSubject: null,
        scopes: [],
        updatedAt: MUTATION_NOW,
      })
      expect(clock).toHaveBeenCalledTimes(1)
      expect(result.status).toBe('disconnected')
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.id).toBe(event.eventId)
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.state',
        'tx.outbox',
        'tx.commit',
      ])
    })

    it('throws connection_not_found when the row vanished — no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateReturningQueue: [[]], outboxRows })
      const store = createAtomicIntegrationCommandStore(db)

      await expect(
        store.disconnectGoogleAccount({
          organizationId: ORG_ID,
          connectionId: CONN_ID,
          event: integrationGoogleAccountDisconnected({
            connectionId: CONN_ID,
            organizationId: ORG_ID,
            occurredAt: NOW,
          }),
        }),
      ).rejects.toSatisfy(
        (e: unknown) => isIntegrationError(e) && e.code === 'connection_not_found',
      )
      expect(outboxRows).toHaveLength(0)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.rollback'])
    })
  })

  describe('updateConnectionVisibility', () => {
    it('commits visibility update + fact in one transaction', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateReturning: [makeConnectionRow({ visibility: 'organization' })],
        outboxRows,
        updateSets,
      })
      const store = createAtomicIntegrationCommandStore(db)

      const result = await store.updateConnectionVisibility({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        visibility: 'organization',
        event: integrationGoogleConnectionVisibilityChanged({
          connectionId: CONN_ID,
          organizationId: ORG_ID,
          visibility: 'organization',
          occurredAt: NOW,
        }),
      })

      expect(result.visibility).toBe('organization')
      expect(updateSets[0]).toMatchObject({ updatedAt: MUTATION_NOW })
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe(
        'integration.google_connection.visibility_changed',
      )
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
    })
  })

  describe('identifier-only payload enforcement (schema allowlist, BQC-3.5 registrations)', () => {
    it('each migrated integration event passes schema validation with its real producer payload', () => {
      const cases: ReadonlyArray<{ tag: string; make: () => DomainEvent }> = [
        { tag: 'integration.google_account.connected', make: connectedEvent },
        {
          tag: 'integration.google_account.disconnected',
          make: () =>
            integrationGoogleAccountDisconnected({
              connectionId: CONN_ID,
              organizationId: ORG_ID,
              occurredAt: NOW,
            }),
        },
        {
          tag: 'integration.google_connection.visibility_changed',
          make: () =>
            integrationGoogleConnectionVisibilityChanged({
              connectionId: CONN_ID,
              organizationId: ORG_ID,
              visibility: 'organization',
              occurredAt: NOW,
            }),
        },
      ]

      for (const { tag, make } of cases) {
        const row = toOutboxEvent(make())
        expect(row.eventType, tag).toBe(tag)
        expect(
          () => validateEventPayload(tag, row.eventVersion ?? 1, row.payload),
          tag,
        ).not.toThrow()
      }
    })

    it('the connected payload is identifier-only', () => {
      const row = toOutboxEvent(connectedEvent())
      expect(row.eventVersion).toBe(3)
      const payload = row.payload as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual([
        'connectionId',
        'correlationId',
        'organizationId',
        'userId',
      ])
    })
  })
})
