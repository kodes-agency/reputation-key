import { describe, it, expect } from 'vitest'
import {
  type BadgeAward,
  type BadgeAwardSnapshot,
  createAward,
  invalidateAward,
  supersedeAward,
  hideAward,
  unhideAward,
  isVisibleTo,
} from './badge-award'

const NOW = new Date('2026-02-15T12:00:00Z')

const snapshot: BadgeAwardSnapshot = {
  definitionName: 'Top Performer',
  definitionPurpose: 'Recognizes consistent quality',
  iconToken: 'trophy',
  thresholdRule: 'score >= 90',
  metricVersion: 'v1',
  audience: 'recipient_and_managers',
}

function makeAward(overrides: Partial<BadgeAward> = {}): BadgeAward {
  const base = createAward({
    id: 'award-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    definitionId: 'def-1',
    definitionVersion: 1,
    recipientStaffParticipationId: 'part-1',
    scopeType: 'portal_group',
    scopeId: 'group-1',
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-02-01'),
    timezone: 'America/New_York',
    sourceWatermark: new Date('2026-02-01'),
    sampleSize: 50,
    opportunitySize: 55,
    completeness: 0.91,
    evidenceSummary: 'Score 92 based on 50 observations',
    evaluatorVersion: 'eval-1',
    snapshot,
    now: NOW,
  })
  return { ...base, ...overrides }
}

describe('BadgeAward', () => {
  describe('createAward', () => {
    it('creates an active award', () => {
      const a = makeAward()
      expect(a.status).toBe('active')
      expect(a.snapshot.definitionName).toBe('Top Performer')
      expect(a.invalidatedAt).toBeNull()
    })
  })

  describe('invalidateAward', () => {
    it('invalidates an active award', () => {
      const a = makeAward()
      const result = invalidateAward(a, 'admin', 'data_correction', NOW, 'corr-1')
      expect(result).toHaveProperty('status', 'invalidated')
      if (!('code' in result)) {
        expect(result.invalidatedAt).toEqual(NOW)
        expect(result.invalidatedBy).toBe('admin')
        expect(result.invalidationReason).toBe('data_correction')
        expect(result.correctionReference).toBe('corr-1')
      }
    })

    it('prevents invalidating an already-invalidated award', () => {
      const a = invalidateAward(makeAward(), 'admin', 'test', NOW) as BadgeAward
      const result = invalidateAward(a, 'admin', 'again', NOW)
      expect(result).toHaveProperty('code', 'already_invalidated')
    })
  })

  describe('supersedeAward', () => {
    it('supersedes an active award', () => {
      const a = makeAward()
      const result = supersedeAward(a, 'award-2')
      expect(result).toHaveProperty('status', 'superseded')
      if (!('code' in result)) {
        expect(result.correctionReference).toBe('award-2')
      }
    })
  })

  describe('hideAward / unhideAward', () => {
    it('hides an active award', () => {
      const a = makeAward()
      const result = hideAward(a, 'part-1', NOW)
      expect(result).toHaveProperty('status', 'hidden')
      if (!('code' in result)) {
        expect(result.hiddenAt).toEqual(NOW)
      }
    })

    it('unhides a hidden award', () => {
      const a = hideAward(makeAward(), 'part-1', NOW) as BadgeAward
      const result = unhideAward(a)
      expect(result).toHaveProperty('status', 'active')
    })

    it('prevents hiding an already-hidden award', () => {
      const a = hideAward(makeAward(), 'part-1', NOW) as BadgeAward
      const result = hideAward(a, 'part-1', NOW)
      expect(result).toHaveProperty('code', 'already_hidden')
    })
  })

  describe('isVisibleTo', () => {
    it('active award visible to all', () => {
      const a = makeAward()
      expect(isVisibleTo(a, 'recipient')).toBe(true)
      expect(isVisibleTo(a, 'manager')).toBe(true)
      expect(isVisibleTo(a, 'other_staff')).toBe(true)
    })

    it('hidden award visible only to recipient', () => {
      const a = hideAward(makeAward(), 'part-1', NOW) as BadgeAward
      expect(isVisibleTo(a, 'recipient')).toBe(true)
      expect(isVisibleTo(a, 'manager')).toBe(false)
      expect(isVisibleTo(a, 'other_staff')).toBe(false)
    })
  })
})
