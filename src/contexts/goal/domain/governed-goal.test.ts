import { describe, expect, it } from 'vitest'
import {
  evaluateGovernedReading,
  validateGoalDefinition,
  type GovernedMetricVersion,
} from './governed-goal'

const approvedCounter: GovernedMetricVersion = {
  definitionId: 'metric-definition-1',
  versionId: 'metric-version-1',
  metricKey: 'portal.content_review.completed',
  valueKind: 'counter',
  allowedScopes: ['property', 'portal_group'],
  sourcePolicyAllowlist: ['portal_manager_action'],
  permittedConsumers: ['goal'],
  minimumSample: 1,
  employmentDecisionEligible: false,
}

describe('governed Goal definitions', () => {
  it('accepts only property and portal-group scopes with governed goal-safe metrics', () => {
    expect(
      validateGoalDefinition({
        scope: { kind: 'portal_group', portalGroupId: 'group-1' },
        measureKind: 'progress',
        targetValue: 5,
        metric: approvedCounter,
        sourcePolicy: 'portal_manager_action',
      }),
    ).toEqual({ ok: true })
  })

  it('rejects an individual portal target and employment-decision metric', () => {
    expect(
      validateGoalDefinition({
        scope: { kind: 'portal', portalId: 'portal-1' },
        measureKind: 'progress',
        targetValue: 5,
        metric: approvedCounter,
        sourcePolicy: 'portal_manager_action',
      }),
    ).toEqual({ ok: false, reason: 'scope_not_allowed' })

    expect(
      validateGoalDefinition({
        scope: { kind: 'property' },
        measureKind: 'progress',
        targetValue: 5,
        metric: { ...approvedCounter, employmentDecisionEligible: true },
        sourcePolicy: 'portal_manager_action',
      }),
    ).toEqual({ ok: false, reason: 'metric_not_goal_eligible' })
  })
})

describe('governed Goal evaluation', () => {
  it('does not turn unavailable, quarantined, or insufficient readings into zero', () => {
    const base = {
      measureKind: 'ratio' as const,
      targetValue: 0.8,
      minimumSample: 5,
      sourcePolicy: 'portal_configuration',
    }

    expect(evaluateGovernedReading({ ...base, reading: null })).toEqual({
      state: 'unavailable',
      reason: 'reading_unavailable',
      value: null,
      numerator: null,
      denominator: null,
      sampleCount: null,
      achieved: false,
    })
    expect(
      evaluateGovernedReading({
        ...base,
        reading: {
          dataQuality: 'quarantined',
          exactValue: null,
          numerator: null,
          denominator: null,
          sampleCount: null,
          sourcePolicy: 'portal_configuration',
        },
      }).state,
    ).toBe('quarantined')
    expect(
      evaluateGovernedReading({
        ...base,
        reading: {
          dataQuality: 'eligible',
          exactValue: 1,
          numerator: 4,
          denominator: 4,
          sampleCount: 4,
          sourcePolicy: 'portal_configuration',
        },
      }),
    ).toMatchObject({ state: 'insufficient_data', value: null, achieved: false })
  })

  it('evaluates ratio from numerator and denominator instead of a guessed value', () => {
    expect(
      evaluateGovernedReading({
        measureKind: 'ratio',
        targetValue: 0.8,
        minimumSample: 5,
        sourcePolicy: 'portal_configuration',
        reading: {
          dataQuality: 'eligible',
          exactValue: 999,
          numerator: 8,
          denominator: 10,
          sampleCount: 10,
          sourcePolicy: 'portal_configuration',
        },
      }),
    ).toEqual({
      state: 'eligible',
      reason: null,
      value: 0.8,
      numerator: 8,
      denominator: 10,
      sampleCount: 10,
      achieved: true,
    })
  })
})
