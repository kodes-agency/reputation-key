import { describe, expect, it } from 'vitest'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { goalRefusal } from './goal-refusal'
import {
  CARD_LAST_MONTH_UPDATING,
  CARD_RUNNING,
} from './portal-goal-running.stories.fixtures'
import { CARD_SCHEDULED } from './portal-goal.stories.fixtures'
import { PORTAL_STOP_REFUSALS, stopWords } from './portal-goal-stop-view'

const goalOf = (card: PortalGoalCardView) => {
  if (card.state !== 'goal') throw new Error('expected a goal')
  return card.goal
}

describe('stopWords', () => {
  it('a running goal keeps its month and its result', () => {
    expect(stopWords(goalOf(CARD_RUNNING))).toEqual({
      title: 'Stop the monthly portal goal?',
      description:
        'November keeps counting to Nov 30 and keeps its result. You can set a new goal from December.',
      cancel: 'Keep the goal',
      confirm: 'Stop the goal',
    })
  })

  it('December runs on Dec 1: it counts to Dec 31, and the next goal is from January', () => {
    expect(stopWords(goalOf(CARD_LAST_MONTH_UPDATING)).description).toBe(
      'December keeps counting to Dec 31 and keeps its result. You can set a new goal from January.',
    )
  })

  it('a goal that has not started frees its month at once', () => {
    expect(stopWords(goalOf(CARD_SCHEDULED))).toMatchObject({
      title: 'Stop the monthly portal goal?',
      description:
        'November has not started, so nothing has counted yet. You can set a new goal straight away.',
    })
  })

  it('a second Stop says the goal was already stopped', () => {
    const refused = goalRefusal(
      new ServerFunctionError(
        'GoalProgramError',
        'invalid_transition',
        'invalid_transition',
        409,
      ),
      PORTAL_STOP_REFUSALS,
    )

    expect(refused).toMatchObject({
      message: 'This goal was already stopped. Here is the latest.',
      code: 'invalid_transition',
    })
  })
})
