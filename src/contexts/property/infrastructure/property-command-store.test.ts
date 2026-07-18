// BQC-3.5 — atomic property command store contract tests.
//
// Every command must commit its properties mutation and its outbox_events
// row in ONE transaction, then emit on the in-process bus AFTER commit:
//   ['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit']
// A tenant mismatch rolls back — no fact, no emit. A post-commit bus
// failure must not propagate (durable row already retained).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAtomicPropertyCommandStore } from './property-command-store'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { Property } from '../domain/types'
import { propertyCreated, propertyDeleted, propertyUpdated } from '../domain/events'
import { isPropertyError } from '../domain/errors'

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
const ORG_ID = organizationId('org-property-cmd-0000000000001')
const PROP_ID = propertyId('4d000000-0000-0000-0000-000000000001')

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: PROP_ID,
    organizationId: ORG_ID,
    name: 'Grand Hotel',
    slug: 'grand-hotel',
    timezone: 'UTC',
    gbpPlaceId: null,
    googleConnectionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    lifecycleState: 'active',
    lifecycleReason: null,
    lifecycleStateChangedAt: NOW,
    purgeScheduledFor: null,
    lifecycleInitiatedBy: null,
    countryCode: null,
    countrySource: 'organization_default',
    timezoneSource: 'legacy',
    timezoneResolvedAt: null,
    processingRegion: 'unresolved',
    processingRegionSource: 'country_default',
    routingPolicyVersion: 1,
    processingRegionResolvedAt: null,
    sourceEpoch: 0,
    ...overrides,
  }
}

function makePropertyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROP_ID as string,
    organizationId: ORG_ID as string,
    name: 'Grand Hotel',
    slug: 'grand-hotel',
    timezone: 'UTC',
    gbpPlaceId: null,
    googleConnectionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    lifecycleState: 'active',
    lifecycleReason: null,
    lifecycleStateChangedAt: NOW,
    purgeScheduledFor: null,
    lifecycleInitiatedBy: null,
    countryCode: null,
    countrySource: 'organization_default',
    timezoneSource: 'legacy',
    timezoneResolvedAt: null,
    processingRegion: 'unresolved',
    processingRegionSource: 'country_default',
    routingPolicyVersion: 1,
    processingRegionResolvedAt: null,
    sourceEpoch: 0,
    ...overrides,
  }
}

type MockTx = {
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

function createMockDb(opts: {
  order: string[]
  insertReturning?: unknown[]
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
        values: vi.fn((row: Record<string, unknown>) => {
          opts.insertedRows?.push(row)
          return {
            returning: vi.fn(async () => opts.insertReturning ?? []),
          }
        }),
      }
    }),
    update: vi.fn(() => {
      order.push('tx.state')
      return {
        set: vi.fn((values: Record<string, unknown>) => {
          opts.updateSets?.push(values)
          return { where: vi.fn(async () => undefined) }
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

const createdEvent = (property: Property = makeProperty()) =>
  propertyCreated({
    propertyId: property.id,
    organizationId: property.organizationId,
    name: property.name,
    slug: property.slug,
    occurredAt: property.createdAt,
  })

describe('createAtomicPropertyCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('createProperty', () => {
    it('commits insert + created fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const insertedRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        insertReturning: [makePropertyRow()],
        outboxRows,
        insertedRows,
      })
      const events = makeEvents(order)
      const store = createAtomicPropertyCommandStore(db, events)
      const property = makeProperty()
      const event = createdEvent(property)

      const result = await store.createProperty({
        organizationId: ORG_ID,
        property,
        event,
      })

      expect(result.id).toBe(PROP_ID)
      expect(insertedRows).toHaveLength(1)
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('property.created')
      expect(outboxRows[0]!.id).toBe(event.eventId)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('throws forbidden on a tenant mismatch — no insert, no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const insertedRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows, insertedRows })
      const events = makeEvents(order)
      const store = createAtomicPropertyCommandStore(db, events)

      await expect(
        store.createProperty({
          organizationId: organizationId('org-other-0000-0000-000000000001'),
          property: makeProperty(),
          event: createdEvent(),
        }),
      ).rejects.toSatisfy((e: unknown) => isPropertyError(e) && e.code === 'forbidden')
      expect(insertedRows).toHaveLength(0)
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.rollback'])
    })
  })

  describe('updateProperty', () => {
    it('commits patch + updated fact in one tx before emit, never setting identity columns', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const updateSets: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows, updateSets })
      const events = makeEvents(order)
      const store = createAtomicPropertyCommandStore(db, events)
      const event = propertyUpdated({
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        name: 'Renamed Hotel',
        slug: 'renamed-hotel',
        occurredAt: NOW,
      })

      await store.updateProperty({
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        patch: { name: 'Renamed Hotel', slug: 'renamed-hotel', updatedAt: NOW },
        event,
      })

      expect(updateSets).toEqual([
        { name: 'Renamed Hotel', slug: 'renamed-hotel', updatedAt: NOW },
      ])
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('property.updated')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })
  })

  describe('deleteProperty', () => {
    it('commits delete + deleted fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db, tx } = createMockDb({ order, outboxRows })
      const events = makeEvents(order)
      const store = createAtomicPropertyCommandStore(db, events)
      const event = propertyDeleted({
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        occurredAt: NOW,
      })

      await store.deleteProperty({ organizationId: ORG_ID, propertyId: PROP_ID, event })

      expect(tx.delete).toHaveBeenCalledTimes(1)
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('property.deleted')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })
  })

  describe('emit failure isolation', () => {
    it('a post-commit bus failure does not propagate (durable row retained)', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        insertReturning: [makePropertyRow()],
        outboxRows,
      })
      const events = makeEvents(order, true)
      const store = createAtomicPropertyCommandStore(db, events)

      const result = await store.createProperty({
        organizationId: ORG_ID,
        property: makeProperty(),
        event: createdEvent(),
      })

      expect(result.id).toBe(PROP_ID)
      expect(outboxRows).toHaveLength(1)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
    })
  })

  describe('identifier-only payload enforcement (schema allowlist, BQC-3.5 registrations)', () => {
    it('property.created / updated / deleted pass schema validation with real producer payloads', () => {
      const cases: ReadonlyArray<{ tag: string; make: () => DomainEvent }> = [
        { tag: 'property.created', make: () => createdEvent() },
        {
          tag: 'property.created',
          make: () =>
            propertyCreated({
              propertyId: PROP_ID,
              organizationId: ORG_ID,
              name: 'GBP Hotel',
              slug: 'gbp-hotel-abc12345',
              gbpPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
              googleConnectionId: googleConnectionId(
                '4d000000-0000-0000-0000-0000000000aa',
              ),
              occurredAt: NOW,
            }),
        },
        {
          tag: 'property.updated',
          make: () =>
            propertyUpdated({
              propertyId: PROP_ID,
              organizationId: ORG_ID,
              name: 'Renamed',
              slug: 'renamed',
              occurredAt: NOW,
            }),
        },
        {
          tag: 'property.deleted',
          make: () =>
            propertyDeleted({
              propertyId: PROP_ID,
              organizationId: ORG_ID,
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
  })
})
