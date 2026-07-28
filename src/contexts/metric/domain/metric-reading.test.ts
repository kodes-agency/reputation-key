import { describe, it, expect } from 'vitest'
import {
  type MetricReading,
  createReading,
  findDuplicate,
  getEffectiveValue,
  type MetricCorrection,
} from './metric-reading'

describe('MetricReading', () => {
  const NOW = new Date('2026-01-16T00:00:00Z')

  function makeReadingParams(
    overrides: Partial<Parameters<typeof createReading>[0]> = {},
  ): Parameters<typeof createReading>[0] {
    return {
      id: 'read-1',
      definitionVersionId: 'ver-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      value: 42,
      sampleSize: 10,
      sourceEventId: 'evt-1',
      sourceSchema: 'v1',
      occurredAt: new Date('2026-01-15'),
      propertyLocalDate: '2026-01-15',
      attributionQuality: 'exact',
      retentionClass: 'standard',
      now: NOW,
      ...overrides,
    }
  }

  describe('createReading', () => {
    it('creates a reading with all fields', () => {
      const r = createReading(makeReadingParams())
      expect(r.value).toBe(42)
      expect(r.recordedAt).toEqual(NOW)
      expect(r.correctedBy).toBeNull()
    })
  })

  describe('findDuplicate', () => {
    it('finds duplicate by definition version and source event', () => {
      const r = createReading(makeReadingParams())
      const dup = findDuplicate([r], 'ver-1', 'evt-1', null)
      expect(dup?.id).toBe('read-1')
    })

    it('returns null when no duplicate', () => {
      const r = createReading(makeReadingParams())
      const dup = findDuplicate([r], 'ver-1', 'evt-2', null)
      expect(dup).toBeNull()
    })

    it('respects portal_id in idempotency key', () => {
      const r = createReading(makeReadingParams({ portalId: 'portal-1' }))
      // Same event but different portal is not a duplicate
      expect(findDuplicate([r], 'ver-1', 'evt-1', 'portal-2')).toBeNull()
      // Same event and same portal is a duplicate
      expect(findDuplicate([r], 'ver-1', 'evt-1', 'portal-1')?.id).toBe('read-1')
    })
  })

  describe('getEffectiveValue', () => {
    const baseReading: MetricReading = {
      id: 'read-1',
      definitionVersionId: 'ver-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalGroupId: null,
      portalId: null,
      value: 42,
      numerator: null,
      denominator: null,
      duration: null,
      sampleSize: 10,
      sourceEventId: 'evt-1',
      sourceSchema: 'v1',
      occurredAt: new Date('2026-01-15'),
      recordedAt: new Date('2026-01-15'),
      propertyLocalDate: '2026-01-15',
      attributionQuality: 'exact',
      dataQuality: 'exact',
      retentionClass: 'standard',
      correctedBy: null,
    }

    it('returns original value when no correction', () => {
      expect(getEffectiveValue(baseReading, [])).toBe(42)
    })

    it('returns null for retraction', () => {
      const correction: MetricCorrection = {
        id: 'corr-1',
        correctedReadingId: 'read-1',
        kind: 'retract',
        reason: 'source_error',
        actor: 'system',
        replacementValue: null,
        occurredAt: new Date(),
        recordedAt: new Date(),
        supersededBy: null,
      }
      const reading = { ...baseReading, correctedBy: 'corr-1' }
      expect(getEffectiveValue(reading, [correction])).toBeNull()
    })

    it('returns replacement value for replace', () => {
      const correction: MetricCorrection = {
        id: 'corr-1',
        correctedReadingId: 'read-1',
        kind: 'replace',
        reason: 'data_correction',
        actor: 'admin',
        replacementValue: 50,
        occurredAt: new Date(),
        recordedAt: new Date(),
        supersededBy: null,
      }
      const reading = { ...baseReading, correctedBy: 'corr-1' }
      expect(getEffectiveValue(reading, [correction])).toBe(50)
    })

    it('returns adjusted value for adjust', () => {
      const correction: MetricCorrection = {
        id: 'corr-1',
        correctedReadingId: 'read-1',
        kind: 'adjust',
        reason: 'late_arrival',
        actor: 'system',
        replacementValue: 5,
        occurredAt: new Date(),
        recordedAt: new Date(),
        supersededBy: null,
      }
      const reading = { ...baseReading, correctedBy: 'corr-1' }
      expect(getEffectiveValue(reading, [correction])).toBe(47) // 42 + 5
    })
  })
})
