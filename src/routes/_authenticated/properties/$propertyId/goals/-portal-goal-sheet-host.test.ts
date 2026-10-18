import { describe, expect, it } from 'vitest'
import {
  CARD_RUNNING,
  CARD_STOPPED,
} from '#/components/goals/portal-goal-running.stories.fixtures'
import {
  CARD_READY,
  CARD_SCHEDULED,
} from '#/components/goals/portal-goal.stories.fixtures'
import {
  CARD_CHECK_IN,
  CARD_CHECK_IN_SAME,
} from '#/components/goals/portal-goal-check-in.stories.fixtures'
import { afresh, openedAs, portalGoalDoorShown } from './-portal-goal-sheet-host'

// The sheet's chunk is fetched only while a door to it is drawn (PLAN PG-14).

describe('portalGoalDoorShown', () => {
  it('every arm before a goal opens the sheet; no card, no portal: none', () => {
    expect(portalGoalDoorShown(CARD_READY, false, 'card')).toBe(true)
    expect(portalGoalDoorShown({ state: 'no_portal' }, true, 'card')).toBe(false)
    expect(portalGoalDoorShown(undefined, true, 'page')).toBe(false)
  })

  it('a running goal: no door on its card; on its page, for someone who may change it', () => {
    expect(portalGoalDoorShown(CARD_RUNNING, true, 'card')).toBe(false)
    expect(portalGoalDoorShown(CARD_RUNNING, true, 'page')).toBe(true)
    expect(portalGoalDoorShown(CARD_RUNNING, false, 'page')).toBe(false)
  })

  it('a goal that has not started: "Change", for someone who may change it', () => {
    expect(portalGoalDoorShown(CARD_SCHEDULED, true, 'card')).toBe(true)
    expect(portalGoalDoorShown(CARD_SCHEDULED, false, 'card')).toBe(false)
  })

  it('the month-start check-in: "Other number" or "Change", for someone who may change it', () => {
    expect(portalGoalDoorShown(CARD_CHECK_IN, true, 'card')).toBe(true)
    expect(portalGoalDoorShown(CARD_CHECK_IN_SAME, true, 'card')).toBe(true)
    expect(portalGoalDoorShown(CARD_CHECK_IN, false, 'card')).toBe(false)
  })

  it('a stopped goal: its way to the next goal, on the card and on the page', () => {
    expect(portalGoalDoorShown(CARD_STOPPED, false, 'card')).toBe(true)
    expect(portalGoalDoorShown(CARD_STOPPED, true, 'page')).toBe(true)
  })
})

// Both sheets' hosts open and close the same way ("Add a portal goal" too).
describe('afresh and openedAs', () => {
  it('every opening is open under the next key, so a fresh sheet is mounted', () => {
    expect(afresh(null)).toEqual({ open: true, key: 1 })
    expect(afresh({ open: false, key: 3 })).toEqual({ open: true, key: 4 })
  })

  it('closing keeps what the sheet opened on and its key; with no sheet, none', () => {
    const opening = { measure: 'scans', open: true, key: 2 }
    expect(openedAs(false)(opening)).toEqual({ measure: 'scans', open: false, key: 2 })
    expect(openedAs(false)(null)).toBeNull()
  })
})
