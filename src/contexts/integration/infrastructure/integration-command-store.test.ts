// BQC-3.5 — atomic integration command store contract tests.
//
// Every command must commit its google_connections / gbp_import_jobs
// mutation and its outbox_events row in ONE transaction, then emit on the
// in-process bus AFTER commit:
//   ['tx.start', 'tx.state'+, 'tx.outbox', 'tx.commit', 'emit']
// A missing connection rolls back — no fact, no emit. A post-commit bus
// failure must not propagate (durable row already retained).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAtomicIntegrationCommandStore } from './integration-command-store'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import {
  gbpImportJobId,
  googleConnectionId,
  organizationId,
  userId,
} from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleConnectionVisibilityChanged,
  integrationPropertyImportCompleted,
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
const ORG_ID = organizationId('org-integration-cmd-00000000001')
const CONN_ID = googleConnectionId('6d000000-0000-0000-0000-000000000001')
const JOB_ID = gbpImportJobId('6e000000-0000-0000-0000-000000000001')

function makeConnection(overrides: Partial<GoogleConnection> = {}): GoogleConnection {
  return {
    id: CONN_ID,
    organizationId: ORG_ID,
    googleAccountId: 'ga-123',
    googleEmail: 'conn@test.com',
    encryptedAccessToken: 'enc-a',
    encryptedRefreshToken: 'enc-r',
    tokenExpiresAt: new Date('2026-06-01T13:00:00.000Z'),
    scopes: ['scope-a'],
    connectedBy: userId('user-connector-000000000000001'),
    visibility: 'private',
    status: 'active',
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeConnectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_ID as string,
    organizationId: ORG_ID as string,
    googleAccountId: 'ga-123',
    googleEmail: 'conn@test.com',
    encryptedAccessToken: 'enc-a',
    encryptedRefreshToken: 'enc-r',
    tokenExpiresAt: new Date('2026-06-01T13:00:00.000Z'),
    scopes: ['scope-a'],
    connectedBy: 'user-connector-000000000000001',
    visibility: 'private',
    status: 'active',
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

const connectedEvent = () =>
  integrationGoogleAccountConnected({
    connectionId: CONN_ID,
    organizationId: ORG_ID,
    googleEmail: 'conn@test.com',
    occurredAt: NOW,
  })

describe('createAtomicIntegrationCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('connectGoogleAccount', () => {
    it('commits insert + connected fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const insertedRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows, insertedRows })
      const events = makeEvents(order)
      const store = createAtomicIntegrationCommandStore(db, events)
      const event = connectedEvent()

      await store.connectGoogleAccount({ connection: makeConnection(), event })

      expect(insertedRows).toHaveLength(1)
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('integration.google_account.connected')
      expect(outboxRows[0]!.id).toBe(event.eventId)
      // Identifier-only: the provider email never enters the durable payload
      expect(outboxRows[0]!.payload).not.toHaveProperty('googleEmail')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('maps a unique violation to UniqueViolationError and records no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        insertError: Object.assign(new Error('duplicate key'), { code: '23505' }),
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIntegrationCommandStore(db, events)

      await expect(
        store.connectGoogleAccount({
          connection: makeConnection(),
          event: connectedEvent(),
        }),
      ).rejects.toSatisfy((e: unknown) => isUniqueViolationError(e))
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.rollback'])
    })
  })

  describe('reconnectGoogleAccount', () => {
    it('commits reconnection update + connected fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateReturning: [makeConnectionRow()],
        outboxRows,
        updateSets,
      })
      const events = makeEvents(order)
      const store = createAtomicIntegrationCommandStore(db, events)

      const result = await store.reconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
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
      })
      expect(outboxRows).toHaveLength(1)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('throws connection_not_found when the row vanished — no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateReturning: [], outboxRows })
      const events = makeEvents(order)
      const store = createAtomicIntegrationCommandStore(db, events)

      await expect(
        store.reconnectGoogleAccount({
          organizationId: ORG_ID,
          connectionId: CONN_ID,
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
    it('commits status + redaction + disconnected fact in one tx before emit', async () => {
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
              googleEmail: 'redacted',
            }),
          ],
        ],
        outboxRows,
        updateSets,
      })
      const events = makeEvents(order)
      const store = createAtomicIntegrationCommandStore(db, events)
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

      expect(updateSets[0]).toMatchObject({ status: 'disconnected' })
      expect(updateSets[1]).toMatchObject({
        encryptedAccessToken: 'redacted',
        encryptedRefreshToken: 'redacted',
        googleEmail: 'redacted',
        googleAccountId: `redacted:${CONN_ID as string}`,
        scopes: [],
      })
      expect(result.status).toBe('disconnected')
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.id).toBe(event.eventId)
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
    })

    it('throws connection_not_found when the row vanished — no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateReturningQueue: [[]], outboxRows })
      const events = makeEvents(order)
      const store = createAtomicIntegrationCommandStore(db, events)

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
    it('commits visibility update + fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateReturning: [makeConnectionRow({ visibility: 'organization' })],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicIntegrationCommandStore(db, events)

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
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe(
        'integration.google_connection.visibility_changed',
      )
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })
  })

  describe('recordImportCompleted', () => {
    it('commits terminal status + import.completed fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateReturning: [], outboxRows, updateSets })
      const events = makeEvents(order)
      const store = createAtomicIntegrationCommandStore(db, events)
      const event = integrationPropertyImportCompleted({
        importJobId: JOB_ID,
        organizationId: ORG_ID,
        totalCount: 3,
        importedCount: 2,
        skippedCount: 1,
        failedCount: 0,
        occurredAt: NOW,
      })

      await store.recordImportCompleted({
        organizationId: ORG_ID,
        importJobId: JOB_ID,
        finalStatus: 'completed_with_skips',
        now: NOW,
        event,
      })

      expect(updateSets[0]).toEqual({ status: 'completed_with_skips', updatedAt: NOW })
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('integration.property_import.completed')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })
  })

  describe('emit failure isolation', () => {
    it('a post-commit bus failure does not propagate (durable row retained)', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows })
      const events = makeEvents(order, true)
      const store = createAtomicIntegrationCommandStore(db, events)

      await store.connectGoogleAccount({
        connection: makeConnection(),
        event: connectedEvent(),
      })

      expect(outboxRows).toHaveLength(1)
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
        {
          tag: 'integration.property_import.completed',
          make: () =>
            integrationPropertyImportCompleted({
              importJobId: JOB_ID,
              organizationId: ORG_ID,
              totalCount: 3,
              importedCount: 2,
              skippedCount: 1,
              failedCount: 0,
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

    it('the connected payload is identifier-only (googleEmail stripped)', () => {
      const row = toOutboxEvent(connectedEvent())
      const payload = row.payload as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual([
        'connectionId',
        'correlationId',
        'organizationId',
      ])
    })
  })
})
