import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { metricCorrections, metricReadings } from '#/shared/db/schema/metric.schema'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import {
  metricReadingId,
  organizationId,
  portalId,
  portalGroupId,
  propertyId,
} from '#/shared/domain/ids'
import { createReading, type MetricReading } from '../domain/metric-reading'
import { metricRecorded, type MetricRecorded } from '../domain/events'
import { createAtomicMetricCommandStore } from './metric-command-store'
import { portalLifetimeFactForMetric } from '../domain/portal-lifetime-aggregate'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

const NOW = new Date('2026-08-08T12:00:00.000Z')
const ORG_ID = organizationId('org-metric-command')
const PROP_ID = propertyId('a0000000-0000-4000-8000-0000000000a1')
const GROUP_ID = portalGroupId('c0000000-0000-4000-8000-0000000000c1')
const READING_ID = metricReadingId('d0000000-0000-4000-8000-0000000000d1')

const makeReading = (overrides: Partial<MetricReading> = {}): MetricReading =>
  createReading({
    id: READING_ID,
    definitionVersionId: '11111111-1111-4111-8111-111111111101',
    metricKey: 'portal.content_review.completed',
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    portalGroupId: GROUP_ID,
    portalId: null,
    value: 1,
    sampleCount: 1,
    sourceEventId: 'source-event-1',
    sourcePolicy: 'first_party_workflow',
    occurredAt: NOW,
    propertyLocalDate: '2026-08-08',
    attributionQuality: 'exact',
    retentionClass: 'standard',
    now: NOW,
    ...overrides,
  })

const recordedEvent = (reading = makeReading()) =>
  metricRecorded({
    readingId: reading.id,
    organizationId: reading.organizationId,
    propertyId: reading.propertyId,
    portalId: reading.portalId,
    portalGroupId: reading.portalGroupId,
    definitionVersionId: reading.definitionVersionId,
    sourceEventId: reading.sourceEventId,
    sourcePolicy: reading.sourcePolicy,
    metricKey: reading.metricKey,
    value: reading.value,
    numerator: reading.numerator,
    denominator: reading.denominator,
    sampleCount: reading.sampleCount,
    attributionQuality: reading.attributionQuality,
    permittedConsumers: ['dashboard', 'goal'],
    occurredAt: reading.occurredAt,
  })

const createMockDb = (order: string[]) => {
  const stateValues: Array<Record<string, unknown>> = []
  const outboxRows: Array<Record<string, unknown>> = []
  const tx = {
    insert: vi.fn((table: unknown) => {
      if (table === outboxEvents) {
        order.push('tx.outbox')
        return {
          values: vi.fn(async (row: Record<string, unknown>) => {
            outboxRows.push(row)
          }),
        }
      }
      order.push('tx.state')
      return {
        values: vi.fn((row: Record<string, unknown>) => {
          stateValues.push(row)
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: row.id }]),
            })),
          }
        }),
      }
    }),
  }
  const db = {
    transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => {
      order.push('tx.start')
      try {
        const result = await work(tx)
        order.push('tx.commit')
        return result
      } catch (error) {
        order.push('tx.rollback')
        throw error
      }
    }),
  }
  return { db: db as unknown as Database, stateValues, outboxRows }
}

describe('createAtomicMetricCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('commits governed reading and outbox fact atomically', async () => {
    const order: string[] = []
    const { db, stateValues, outboxRows } = createMockDb(order)
    const store = createAtomicMetricCommandStore(db, randomUUID)
    const reading = makeReading()
    const result = await store.recordMetric({ reading, event: recordedEvent(reading) })

    expect(result).toEqual({ status: 'recorded', reading })
    expect(stateValues[0]).toMatchObject({
      id: READING_ID,
      definitionVersionId: reading.definitionVersionId,
      sourceEventId: 'source-event-1',
      exactValue: 1,
      propertyLocalDate: '2026-08-08',
    })
    expect(outboxRows).toHaveLength(1)
    expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
  })

  it('rolls back the reading when the outbox fact is invalid', async () => {
    const order: string[] = []
    const { db } = createMockDb(order)
    const ghost = {
      ...recordedEvent(),
      _tag: 'metric.ghost',
    } as unknown as MetricRecorded

    await expect(
      createAtomicMetricCommandStore(db, randomUUID).recordMetric({
        reading: makeReading(),
        event: ghost,
      }),
    ).rejects.toThrow(/Event type metric\.ghost:v1 is not registered for the outbox/)
    expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.rollback'])
  })

  it('publishes an identifier-only provenance payload accepted by the schema', () => {
    const row = toOutboxEvent(recordedEvent())
    const payload = row.payload as Record<string, unknown>
    expect(() => validateEventPayload('metric.recorded', 1, payload)).not.toThrow()
    expect(payload).toMatchObject({
      readingId: READING_ID,
      definitionVersionId: '11111111-1111-4111-8111-111111111101',
      sourceEventId: 'source-event-1',
      permittedConsumers: ['dashboard', 'goal'],
    })
    expect(payload).not.toHaveProperty('recordedAt')
  })

  it('atomically retracts the superseded reading and records its replacement', async () => {
    const outboxRows: Array<Record<string, unknown>> = []
    const correctionRows: Array<Record<string, unknown>> = []
    const replacement = makeReading({
      id: metricReadingId('d0000000-0000-4000-8000-0000000000d2'),
      sourceEventId: 'source-event-2',
      value: 0.8,
      numerator: 4,
      denominator: 5,
      sampleCount: 5,
    })
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: READING_ID,
                organizationId: ORG_ID,
                propertyId: PROP_ID,
              },
            ]),
          })),
        })),
      })),
      insert: vi.fn((table: unknown) => {
        if (table === metricReadings) {
          return {
            values: vi.fn(() => ({
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => [{ id: replacement.id }]),
              })),
            })),
          }
        }
        if (table === metricCorrections) {
          return {
            values: vi.fn((row: Record<string, unknown>) => ({
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => {
                  correctionRows.push(row)
                  return [{ id: row.id }]
                }),
              })),
            })),
          }
        }
        if (table === outboxEvents) {
          return {
            values: vi.fn(async (row: Record<string, unknown>) => {
              outboxRows.push(row)
            }),
          }
        }
        throw new Error('unexpected table')
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as Database

    const result = await createAtomicMetricCommandStore(db, randomUUID).recordMetric({
      reading: replacement,
      supersedesSourceEventId: 'source-event-1',
      event: recordedEvent(replacement),
    })

    expect(result).toEqual({ status: 'recorded', reading: replacement })
    expect(correctionRows).toEqual([
      expect.objectContaining({
        readingId: READING_ID,
        sourceEventId: 'source-event-2:retract',
        kind: 'retract',
        reason: 'source_reconciliation',
      }),
    ])
    expect(outboxRows.map((row) => row.eventType)).toEqual([
      'metric.recorded',
      'metric.corrected',
    ])
  })

  // Delivery is at-least-once, so this consumer WILL see the same event twice —
  // a retry, or a reading a retention purge removed between deliveries. The
  // insert used to raise metric_corrections_source_unique on the second pass;
  // the job then failed every attempt and the domain-events queue stopped
  // draining, which surfaced as unrelated projection timeouts everywhere else.
  it('reuses the existing correction when the retraction is redelivered', async () => {
    const outboxRows: Array<Record<string, unknown>> = []
    const EXISTING_CORRECTION_ID = 'c0000000-0000-4000-8000-0000000000c9'
    const replacement = makeReading({
      id: metricReadingId('d0000000-0000-4000-8000-0000000000d2'),
      sourceEventId: 'source-event-2',
      value: 0.8,
      numerator: 4,
      denominator: 5,
      sampleCount: 5,
    })
    const tx = {
      select: vi.fn((columns?: Record<string, unknown>) => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () =>
              table === metricCorrections
                ? [{ id: EXISTING_CORRECTION_ID }]
                : [{ id: READING_ID, organizationId: ORG_ID, propertyId: PROP_ID }],
            ),
          })),
        })),
        __columns: columns,
      })),
      insert: vi.fn((table: unknown) => {
        if (table === metricReadings) {
          return {
            values: vi.fn(() => ({
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => [{ id: replacement.id }]),
              })),
            })),
          }
        }
        if (table === metricCorrections) {
          return {
            values: vi.fn(() => ({
              // The row is already there: nothing inserted, nothing returned.
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => []),
              })),
            })),
          }
        }
        if (table === outboxEvents) {
          return {
            values: vi.fn(async (row: Record<string, unknown>) => {
              outboxRows.push(row)
            }),
          }
        }
        throw new Error('unexpected table')
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as Database

    const result = await createAtomicMetricCommandStore(db, randomUUID).recordMetric({
      reading: replacement,
      supersedesSourceEventId: 'source-event-1',
      event: recordedEvent(replacement),
    })

    expect(result).toEqual({ status: 'recorded', reading: replacement })
    // The outbox fact must describe the correction that exists, not the ID this
    // pass generated; otherwise a replay announces a second correction that
    // was never written.
    const corrected = outboxRows.find((row) => row.eventType === 'metric.corrected')
    expect(corrected?.payload).toMatchObject({ correctionId: EXISTING_CORRECTION_ID })
  })

  it('updates the anonymous lifetime aggregate before the outbox fact commits', async () => {
    const order: string[] = []
    let aggregateExecuteCount = 0
    const rating = makeReading({
      portalId: portalId('b0000000-0000-4000-8000-0000000000b1'),
      portalGroupId: null,
      metricKey: 'portal.rating',
      value: 4,
      definitionVersionId: '11111111-1111-4111-8111-111111111202',
      sourcePolicy: 'first_party_guest_private',
    })
    const tx = {
      execute: vi.fn(async () => {
        aggregateExecuteCount += 1
        order.push(`tx.lifetime.${aggregateExecuteCount}`)
        return { rows: [] }
      }),
      insert: vi.fn((table: unknown) => {
        if (table === metricReadings) {
          order.push('tx.state')
          return {
            values: vi.fn(() => ({
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => [{ id: rating.id }]),
              })),
            })),
          }
        }
        if (table === outboxEvents) {
          order.push('tx.outbox')
          return { values: vi.fn(async () => undefined) }
        }
        throw new Error('unexpected table')
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => {
        order.push('tx.start')
        const result = await work(tx)
        order.push('tx.commit')
        return result
      }),
    } as unknown as Database

    await createAtomicMetricCommandStore(db, randomUUID).recordMetric({
      reading: rating,
      portalLifetimeFact: portalLifetimeFactForMetric({
        metricKey: rating.metricKey,
        value: rating.value,
      }),
      event: recordedEvent(rating),
    })

    expect(order).toEqual([
      'tx.start',
      'tx.state',
      'tx.lifetime.1',
      'tx.lifetime.2',
      'tx.lifetime.3',
      'tx.outbox',
      'tx.commit',
    ])
  })

  it('does not record a fact when the lifetime aggregate mutation fails', async () => {
    const rating = makeReading({
      portalId: portalId('b0000000-0000-4000-8000-0000000000b1'),
      portalGroupId: null,
      metricKey: 'portal.rating',
      value: 4,
      definitionVersionId: '11111111-1111-4111-8111-111111111202',
      sourcePolicy: 'first_party_guest_private',
    })
    let executeCount = 0
    const outboxRows: Array<Record<string, unknown>> = []
    const tx = {
      execute: vi.fn(async () => {
        executeCount += 1
        if (executeCount === 3) throw new Error('aggregate unavailable')
        return { rows: [] }
      }),
      insert: vi.fn((table: unknown) => {
        if (table === metricReadings) {
          return {
            values: vi.fn(() => ({
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => [{ id: rating.id }]),
              })),
            })),
          }
        }
        if (table === outboxEvents) {
          return {
            values: vi.fn(async (row: Record<string, unknown>) => {
              outboxRows.push(row)
            }),
          }
        }
        throw new Error('unexpected table')
      }),
    }
    const db = {
      transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as Database

    await expect(
      createAtomicMetricCommandStore(db, randomUUID).recordMetric({
        reading: rating,
        portalLifetimeFact: portalLifetimeFactForMetric({
          metricKey: rating.metricKey,
          value: rating.value,
        }),
        event: recordedEvent(rating),
      }),
    ).rejects.toThrow('aggregate unavailable')
    expect(outboxRows).toEqual([])
  })
})
