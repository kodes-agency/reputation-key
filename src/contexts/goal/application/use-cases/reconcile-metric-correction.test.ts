import { describe, expect, it, vi } from 'vitest'
import type { GoalMetricCorrectionImpact } from '#/contexts/metric/application/public-api'
import { reconcileMetricCorrection } from './reconcile-metric-correction'

const original: GoalMetricCorrectionImpact = {
  readingId: 'reading-original',
  organizationId: 'org-1',
  propertyId: 'property-1',
  definitionVersionId: 'metric-version-1',
  portalId: 'portal-1',
  portalGroupId: 'group-1',
  eventAt: new Date('2026-07-15T12:00:00.000Z'),
}

const replacement: GoalMetricCorrectionImpact = {
  ...original,
  readingId: 'reading-replacement',
  portalGroupId: 'group-2',
  eventAt: new Date('2026-08-02T12:00:00.000Z'),
}

const input = {
  organizationId: original.organizationId,
  propertyId: original.propertyId,
  definitionVersionId: original.definitionVersionId,
  correctedReadingId: original.readingId,
  replacementReadingId: replacement.readingId,
} as const

describe('reconcileMetricCorrection', () => {
  it('deduplicates affected closed results and is safe to replay', async () => {
    const findImpacts = vi.fn(async () => [original, replacement])
    const findCandidates = vi
      .fn()
      .mockResolvedValueOnce(['result-2', 'result-1'])
      .mockResolvedValueOnce(['result-1'])
      .mockResolvedValueOnce(['result-2', 'result-1'])
      .mockResolvedValueOnce(['result-1'])
    const revisionHeads = new Set<string>()
    const reconcileClosedResult = vi.fn(async ({ resultId }: { resultId: string }) => {
      if (revisionHeads.has(resultId)) return { status: 'unchanged' as const }
      revisionHeads.add(resultId)
      return { status: 'revised' as const }
    })
    const command = reconcileMetricCorrection({
      findImpacts,
      findCandidates,
      reconcileClosedResult,
    })

    await expect(command(input)).resolves.toEqual({
      impactCount: 2,
      candidateCount: 2,
      revised: 2,
      unchanged: 0,
    })
    await expect(command(input)).resolves.toEqual({
      impactCount: 2,
      candidateCount: 2,
      revised: 0,
      unchanged: 2,
    })
    expect(reconcileClosedResult.mock.calls.map(([value]) => value.resultId)).toEqual([
      'result-1',
      'result-2',
      'result-1',
      'result-2',
    ])
    expect(findCandidates).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: 'org-1',
        propertyId: 'property-1',
        definitionVersionId: 'metric-version-1',
        portalId: 'portal-1',
        portalGroupId: 'group-1',
        eventAt: original.eventAt,
      }),
    )
    expect(findCandidates).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ portalGroupId: 'group-2', eventAt: replacement.eventAt }),
    )
  })

  it('treats no affected closed result as a successful no-op', async () => {
    const reconcileClosedResult = vi.fn()
    const command = reconcileMetricCorrection({
      findImpacts: vi.fn(async () => [original]),
      findCandidates: vi.fn(async () => []),
      reconcileClosedResult,
    })

    await expect(command({ ...input, replacementReadingId: null })).resolves.toEqual({
      impactCount: 1,
      candidateCount: 0,
      revised: 0,
      unchanged: 0,
    })
    expect(reconcileClosedResult).not.toHaveBeenCalled()
  })

  it('fails closed when Metric returns an incomplete or cross-scope impact set', async () => {
    const deps = {
      findCandidates: vi.fn(async () => []),
      reconcileClosedResult: vi.fn(),
    }

    await expect(
      reconcileMetricCorrection({
        ...deps,
        findImpacts: vi.fn(async () => [original]),
      })(input),
    ).rejects.toThrow('Metric correction impact set is incomplete')
    await expect(
      reconcileMetricCorrection({
        ...deps,
        findImpacts: vi.fn(async () => [
          { ...original, organizationId: 'other-org' },
          replacement,
        ]),
      })(input),
    ).rejects.toThrow('Metric correction impact scope mismatch')
    expect(deps.findCandidates).not.toHaveBeenCalled()
  })

  it('requests durable retry while a closed result source is updating', async () => {
    const command = reconcileMetricCorrection({
      findImpacts: vi.fn(async () => [original]),
      findCandidates: vi.fn(async () => ['closed-result-1']),
      reconcileClosedResult: vi.fn(async () => ({ status: 'pending' as const })),
    })

    await expect(command({ ...input, replacementReadingId: null })).rejects.toThrow(
      'Goal metric correction reconciliation is pending',
    )
  })
})
