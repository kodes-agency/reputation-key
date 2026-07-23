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
      key: 'test_metric',
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
      expect(isConsumerPermitted(v, 'badge')).toBe(false)
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

    it('returns zero when behavior is zero', () => {
      const v = makeVersion({ minimumSample: 5, insufficientDataBehavior: 'zero' })
      const result = evaluateInsufficientData(v, 3)
      expect(result.insufficient).toBe(true)
      expect(result.result).toBe(0)
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

    it('returns true when review-solicitation source is used for badges', () => {
      const v = makeVersion({
        sourcePolicyAllowlist: ['review_solicitation_analytics_only'],
        permittedConsumers: ['badge'],
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
  })
})
