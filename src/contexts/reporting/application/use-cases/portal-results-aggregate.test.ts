import { describe, expect, it } from 'vitest'
import { portalId } from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type {
  MetricPortalMetricEvidence,
  MetricPortalMetricEvidenceSet,
} from '../ports/portal-analytics.repository'
import type { PortalResultsCell } from '../ports/portal-results-overview.repository'
import { combineEvidence, sumCells } from './portal-results-aggregate'

const COMPUTED_AT = new Date('2026-10-01T00:00:00.000Z')
const LATER = new Date('2026-10-01T00:05:00.000Z')

function evidence(
  overrides: Partial<MetricPortalMetricEvidence> = {},
): MetricPortalMetricEvidence {
  return {
    definitionVersionId: 'version',
    state: 'ready',
    verifiedThrough: COMPUTED_AT,
    latestActivity: null,
    computedAt: COMPUTED_AT,
    completeness: 1,
    availabilityReason: null,
    correctionHead: null,
    ...overrides,
  }
}

function evidenceSet(
  overrides: Partial<
    Record<keyof MetricPortalMetricEvidenceSet, MetricPortalMetricEvidence>
  > = {},
): MetricPortalMetricEvidenceSet {
  return {
    scans: evidence({ definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal }),
    privateRatings: evidence({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
    }),
    privateFeedback: evidence({
      definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
    }),
    reviewLinkClicks: evidence({
      definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
    }),
    ...overrides,
  }
}

describe('combineEvidence', () => {
  it('is a verified nothing for an empty set of Portals, not a missing figure', () => {
    const combined = combineEvidence([], COMPUTED_AT)

    expect(combined.scans).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      state: 'ready',
      verifiedThrough: COMPUTED_AT,
      completeness: 1,
      availabilityReason: null,
    })
    expect(combined.reviewLinkClicks.definitionVersionId).toBe(
      METRIC_VERSION_IDS.portalDestinationClickAnalytics,
    )
  })

  it('stays ready, verified through the earliest verification, when every Portal is ready', () => {
    const combined = combineEvidence(
      [
        evidenceSet({ scans: evidence({ verifiedThrough: LATER, computedAt: LATER }) }),
        evidenceSet({ scans: evidence({ verifiedThrough: COMPUTED_AT }) }),
      ],
      COMPUTED_AT,
    )

    expect(combined.scans.state).toBe('ready')
    expect(combined.scans.verifiedThrough).toEqual(COMPUTED_AT)
    expect(combined.scans.computedAt).toEqual(LATER)
  })

  it('lets one unavailable Portal make the whole family unavailable, with its reason', () => {
    const combined = combineEvidence(
      [
        evidenceSet(),
        evidenceSet({
          scans: evidence({
            state: 'unavailable',
            verifiedThrough: null,
            availabilityReason: 'projection_missing',
          }),
        }),
        evidenceSet({
          scans: evidence({
            state: 'updating',
            verifiedThrough: null,
            availabilityReason: 'consumer_receipt_pending',
          }),
        }),
      ],
      COMPUTED_AT,
    )

    expect(combined.scans).toMatchObject({
      state: 'unavailable',
      verifiedThrough: null,
      availabilityReason: 'projection_missing',
    })
    // The other families are untouched by it.
    expect(combined.privateRatings.state).toBe('ready')
  })

  it('ranks updating above insufficient and insufficient above ready', () => {
    const insufficient = evidence({
      state: 'insufficient',
      verifiedThrough: null,
      availabilityReason: 'destination_unattributed',
    })
    const updating = evidence({
      state: 'updating',
      verifiedThrough: null,
      availabilityReason: 'consumer_receipt_pending',
    })

    expect(
      combineEvidence(
        [evidenceSet(), evidenceSet({ reviewLinkClicks: insufficient })],
        COMPUTED_AT,
      ).reviewLinkClicks,
    ).toMatchObject({
      state: 'insufficient',
      availabilityReason: 'destination_unattributed',
    })
    expect(
      combineEvidence(
        [
          evidenceSet({ reviewLinkClicks: insufficient }),
          evidenceSet({ reviewLinkClicks: updating }),
        ],
        COMPUTED_AT,
      ).reviewLinkClicks,
    ).toMatchObject({ state: 'updating', availabilityReason: 'consumer_receipt_pending' })
  })

  it('reports the lowest completeness and the latest activity and correction', () => {
    const combined = combineEvidence(
      [
        evidenceSet({
          scans: evidence({
            state: 'updating',
            verifiedThrough: null,
            completeness: 0.75,
            latestActivity: new Date('2026-09-20T00:00:00.000Z'),
            correctionHead: null,
          }),
        }),
        evidenceSet({
          scans: evidence({
            completeness: 1,
            latestActivity: new Date('2026-09-25T00:00:00.000Z'),
            correctionHead: new Date('2026-09-26T00:00:00.000Z'),
          }),
        }),
      ],
      COMPUTED_AT,
    )

    expect(combined.scans.completeness).toBe(0.75)
    expect(combined.scans.latestActivity).toEqual(new Date('2026-09-25T00:00:00.000Z'))
    expect(combined.scans.correctionHead).toEqual(new Date('2026-09-26T00:00:00.000Z'))
  })
})

describe('sumCells', () => {
  const A = portalId('b0000000-0000-4000-8000-00000000000a')
  const B = portalId('b0000000-0000-4000-8000-00000000000b')
  const cell = (
    portal: typeof A,
    metricKey: string,
    total: number,
    count: number,
  ): PortalResultsCell => ({ portalId: portal, groupId: null, metricKey, total, count })

  it('adds totals and counts per metric key', () => {
    expect(
      sumCells([
        cell(A, 'portal.rating', 9, 2),
        cell(B, 'portal.rating', 14, 3),
        cell(A, 'portal.feedback', 1, 1),
      ]),
    ).toEqual([
      { metricKey: 'portal.feedback', total: 1, count: 1 },
      { metricKey: 'portal.rating', total: 23, count: 5 },
    ])
  })

  it('returns no rows for no cells', () => {
    expect(sumCells([])).toEqual([])
  })
})
