import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createGoalMetricCorrectionImpactLookup } from './repositories/goal-metric-correction-impact.lookup'

const input = {
  organizationId: 'org-1',
  propertyId: '10000000-0000-4000-8000-000000000001',
  definitionVersionId: '10000000-0000-4000-8000-000000000002',
  correctedReadingId: '10000000-0000-4000-8000-000000000003',
  replacementReadingId: '10000000-0000-4000-8000-000000000004',
} as const

describe('Goal metric correction impact lookup', () => {
  it('returns original and replacement impacts in deterministic event order', async () => {
    const eventAt = new Date('2026-07-20T10:00:00.000Z')
    const where = vi.fn(async () => [
      {
        readingId: input.replacementReadingId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        definitionVersionId: input.definitionVersionId,
        portalId: '10000000-0000-4000-8000-000000000005',
        portalGroupId: null,
        eventAt,
      },
      {
        readingId: input.correctedReadingId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        definitionVersionId: input.definitionVersionId,
        portalId: '10000000-0000-4000-8000-000000000005',
        portalGroupId: '10000000-0000-4000-8000-000000000006',
        eventAt,
      },
    ])
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    } as unknown as Database

    await expect(
      createGoalMetricCorrectionImpactLookup(db).findGoalMetricCorrectionImpacts(input),
    ).resolves.toEqual([
      expect.objectContaining({ readingId: input.correctedReadingId }),
      expect.objectContaining({ readingId: input.replacementReadingId }),
    ])
    expect(where).toHaveBeenCalledOnce()
  })

  it('fails closed when the corrected reading is absent', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    } as unknown as Database

    await expect(
      createGoalMetricCorrectionImpactLookup(db).findGoalMetricCorrectionImpacts(input),
    ).rejects.toThrow('corrected Metric reading impact is unavailable')
  })

  it('fails closed when a returned impact has drifted attribution', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              readingId: input.correctedReadingId,
              organizationId: 'other-org',
              propertyId: input.propertyId,
              definitionVersionId: input.definitionVersionId,
              portalId: null,
              portalGroupId: null,
              eventAt: new Date('2026-07-20T10:00:00.000Z'),
            },
          ]),
        })),
      })),
    } as unknown as Database

    await expect(
      createGoalMetricCorrectionImpactLookup(db).findGoalMetricCorrectionImpacts({
        ...input,
        replacementReadingId: null,
      }),
    ).rejects.toThrow('Metric correction impact attribution is invalid')
  })
})
