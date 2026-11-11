import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import {
  metricReadingId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { createReading } from '../domain/metric-reading'
import { createAtomicMetricCommandStore } from './metric-command-store.server'

vi.mock('#/shared/outbox/commit', () => ({ insertOutboxRow: vi.fn() }))

describe('metric command store', () => {
  it('persists an ordinary reading without writing an unconsumed outbox fact', async () => {
    const now = new Date('2026-08-08T12:00:00Z')
    const reading = createReading({
      id: metricReadingId('d4000000-0000-4000-8000-000000000071'),
      definitionVersionId: '11111111-1111-4111-8111-111111111202',
      metricKey: 'portal.rating',
      organizationId: organizationId('org-1'),
      propertyId: propertyId('d4000000-0000-4000-8000-000000000051'),
      portalId: portalId('d4000000-0000-4000-8000-000000000061'),
      value: 4,
      sampleCount: 1,
      sourceEventId: 'source-1',
      sourcePolicy: 'first_party_guest_private',
      occurredAt: now,
      propertyLocalDate: '2026-08-08',
      attributionQuality: 'exact',
      retentionClass: 'short',
      now,
    })
    const values = vi.fn(() => ({
      onConflictDoNothing: () => ({ returning: async () => [{ id: reading.id }] }),
    }))
    const insert = vi.fn(() => ({ values }))
    const tx = { insert, execute: vi.fn(async () => ({ rows: [] })) }
    const db = {
      transaction: async (run: (inner: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Database
    const store = createAtomicMetricCommandStore(db, () => 'correction-1')

    await expect(store.recordMetric({ reading })).resolves.toEqual({
      status: 'recorded',
      reading,
    })
    expect(insert).toHaveBeenCalledExactlyOnceWith(metricReadings)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ id: reading.id, exactValue: 4 }),
    )
    expect(insertOutboxRow).not.toHaveBeenCalled()
  })
})
