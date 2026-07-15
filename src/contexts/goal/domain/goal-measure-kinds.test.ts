import { describe, it, expect } from 'vitest'
import {
  evaluateProgressGoal,
  evaluateLevelGoal,
  evaluateRatioGoal,
  applyCorrectionToPeriod,
  type GoalPeriod,
} from './goal-measure-kinds'

describe('Goal measure-kind semantics', () => {
  describe('evaluateProgressGoal', () => {
    it('achieves when value >= target', () => {
      const result = evaluateProgressGoal(25, 20, 10, 5, false)
      expect(result.achieved).toBe(true)
      expect(result.result).toBe('achieved')
    })

    it('pending when below target and period open', () => {
      const result = evaluateProgressGoal(15, 20, 10, 5, false)
      expect(result.achieved).toBe(false)
      expect(result.result).toBe('pending')
    })

    it('not_achieved when below target and period closed', () => {
      const result = evaluateProgressGoal(15, 20, 10, 5, true)
      expect(result.achieved).toBe(false)
      expect(result.result).toBe('not_achieved')
    })

    it('insufficient_data when sample below minimum and closed', () => {
      const result = evaluateProgressGoal(25, 20, 3, 5, true)
      expect(result.result).toBe('insufficient_data')
    })
  })

  describe('evaluateLevelGoal', () => {
    it('met when current >= target with enough sample', () => {
      const result = evaluateLevelGoal(4.5, 4.0, 50, 5, false)
      expect(result.met).toBe(true)
    })

    it('pending when below target and period open', () => {
      const result = evaluateLevelGoal(3.5, 4.0, 50, 5, false)
      expect(result.met).toBe(false)
      expect(result.result).toBe('pending')
    })

    it('not_met when below target and period closed', () => {
      const result = evaluateLevelGoal(3.5, 4.0, 50, 5, true)
      expect(result.result).toBe('not_achieved')
    })

    it('insufficient_data when value is null', () => {
      const result = evaluateLevelGoal(null, 4.0, 50, 5, true)
      expect(result.result).toBe('insufficient_data')
    })

    it('does not permanently complete on first crossing', () => {
      // Level goals are met/not_met for a period, not permanently complete
      const open = evaluateLevelGoal(4.5, 4.0, 50, 5, false)
      expect(open.result).toBe('pending')
      const closed = evaluateLevelGoal(4.5, 4.0, 50, 5, true)
      expect(closed.result).toBe('achieved')
    })
  })

  describe('evaluateRatioGoal', () => {
    it('achieved when ratio >= target with enough sample', () => {
      const result = evaluateRatioGoal(90, 100, 0.85, 10, true)
      expect(result.ratio).toBe(0.9)
      expect(result.achieved).toBe(true)
      expect(result.result).toBe('achieved')
    })

    it('insufficient_data when denominator below minimum', () => {
      const result = evaluateRatioGoal(9, 10, 0.85, 15, true)
      expect(result.ratio).toBeNull()
      expect(result.result).toBe('insufficient_data')
    })

    it('not_achieved when ratio below target and closed', () => {
      const result = evaluateRatioGoal(70, 100, 0.85, 10, true)
      expect(result.ratio).toBe(0.7)
      expect(result.result).toBe('not_achieved')
    })

    it('insufficient data is never zero', () => {
      const result = evaluateRatioGoal(0, 0, 0.85, 10, true)
      expect(result.result).toBe('insufficient_data')
      expect(result.ratio).toBeNull()
    })
  })

  describe('applyCorrectionToPeriod', () => {
    it('changes outcome to invalidated', () => {
      const period: GoalPeriod = {
        id: 'period-1',
        definitionId: 'def-1',
        definitionVersion: 1,
        organizationId: 'org-1',
        propertyId: 'prop-1',
        portalGroupId: null,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-02-01'),
        timezone: 'America/New_York',
        baseline: null,
        targetSnapshot: 20,
        status: 'closed',
        outcome: 'achieved',
      }
      const result = applyCorrectionToPeriod(period, 'invalidated')
      expect(result.outcome).toBe('invalidated')
    })
  })
})
