import { describe, expect, it } from 'vitest'
import type { RatingGoalHistoryEntry } from '#/contexts/reporting/application/dto/rating-goal.types'
import { overviewGoalView } from './rating-goal-overview-view'
import { SETUP_BETA } from './rating-goal-plan.stories.fixtures'
import {
  CARD,
  CARD_REACHED,
  FIXTURE_NOW,
  HISTORY,
  SETUP,
  SETUP_FEW_REVIEWS,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

const NOW = new Date(FIXTURE_NOW)
const read = {
  card: null,
  cardReadAt: NOW,
  setup: SETUP,
  history: [],
  canCreate: true,
  notNowChosen: false,
  now: NOW,
} as const

/** CARD's goal, reached two days before the fixtures were read. */
const REACHED_LATELY: RatingGoalHistoryEntry = {
  ...HISTORY[0]!,
  targetTenths: 45,
  target: 4.5,
  reachedAt: '2026-10-12T05:10:00.000Z',
}

describe('overviewGoalView', () => {
  it('shows the simple card of an active goal', () => {
    expect(overviewGoalView({ ...read, card: CARD })).toEqual({
      kind: 'card',
      card: CARD,
    })
  })

  it('says nothing until the card is read, or when its read failed', () => {
    expect(overviewGoalView({ ...read, card: undefined })).toEqual({ kind: 'nothing' })
  })

  it('tells a goal this read found reached, with what Google shows now', () => {
    // Act
    const view = overviewGoalView({ ...read, card: CARD_REACHED })

    // Assert
    expect(view).toMatchObject({
      kind: 'outcome',
      outcome: { state: 'reached', target: 4.5 },
      googleShowsNow: 4.3,
      canSetNext: true,
    })
  })

  it('tells a goal reached lately, from History, before offering a new one', () => {
    // Act
    const view = overviewGoalView({ ...read, history: [REACHED_LATELY] })

    // Assert
    expect(view).toMatchObject({ kind: 'outcome', outcome: { state: 'reached' } })
  })

  it('offers the one-line prompt for a goal to climb to', () => {
    expect(overviewGoalView(read)).toEqual({
      kind: 'prompt',
      intent: { kind: 'climb' },
    })
  })

  it('opens the prompt on plans for a low rating whose recent reviews fall short', () => {
    expect(overviewGoalView({ ...read, setup: SETUP_BETA })).toEqual({
      kind: 'prompt',
      intent: { kind: 'climb' },
    })
  })

  it('opens the prompt on keeping the number when Google shows 5.0', () => {
    expect(overviewGoalView({ ...read, setup: SETUP_KEEP_FIRST })).toEqual({
      kind: 'prompt',
      intent: { kind: 'keep', targetTenths: 50 },
    })
  })

  it('says nothing to a viewer who may not set goals', () => {
    expect(overviewGoalView({ ...read, canCreate: false })).toEqual({ kind: 'nothing' })
  })

  it('says nothing once a manager chose "Not now", or until that choice is read', () => {
    expect(overviewGoalView({ ...read, notNowChosen: true })).toEqual({
      kind: 'nothing',
    })
    expect(overviewGoalView({ ...read, notNowChosen: undefined })).toEqual({
      kind: 'nothing',
    })
  })

  it('still tells a goal reached lately after "Not now": news is not a reminder', () => {
    expect(
      overviewGoalView({ ...read, notNowChosen: true, card: CARD_REACHED }),
    ).toMatchObject({ kind: 'outcome' })
  })

  it('says nothing where no goal can be set, or before the setup is read', () => {
    expect(overviewGoalView({ ...read, setup: SETUP_FEW_REVIEWS })).toEqual({
      kind: 'nothing',
    })
    expect(overviewGoalView({ ...read, setup: undefined })).toEqual({ kind: 'nothing' })
  })

  it('leaves out a goal a manager ended: it is not news', () => {
    // Arrange
    const ended: RatingGoalHistoryEntry = {
      ...REACHED_LATELY,
      state: 'ended',
      endedReason: 'manager',
      reachedAt: null,
      endedAt: '2026-10-13T08:00:00.000Z',
    }

    // Act / Assert
    expect(overviewGoalView({ ...read, history: [ended] })).toEqual({
      kind: 'prompt',
      intent: { kind: 'climb' },
    })
  })
})
