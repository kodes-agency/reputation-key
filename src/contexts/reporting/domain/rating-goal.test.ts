import { describe, expect, it } from 'vitest'
import {
  isRatingGoalError,
  ratingGoalError,
  planChanges,
  paceProblem,
  planQualityProblem,
  targetProblem,
} from './rating-goal'

describe('the target a rating goal may hold', () => {
  it('climbs to a tenth above what Google shows, up to 4.9', () => {
    expect(targetProblem('climb', 44, 43)).toBeNull()
    expect(targetProblem('climb', 49, 43)).toBeNull()
    expect(targetProblem('climb', 43, 43)).toBe('invalid_target')
    expect(targetProblem('climb', 50, 43)).toBe('invalid_target')
    expect(targetProblem('climb', 44.5, 43)).toBe('invalid_target')
  })

  it('keeps a tenth Google shows now, or a lower one, including 5.0', () => {
    expect(targetProblem('keep', 50, 50)).toBeNull()
    expect(targetProblem('keep', 49, 49)).toBeNull()
    expect(targetProblem('keep', 48, 49)).toBeNull()
    expect(targetProblem('keep', 50, 49)).toBe('invalid_target')
    expect(targetProblem('keep', 9, 49)).toBe('invalid_target')
  })

  it('keeps nothing while Google shows less than 4.9 (round 2, R2-9)', () => {
    expect(targetProblem('keep', 48, 48)).toBe('invalid_target')
    expect(targetProblem('keep', 45, 46)).toBe('invalid_target')
  })
})

describe('the pace a rating goal may hold', () => {
  it('needs a whole weekly pace from 1 to 200 to climb, and none to keep', () => {
    expect(paceProblem('climb', 11)).toBeNull()
    expect(paceProblem('climb', null)).toBe('invalid_pace')
    expect(paceProblem('climb', 201)).toBe('invalid_pace')
    expect(paceProblem('keep', null)).toBeNull()
    expect(paceProblem('keep', 5)).toBe('invalid_pace')
  })
})

describe('the planned quality a rating goal may hold', () => {
  it('needs a quality that clears the target’s threshold by 0.15★ to climb', () => {
    expect(planQualityProblem('climb', 40, 41)).toBeNull()
    expect(planQualityProblem('climb', 40, 40)).toBe('invalid_quality')
    expect(planQualityProblem('climb', 40, null)).toBe('invalid_quality')
  })

  it('has none to keep', () => {
    expect(planQualityProblem('keep', 49, null)).toBeNull()
    expect(planQualityProblem('keep', 49, 50)).toBe('invalid_quality')
  })
})

describe('the change log rows a change writes', () => {
  const current = {
    mode: 'climb',
    targetTenths: 45,
    qualityTenths: 47,
    pacePerWeek: 11,
  } as const

  it('writes one row per changed field, old to new, as text', () => {
    expect(
      planChanges(current, {
        ...current,
        targetTenths: 46,
        qualityTenths: 48,
        pacePerWeek: 14,
      }),
    ).toEqual([
      { field: 'target', oldValue: '45', newValue: '46' },
      { field: 'quality', oldValue: '47', newValue: '48' },
      { field: 'pace', oldValue: '11', newValue: '14' },
    ])
  })

  it('logs the quality and the pace leaving when a goal switches to keep', () => {
    expect(
      planChanges(current, {
        mode: 'keep',
        targetTenths: 45,
        qualityTenths: null,
        pacePerWeek: null,
      }),
    ).toEqual([
      { field: 'mode', oldValue: 'climb', newValue: 'keep' },
      { field: 'quality', oldValue: '47', newValue: null },
      { field: 'pace', oldValue: '11', newValue: null },
    ])
  })

  it('writes nothing for an unchanged plan', () => {
    expect(planChanges(current, current)).toEqual([])
  })
})

describe('rating goal errors', () => {
  it('carry an enumerable tag and code', () => {
    const error = ratingGoalError(
      'goal_exists',
      'This Property already has a rating goal',
    )

    expect(isRatingGoalError(error)).toBe(true)
    expect(error).toBeInstanceOf(Error)
    expect({ ...error }).toMatchObject({ _tag: 'RatingGoalError', code: 'goal_exists' })
    expect(isRatingGoalError(new Error('goal_exists'))).toBe(false)
  })
})
