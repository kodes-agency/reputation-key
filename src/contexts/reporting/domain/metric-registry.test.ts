import { describe, it, expect } from 'vitest'
import {
  type MetricRegistryEntry,
  type MetricDefinitionVersion,
  getActiveVersion,
  isSourcePolicyAllowed,
  isConsumerPermitted,
  isScopeAllowed,
  evaluateInsufficientData,
  isGamificationViolation,
  METRIC_DEFINITIONS,
  METRIC_VERSION_IDS,
  findMetricVersionById,
} from './metric-registry'

function makeVersion(
  overrides: Partial<MetricDefinitionVersion> = {},
): MetricDefinitionVersion {
  return {
    id: 'ver-1',
    definitionId: 'def-1',
    version: 1,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    numeratorDescription: 'count of events',
    denominatorDescription: null,
    unit: 'count',
    precision: 0,
    aggregationRule: 'sum',
    lateArrivalRule: 'accept_within_7_days',
    allowedScopes: ['property', 'portal_group'],
    attributionRule: 'event_time',
    minimumSample: 5,
    insufficientDataBehavior: 'unavailable',
    sourcePolicyAllowlist: ['first_party_workflow'],
    permittedConsumers: ['dashboard', 'goal'],
    employmentDecisionEligible: false as const,
    correctionBehavior: 'append_only',
    fairnessReviewStatus: 'approved',
    ...overrides,
  }
}

function makeEntry(
  versions: MetricDefinitionVersion[] = [makeVersion()],
): MetricRegistryEntry {
  return {
    definition: {
      id: 'def-1',
      key: 'portal.content_review.completed',
      name: 'Test Metric',
      description: 'A test metric',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'standard',
      retentionClass: 'standard',
      lifecycleStatus: 'approved',
      approvalOwner: 'owner-1',
    },
    versions,
  }
}

describe('MetricRegistry', () => {
  describe('getActiveVersion', () => {
    it('returns the active version', () => {
      const entry = makeEntry()
      const result = getActiveVersion(entry, new Date('2026-02-01'))
      expect(result?.version).toBe(1)
    })

    it('returns the most recent active version', () => {
      const entry = makeEntry([
        makeVersion({ version: 1, effectiveTo: new Date('2026-06-01') }),
        makeVersion({ id: 'ver-2', version: 2, effectiveFrom: new Date('2026-06-01') }),
      ])
      const result = getActiveVersion(entry, new Date('2026-07-01'))
      expect(result?.version).toBe(2)
    })

    it('returns null when no version covers the date', () => {
      const entry = makeEntry([makeVersion({ effectiveFrom: new Date('2027-01-01') })])
      const result = getActiveVersion(entry, new Date('2026-01-01'))
      expect(result).toBeNull()
    })
  })

  describe('isSourcePolicyAllowed', () => {
    it('returns true for allowed source', () => {
      const v = makeVersion()
      expect(isSourcePolicyAllowed(v, 'first_party_workflow')).toBe(true)
    })

    it('returns false for disallowed source', () => {
      const v = makeVersion()
      expect(isSourcePolicyAllowed(v, 'google_property_derivative')).toBe(false)
    })
  })

  describe('isConsumerPermitted', () => {
    it('returns true for permitted consumer', () => {
      const v = makeVersion()
      expect(isConsumerPermitted(v, 'dashboard')).toBe(true)
    })

    it('returns false for non-permitted consumer', () => {
      const v = makeVersion()
      expect(isConsumerPermitted(v, 'notification')).toBe(false)
    })
  })

  describe('isScopeAllowed', () => {
    it('returns true for allowed scope', () => {
      const v = makeVersion()
      expect(isScopeAllowed(v, 'property')).toBe(true)
    })

    it('returns false for non-allowed scope', () => {
      const v = makeVersion()
      expect(isScopeAllowed(v, 'portal')).toBe(false)
    })
  })

  describe('evaluateInsufficientData', () => {
    it('returns not insufficient when sample meets minimum', () => {
      const v = makeVersion({ minimumSample: 5 })
      const result = evaluateInsufficientData(v, 10)
      expect(result.insufficient).toBe(false)
    })

    it('returns unavailable when sample below minimum', () => {
      const v = makeVersion({ minimumSample: 5, insufficientDataBehavior: 'unavailable' })
      const result = evaluateInsufficientData(v, 3)
      expect(result.insufficient).toBe(true)
      expect(result.result).toBeNull()
    })

    it('never substitutes zero when insufficient data must be quarantined', () => {
      const v = makeVersion({ minimumSample: 5, insufficientDataBehavior: 'quarantine' })
      const result = evaluateInsufficientData(v, 3)
      expect(result).toEqual({
        insufficient: true,
        behavior: 'quarantine',
        result: null,
      })
    })
  })

  describe('isGamificationViolation', () => {
    it('returns true when google source is used for goals', () => {
      const v = makeVersion({
        sourcePolicyAllowlist: ['google_property_derivative'],
        permittedConsumers: ['dashboard', 'goal'],
      })
      expect(isGamificationViolation(v)).toBe(true)
    })

    it('returns true when review-solicitation source feeds a Goal', () => {
      const v = makeVersion({
        sourcePolicyAllowlist: ['review_solicitation_analytics_only'],
        permittedConsumers: ['goal'],
      })
      expect(isGamificationViolation(v)).toBe(true)
    })

    it('returns false when google source is used for dashboard only', () => {
      const v = makeVersion({
        sourcePolicyAllowlist: ['google_property_derivative'],
        permittedConsumers: ['dashboard'],
      })
      expect(isGamificationViolation(v)).toBe(false)
    })

    it('returns false for first-party workflow used for goals', () => {
      const v = makeVersion({
        sourcePolicyAllowlist: ['first_party_workflow'],
        permittedConsumers: ['goal'],
      })
      expect(isGamificationViolation(v)).toBe(false)
    })

    it('allows de-identified Guest Gateway numeric facts for goals', () => {
      const v = makeVersion({
        sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
        permittedConsumers: ['dashboard', 'goal'],
      })
      expect(isGamificationViolation(v)).toBe(false)
    })
  })

  describe('catalogue', () => {
    it('permits no retired consumer on any version', () => {
      // Badge and Leaderboard are retired contexts (root CONTEXT.md). Re-admitting
      // either as a metric consumer needs its own review, not a re-seed of old data.
      const retired: readonly string[] = ['badge', 'leaderboard']
      const permitted = METRIC_DEFINITIONS.flatMap(({ versions }) =>
        versions.flatMap((version) => version.permittedConsumers),
      )

      expect(permitted.filter((consumer) => retired.includes(consumer))).toEqual([])
    })

    it('admits all five Portal results measures at Portal, Group and Property scope', () => {
      // Owner decision 2 (2026-09-30): group rows, group pages and totals show
      // all five measures, so no measure may be Portal-only in the registry.
      const resultsMeasures = [
        METRIC_VERSION_IDS.qualifiedScanGoal,
        METRIC_VERSION_IDS.portalRatingAnalytics,
        METRIC_VERSION_IDS.portalRatingCountGoal,
        METRIC_VERSION_IDS.portalRatingAverageGoal,
        METRIC_VERSION_IDS.portalDestinationClickAnalytics,
        METRIC_VERSION_IDS.portalFeedbackAnalytics,
      ]

      for (const versionId of resultsMeasures) {
        const governed = findMetricVersionById(versionId)
        expect(governed, versionId).not.toBeNull()
        const scopes = governed?.version.allowedScopes ?? []
        expect([...scopes].sort(), versionId).toEqual([
          'portal',
          'portal_group',
          'property',
        ])
      }
    })

    it('counts the Immersive Hub fields under their own completeness version', () => {
      const legacy = findMetricVersionById(METRIC_VERSION_IDS.configurationCompleteness)
      const immersive = findMetricVersionById(
        METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
      )

      expect(immersive?.definition.key).toBe('portal.configuration_completeness')
      expect(immersive?.version).toMatchObject({
        version: 3,
        definitionId: legacy?.version.definitionId,
        effectiveFrom: new Date('2026-10-02T00:00:00.000Z'),
        effectiveTo: null,
        unit: 'percent',
        permittedConsumers: legacy?.version.permittedConsumers,
      })
      // The legacy count keeps its meaning, and stays open for facts recorded before.
      expect(legacy?.version).toMatchObject({
        version: 1,
        effectiveTo: null,
        numeratorDescription: 'Published required fields present',
      })
    })

    it('keeps the widened measures private to Portal analytics', () => {
      // Widening the scope is not widening the audience.
      const widened = [
        METRIC_VERSION_IDS.portalRatingAnalytics,
        METRIC_VERSION_IDS.portalDestinationClickAnalytics,
        METRIC_VERSION_IDS.portalFeedbackAnalytics,
      ]
      for (const versionId of widened) {
        expect(findMetricVersionById(versionId)?.version.permittedConsumers).toEqual([
          'portal_analytics',
        ])
      }
    })
  })
})
