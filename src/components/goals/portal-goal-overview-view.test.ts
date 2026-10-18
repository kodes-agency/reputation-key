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
import {
  CARD_FIVE_PORTALS,
  CARD_ONE_PORTAL,
  CARD_OTHER_PORTALS,
  CARD_RUNNING,
  CARD_STOPPED,
} from './portal-goal-running.stories.fixtures'
import {
  CARD_CHECK_IN,
  CARD_CHECK_IN_NOTHING,
  CARD_CHECK_IN_SAME,
} from './portal-goal-check-in.stories.fixtures'
import {
  overviewCountsLine,
  overviewPortalGoalView,
  overviewPromptWords,
  overviewTitle,
} from './portal-goal-overview-view'

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
    // A stopped goal's month still counts on the Goals page, not here.
    expect(viewOf(CARD_STOPPED)).toEqual({ kind: 'nothing' })
  })

  it('the check-in on days 1–7', () => {
    expect(viewOf(CARD_CHECK_IN)).toMatchObject({
      kind: 'check_in',
      checkIn: { kind: 'offer', month: '2026-12' },
    })
    expect(viewOf(CARD_CHECK_IN_NOTHING)).toMatchObject({
      kind: 'check_in',
      checkIn: { kind: 'nothing' },
    })
    // The recommended number the month's already, or a viewer who cannot
    // change the goal: the running month, not a question.
    expect(viewOf(CARD_CHECK_IN_SAME).kind).toBe('card')
    expect(viewOf(CARD_CHECK_IN, { canSet: true, canChange: false }).kind).toBe('card')
  })
})

describe('the Overview slot, worded', () => {
  it('names the goal and the month it counts', () => {
    expect(overviewTitle('2026-11')).toBe('Monthly portal goal · November')
  })

  it("says each portal's count in one line, in the read's order", () => {
    const rowsOf = (card: PortalGoalCardView) =>
      card.state === 'goal' && card.goal.rows !== null
        ? overviewCountsLine(card.goal.rows)
        : undefined

    expect(rowsOf(CARD_RUNNING)).toBe('Reception 3 · Restaurant 0 · Spa 20')
    expect(rowsOf(CARD_OTHER_PORTALS)).toBe(
      'Reception 13 · Restaurant 6 · Spa 2 · Other portals 2',
    )
    // "All from Reception." and "From 5 portals" are the card's own sentences.
    expect(rowsOf(CARD_ONE_PORTAL)).toBeNull()
    expect(rowsOf(CARD_FIVE_PORTALS)).toBeNull()
  })

  it('the prompt says the number in its own unit', () => {
    expect(
      overviewPromptWords(
        { month: '2026-12', number: 1, deferred: false },
        'qualified_scans',
      ),
    ).toBe('Your monthly portal goal for December is ready: 1 scan.')
  })
})
