// BQC-3.5 — atomic metric command store contract tests.
//
// The single command must commit its metric_readings insert and its
// outbox_events row in ONE transaction, then emit on the in-process bus
// AFTER commit:
//   ['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit']
// A failing fact insert rolls back — no reading, no emit. A post-commit bus
// failure must not propagate.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAtomicMetricCommandStore } from './metric-command-store'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import {
  organizationId,
  propertyId,
  portalId,
  metricReadingId,
  portalGroupId,
} from '#/shared/domain/ids'
import type { MetricReading } from '../domain/types'
import { metricRecorded } from '../domain/events'

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
const ORG_ID = organizationId('org-metric-cmd-000000000000001')
const PROP_ID = propertyId('a0000000-0000-0000-0000-0000000000a1')
const PORTAL_ID = portalId('b0000000-0000-0000-0000-0000000000b1')
const GROUP_ID = portalGroupId('c0000000-0000-0000-0000-0000000000c1')
const READING_ID = metricReadingId('d0000000-0000-0000-0000-0000000000d1')

function makeReading(overrides: Partial<MetricReading> = {}): MetricReading {
  return {
    id: READING_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    portalId: PORTAL_ID,
    metricKey: 'portal.scan',
    value: 1,
    groupId: GROUP_ID,
    occurredAt: NOW,
    ...overrides,
  }
}

const recordedEvent = (reading: MetricReading = makeReading()) =>
  metricRecorded({
    readingId: reading.id,
    organizationId: reading.organizationId,
    propertyId: reading.propertyId,
    portalId: reading.portalId,
    groupId: reading.groupId,
    metricKey: reading.metricKey,
    value: reading.value,
    occurredAt: reading.occurredAt,
  })

type MockTx = {
  insert: ReturnType<typeof vi.fn>
}

/**
 * Mocked drizzle transaction recording the crash-boundary ordering.
 * The reading insert echoes its values back via RETURNING (explicit id).
 */
function createMockDb(opts: {
  order: string[]
  outboxRows?: Array<Record<string, unknown>>
  stateValues?: Array<Record<string, unknown>>
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
          opts.stateValues?.push(row)
          return { returning: vi.fn(async () => [row]) }
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

describe('createAtomicMetricCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('recordMetric', () => {
    it('commits reading insert + recorded fact in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const stateValues: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows, stateValues })
      const events = makeEvents(order)
      const store = createAtomicMetricCommandStore(db, events)
      const reading = makeReading()
      const event = recordedEvent(reading)

      const result = await store.recordMetric({ reading, event })

      expect(result.id).toBe(READING_ID)
      expect(result.groupId).toBe(GROUP_ID)
      expect(stateValues).toHaveLength(1)
      // Explicit id — the fact's readingId must match the committed row.
      expect(stateValues[0]!.id).toBe(READING_ID as string)
      expect(outboxRows).toHaveLength(1)
      expect(outboxRows[0]!.eventType).toBe('metric.recorded')
      expect(outboxRows[0]!.id).toBe(event.eventId)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('rolls back the reading when the fact cannot convert (unregistered type)', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows })
      const events = makeEvents(order)
      const store = createAtomicMetricCommandStore(db, events)
      const ghost = {
        ...recordedEvent(),
        _tag: 'metric.ghost',
      } as unknown as ReturnType<typeof recordedEvent>

      await expect(
        store.recordMetric({ reading: makeReading(), event: ghost }),
      ).rejects.toThrow()

      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      // toOutboxEvent throws while building the outbox insert's values — the
      // query builder was invoked but no row was written, and the tx rolled back.
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.rollback'])
    })
  })

  describe('emit failure isolation', () => {
    it('a post-commit bus failure does not propagate (durable row retained)', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows })
      const events = makeEvents(order, true)
      const store = createAtomicMetricCommandStore(db, events)

      const result = await store.recordMetric({
        reading: makeReading(),
        event: recordedEvent(),
      })

      expect(result.id).toBe(READING_ID)
      expect(outboxRows).toHaveLength(1)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
    })
  })

  describe('identifier-only payload enforcement (schema allowlist, BQC-3.5 fix)', () => {
    it('metric.recorded passes schema validation with the real producer payload', () => {
      const row = toOutboxEvent(recordedEvent())
      expect(row.eventType).toBe('metric.recorded')
      expect(() => validateEventPayload('metric.recorded', 1, row.payload)).not.toThrow()
    })

    it('the recorded payload carries occurredAt (not the legacy recordedAt)', () => {
      const row = toOutboxEvent(recordedEvent())
      const payload = row.payload as Record<string, unknown>
      expect(payload.occurredAt).toBe(NOW.toISOString())
      expect(payload).not.toHaveProperty('recordedAt')
      expect(payload.organizationId).toBe(ORG_ID as string)
      expect(payload.propertyId).toBe(PROP_ID as string)
      expect(payload.metricKey).toBe('portal.scan')
      expect(payload.value).toBe(1)
    })
  })
})
