import { describe, expect, it } from 'vitest'
import type { PortalGoalCardView } from '#/contexts/reporting/monthly-goals/contracts'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { goalRefusal } from '../../../../components/goals/goal-refusal'
import {
  CARD_LAST_MONTH_UPDATING,
  CARD_RUNNING,
  CARD_WHILE_DECEMBER_OPENS,
} from './portal-goal-running.stories.fixtures'
import { CARD_SCHEDULED } from '#/contexts/reporting/monthly-goals/ui/portal-goal.stories.fixtures'
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

  it.each(['monthly', 'single'] as const)(
    'before December is opened, the %s confirmation keeps December through Dec 31',
    (kind) => {
      // December is already the live month; Stop opens it before ending the goal.
      expect(stopWords(goalOf(CARD_WHILE_DECEMBER_OPENS), kind).description).toBe(
        'December keeps counting to Dec 31 and keeps its result. You can set a new goal from January.',
      )
    },
  )

  it('an average keeps its live month before maintenance opens it', () => {
    const goal = goalOf(CARD_WHILE_DECEMBER_OPENS)
    const average = {
      programId: 'average-goal',
      status: 'active',
      startsOn: null,
      change: goal.change,
      month: { key: '2026-12' },
    } as const

    expect(stopWords(average, 'single').description).toBe(
      'December keeps counting to Dec 31 and keeps its result. You can set a new goal from January.',
    )
  })

  it('a paused goal keeps its last counting month', () => {
    const goal = goalOf(CARD_WHILE_DECEMBER_OPENS)
    const paused = { ...goal, status: 'paused', month: null } as const

    expect(stopWords(paused).description).toBe(
      'November keeps counting to Nov 30 and keeps its result. You can set a new goal from January.',
    )
  })

  it('a running goal is never told it has not started', () => {
    const goal = goalOf(CARD_RUNNING)
    const nothingCounting = { ...goal, month: null, change: null, lastMonth: null }

    expect(stopWords(nothingCounting).description).toBe(
      'You can set a new goal straight away.',
    )
  })

  it('a goal that has not started frees its month at once', () => {
    expect(stopWords(goalOf(CARD_SCHEDULED))).toMatchObject({
      title: 'Stop the monthly portal goal?',
      description:
        'November has not started, so nothing has counted yet. You can set a new goal straight away.',
    })
  })

  it('a goal for one portal, a group or the average asks to stop this portal goal', () => {
    expect(stopWords(goalOf(CARD_RUNNING), 'single')).toMatchObject({
      title: 'Stop this portal goal?',
      description:
        'November keeps counting to Nov 30 and keeps its result. You can set a new goal from December.',
      confirm: 'Stop the goal',
    })
    // The average names no month it still counts, nor the month before.
    const average = {
      programId: 'average-goal',
      status: 'active',
      startsOn: null,
      change: goalOf(CARD_RUNNING).change,
    } as const
    expect(stopWords(average, 'single').description).toBe(
      'November keeps counting to Nov 30 and keeps its result. You can set a new goal from December.',
    )
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
