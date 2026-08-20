import { describe, expect, it } from 'vitest'
import {
  evaluateRecognitionBoard,
  isRecognitionMetricEligible,
  transitionRecognitionActivation,
  type GovernedRecognitionMetric,
  type RecognitionCandidate,
} from './governed-recognition'

const SAFE_METRIC: GovernedRecognitionMetric = {
  definitionId: 'def-1',
  definitionVersionId: 'version-1',
  metricKey: 'portal.approved_destination_ratio',
  aggregation: 'ratio',
  allowedScopes: ['portal_group'],
  sourcePolicyAllowlist: ['portal.configuration'],
  permittedConsumers: ['recognition'],
  employmentDecisionEligible: false,
  minimumSample: 5,
}

function candidate(overrides: Partial<RecognitionCandidate> = {}): RecognitionCandidate {
  return {
    portalGroupId: 'group-1',
    portalGroupLabel: 'Lobby portals',
    exactValue: 80,
    numerator: 8,
    denominator: 10,
    sampleCount: 10,
    exposureCount: 10,
    sourceWatermark: new Date('2026-08-09T10:00:00.000Z'),
    completeness: 1,
    correctionGeneration: 0,
    ...overrides,
  }
}

describe('governed recognition', () => {
  it.each([
    ['portal.rating', 'guest.response'],
    ['portal.review_text', 'guest.response'],
    ['portal.named_mention', 'review.provider'],
    ['portal.scan', 'portal.analytics'],
    ['portal.review_link_click', 'portal.analytics'],
    ['ai.sentiment', 'ai.generated'],
    ['google.review_count', 'google.business_profile'],
  ])('rejects prohibited metric %s', (metricKey, sourcePolicy) => {
    expect(
      isRecognitionMetricEligible({
        ...SAFE_METRIC,
        metricKey,
        sourcePolicyAllowlist: [sourcePolicy],
      }),
    ).toEqual({ eligible: false, reason: 'prohibited_metric' })
  })

  it('rejects worker and employment-decision metrics even with an allowed key', () => {
    expect(
      isRecognitionMetricEligible({
        ...SAFE_METRIC,
        employmentDecisionEligible: true,
      }),
    ).toEqual({ eligible: false, reason: 'employment_decision_metric' })
    expect(
      isRecognitionMetricEligible({
        ...SAFE_METRIC,
        sourcePolicyAllowlist: ['worker.performance'],
      }),
    ).toEqual({ eligible: false, reason: 'prohibited_source' })
  })

  it('ranks only portal groups, preserves ties, and exposes no individual identity', () => {
    const board = evaluateRecognitionBoard({
      metric: SAFE_METRIC,
      candidates: [
        candidate({ portalGroupId: 'a', exactValue: 80 }),
        candidate({ portalGroupId: 'b', exactValue: 80 }),
        candidate({ portalGroupId: 'c', exactValue: 60 }),
      ],
      minimumExposure: 5,
      minimumCompleteness: 0.9,
      freshAfter: new Date('2026-08-09T09:00:00.000Z'),
    })

    expect(
      board.map(({ portalGroupId, rank, tieGroup }) => ({
        portalGroupId,
        rank,
        tieGroup,
      })),
    ).toEqual([
      { portalGroupId: 'a', rank: 1, tieGroup: 1 },
      { portalGroupId: 'b', rank: 1, tieGroup: 1 },
      { portalGroupId: 'c', rank: 3, tieGroup: 2 },
    ])
    expect(JSON.stringify(board)).not.toMatch(/user|staff|employee|recipient/i)
  })

  it('reports insufficient sample, exposure, freshness, and completeness instead of zero', () => {
    const [sample, exposure, stale, incomplete] = evaluateRecognitionBoard({
      metric: SAFE_METRIC,
      candidates: [
        candidate({ portalGroupId: 'sample', sampleCount: 4 }),
        candidate({ portalGroupId: 'exposure', exposureCount: 4 }),
        candidate({
          portalGroupId: 'stale',
          sourceWatermark: new Date('2026-08-09T08:59:59.000Z'),
        }),
        candidate({ portalGroupId: 'incomplete', completeness: 0.89 }),
      ],
      minimumExposure: 5,
      minimumCompleteness: 0.9,
      freshAfter: new Date('2026-08-09T09:00:00.000Z'),
    })

    expect(sample).toMatchObject({
      value: null,
      rank: null,
      eligibilityReason: 'insufficient_sample',
    })
    expect(exposure).toMatchObject({
      value: null,
      rank: null,
      eligibilityReason: 'insufficient_exposure',
    })
    expect(stale).toMatchObject({ value: null, rank: null, eligibilityReason: 'stale' })
    expect(incomplete).toMatchObject({
      value: null,
      rank: null,
      eligibilityReason: 'incomplete',
    })
  })

  it('returns correction state without erasing prior facts', () => {
    const [entry] = evaluateRecognitionBoard({
      metric: SAFE_METRIC,
      candidates: [candidate({ correctionGeneration: 2 })],
      minimumExposure: 5,
      minimumCompleteness: 0.9,
      freshAfter: new Date('2026-08-09T09:00:00.000Z'),
    })
    expect(entry).toMatchObject({ status: 'corrected', correctionGeneration: 2 })
  })

  it('requires acknowledged manager activation and deactivates with a reason', () => {
    const activated = transitionRecognitionActivation(null, {
      kind: 'activate',
      organizationId: 'org-1',
      propertyId: 'property-1',
      policyVersion: 'beta-local-1',
      jurisdiction: 'US-CA',
      noticeStatus: 'completed',
      consultationStatus: 'not_required',
      audience: 'property_managers_and_scoped_staff',
      acknowledgedBy: 'manager-1',
      selectedPortalGroupIds: ['group-1'],
      metricDefinitionVersionId: 'version-1',
      aggregation: 'ratio',
      periodKind: 'monthly',
      minimumExposure: 5,
      minimumSample: 5,
      freshnessSeconds: 3_600,
      minimumCompleteness: 0.9,
      now: new Date('2026-08-09T10:00:00.000Z'),
    })
    expect(activated).toMatchObject({
      status: 'active',
      metricDefinitionVersionId: 'version-1',
      aggregation: 'ratio',
      periodKind: 'monthly',
      employmentDecisionEligible: false,
    })

    expect(
      transitionRecognitionActivation(activated, {
        kind: 'deactivate',
        reason: 'consultation_withdrawn',
        actorId: 'manager-1',
        now: new Date('2026-08-09T11:00:00.000Z'),
      }),
    ).toMatchObject({ status: 'inactive', deactivationReason: 'consultation_withdrawn' })
  })
})
