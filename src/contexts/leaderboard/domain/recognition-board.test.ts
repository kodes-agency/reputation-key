import { describe, it, expect } from 'vitest'
import {
  type BoardEntry,
  computeRanks,
  evaluateEligibility,
  validateBoardConfig,
  MINIMUM_COHORT_SIZE,
  MINIMUM_OBSERVATIONS_PER_TARGET,
} from './recognition-board'

function makeEntry(overrides: Partial<BoardEntry> = {}): BoardEntry {
  return {
    snapshotId: 'snap-1',
    subjectId: 'sub-1',
    subjectLabel: 'Subject 1',
    value: 50,
    numerator: null,
    denominator: null,
    sampleSize: 20,
    opportunitySize: 25,
    rank: null,
    tieGroup: null,
    eligibility: 'ranked',
    exclusionReason: null,
    presentationRef: 'group-1',
    ...overrides,
  }
}

describe('RecognitionBoard', () => {
  describe('computeRanks', () => {
    it('assigns ranks in descending value order', () => {
      const entries = [
        makeEntry({ subjectId: 'a', value: 90 }),
        makeEntry({ subjectId: 'b', value: 70 }),
        makeEntry({ subjectId: 'c', value: 50 }),
      ]
      const result = computeRanks(entries)
      expect(result.find((e) => e.subjectId === 'a')?.rank).toBe(1)
      expect(result.find((e) => e.subjectId === 'b')?.rank).toBe(2)
      expect(result.find((e) => e.subjectId === 'c')?.rank).toBe(3)
    })

    it('ties share the same rank', () => {
      const entries = [
        makeEntry({ subjectId: 'a', value: 90 }),
        makeEntry({ subjectId: 'b', value: 90 }),
        makeEntry({ subjectId: 'c', value: 70 }),
      ]
      const result = computeRanks(entries)
      expect(result.find((e) => e.subjectId === 'a')?.rank).toBe(1)
      expect(result.find((e) => e.subjectId === 'b')?.rank).toBe(1)
      expect(result.find((e) => e.subjectId === 'c')?.rank).toBe(3)
    })

    it('does not rank ineligible entries', () => {
      const entries = [
        makeEntry({ subjectId: 'a', value: 90 }),
        makeEntry({
          subjectId: 'b',
          value: 50,
          eligibility: 'unranked_insufficient_sample',
        }),
      ]
      const result = computeRanks(entries)
      expect(result.find((e) => e.subjectId === 'a')?.rank).toBe(1)
      expect(result.find((e) => e.subjectId === 'b')?.rank).toBeNull()
    })
  })

  describe('evaluateEligibility', () => {
    it('ranked when sufficient sample and cohort', () => {
      expect(
        evaluateEligibility(
          MINIMUM_OBSERVATIONS_PER_TARGET,
          50,
          MINIMUM_COHORT_SIZE,
          false,
        ),
      ).toBe('ranked')
    })

    it('unranked when cohort too small', () => {
      expect(evaluateEligibility(50, 50, MINIMUM_COHORT_SIZE - 1, false)).toBe(
        'unranked_insufficient_sample',
      )
    })

    it('unranked when sample too small', () => {
      expect(
        evaluateEligibility(MINIMUM_OBSERVATIONS_PER_TARGET - 1, 50, 10, false),
      ).toBe('unranked_insufficient_sample')
    })

    it('unranked when reconciling', () => {
      expect(evaluateEligibility(50, 50, 10, true)).toBe('unranked_reconciling')
    })

    it('ineligible when no opportunity', () => {
      expect(evaluateEligibility(50, 0, 10, false)).toBe('unranked_ineligible')
    })
  })

  describe('validateBoardConfig', () => {
    it('allows weekly period', () => {
      expect(
        validateBoardConfig({ periodKind: 'weekly', subjectType: 'portal_group' }),
      ).toHaveLength(0)
    })

    it('allows monthly period', () => {
      expect(
        validateBoardConfig({ periodKind: 'monthly', subjectType: 'portal_group' }),
      ).toHaveLength(0)
    })

    it('rejects all_time period', () => {
      const errors = validateBoardConfig({
        periodKind: 'all_time' as never,
        subjectType: 'portal_group',
      })
      expect(errors).toContain('all_time period is not allowed')
    })
  })
})
