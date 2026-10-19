import { describe, expect, it } from 'vitest'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  CARD_DRAFTS_ONE,
  CARD_GETTING_READY,
  CARD_NOTHING,
  CARD_NO_PORTAL,
  CARD_READY,
  CARD_REC_UNREADABLE,
  CARD_SCANS_ONLY,
  CARD_SCHEDULED,
} from './portal-goal.stories.fixtures'
import { CARD_RUNNING, CARD_STOPPED } from './portal-goal-running.stories.fixtures'
import {
  CARD_CHECK_IN,
  CARD_CHECK_IN_NOTHING,
  CARD_CHECK_IN_SAME,
} from './portal-goal-check-in.stories.fixtures'
import { overviewPortalGoalView, overviewPromptWords } from './portal-goal-overview-view'

const MAY_ALL: Readonly<{ canSet: boolean; canChange: boolean }> = {
  canSet: true,
  canChange: true,
}
const viewOf = (card: PortalGoalCardView | undefined, may = MAY_ALL) =>
  overviewPortalGoalView({ card, ...may })

const deferred = (card: PortalGoalCardView): PortalGoalCardView =>
  card.state === 'ready' || card.state === 'scans_only'
    ? { ...card, prompt: { ...card.prompt, deferred: true } }
    : card

describe('overviewPortalGoalView', () => {
  it('nothing in the first weeks', () => {
    for (const card of [
      CARD_GETTING_READY,
      CARD_NO_PORTAL,
      CARD_DRAFTS_ONE,
      CARD_NOTHING,
      CARD_REC_UNREADABLE,
    ]) {
      expect(viewOf(card)).toEqual({ kind: 'nothing' })
    }
  })

  it('the prompt only when ready and not deferred', () => {
    expect(viewOf(CARD_READY)).toEqual({
      kind: 'prompt',
      month: '2026-11',
      text: 'Your monthly portal goal for November is ready: 40 private ratings.',
    })
    expect(viewOf(CARD_SCANS_ONLY)).toMatchObject({
      kind: 'prompt',
      text: 'Your monthly portal goal for November is ready: 55 scans.',
    })
    // After Not now, while it is read, and for a viewer who cannot set it: nothing.
    expect(viewOf(deferred(CARD_READY))).toEqual({ kind: 'nothing' })
    expect(viewOf(undefined)).toEqual({ kind: 'nothing' })
    expect(viewOf(CARD_READY, { canSet: false, canChange: false })).toEqual({
      kind: 'nothing',
    })
  })

  it('nothing for a scheduled goal', () => {
    expect(viewOf(CARD_SCHEDULED)).toEqual({ kind: 'nothing' })
  })

  it('the card while running', () => {
    const view = viewOf(CARD_RUNNING)

    expect(view.kind).toBe('card')
    if (view.kind !== 'card' || CARD_RUNNING.state !== 'goal') return
    expect(view.goal).toBe(CARD_RUNNING.goal)
    expect(view.month).toBe(CARD_RUNNING.goal.month)
    expect(view.today).toBe(CARD_RUNNING.today)
    // No check-in asks on a plain running month.
    expect(view.checkIn).toBeNull()
    // A stopped goal's month still counts on the Goals page, not here.
    expect(viewOf(CARD_STOPPED)).toEqual({ kind: 'nothing' })
  })

  it('the card carries the check-in that asks on days 1–7, to draw above it', () => {
    expect(viewOf(CARD_CHECK_IN)).toMatchObject({
      kind: 'card',
      checkIn: { kind: 'offer', month: '2026-12' },
    })
    expect(viewOf(CARD_CHECK_IN_NOTHING)).toMatchObject({
      kind: 'card',
      checkIn: { kind: 'nothing' },
    })
  })

  it('draws the running month, not a question, when none asks', () => {
    // The recommended number the month's already, or a viewer who cannot
    // change the goal.
    expect(viewOf(CARD_CHECK_IN_SAME)).toMatchObject({ kind: 'card', checkIn: null })
    expect(viewOf(CARD_CHECK_IN, { canSet: true, canChange: false })).toMatchObject({
      kind: 'card',
      checkIn: null,
    })
  })
})

describe('the Overview slot, worded', () => {
  it('the prompt says the number in its own unit', () => {
    expect(
      overviewPromptWords(
        { month: '2026-12', number: 1, deferred: false },
        'qualified_scans',
      ),
    ).toBe('Your monthly portal goal for December is ready: 1 scan.')
  })
})
