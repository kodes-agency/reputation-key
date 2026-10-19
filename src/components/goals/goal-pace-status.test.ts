import { describe, expect, it } from 'vitest'
import { GOAL_PACE_STATUS } from './goal-pace-status'
import { RATING_GOAL_STATUS } from './rating-goal-view'

describe('GOAL_PACE_STATUS', () => {
  it('names the three paces once, each with its tone', () => {
    expect(GOAL_PACE_STATUS).toEqual({
      getting_started: { label: 'Getting started', tone: 'neutral' },
      on_pace: { label: 'On pace', tone: 'positive' },
      below_pace: { label: 'Below pace', tone: 'warn' },
    })
  })

  it('is the Google rating goal’s own pace pill, not a copy of it', () => {
    expect(RATING_GOAL_STATUS.getting_started).toBe(GOAL_PACE_STATUS.getting_started)
    expect(RATING_GOAL_STATUS.on_pace).toBe(GOAL_PACE_STATUS.on_pace)
    expect(RATING_GOAL_STATUS.below_pace).toBe(GOAL_PACE_STATUS.below_pace)
  })
})
