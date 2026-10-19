import { describe, expect, it } from 'vitest'
import type { PortalGoalRunningMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { GOAL_PACE_STATUS } from './goal-pace-status'
import { portalGoalPace } from './portal-goal-status-view'

/** Nov 22: 23 of 40, 22 of 30 days gone, behind. */
const month = (patch: Partial<PortalGoalRunningMonth> = {}): PortalGoalRunningMonth => ({
  key: '2026-11',
  measure: 'portal_rating_count',
  target: 40,
  value: 23,
  elapsedDays: 22,
  totalDays: 30,
  daysAfterToday: 8,
  belowPace: true,
  quietDays: false,
  ...patch,
})

describe('the Monthly portal goal pill', () => {
  it('Below pace when the rule says behind', () => {
    expect(portalGoalPace(month({ belowPace: true }))).toBe(GOAL_PACE_STATUS.below_pace)
  })

  it('On pace when the rule says on the way, in green', () => {
    const pill = portalGoalPace(month({ belowPace: false }))

    expect(pill).toBe(GOAL_PACE_STATUS.on_pace)
    expect(pill).toMatchObject({ label: 'On pace', tone: 'positive' })
  })

  it('Getting started in the first quiet days, whatever the figure', () => {
    // Nov 2: one rating in, never judged.
    expect(
      portalGoalPace(
        month({ value: 1, elapsedDays: 2, belowPace: null, quietDays: true }),
      ),
    ).toBe(GOAL_PACE_STATUS.getting_started)
    // A rule that said behind on the quiet days is not heard.
    expect(portalGoalPace(month({ quietDays: true, belowPace: true }))).toBe(
      GOAL_PACE_STATUS.getting_started,
    )
  })

  it('no pill for a month the rule does not judge (P-6: a target of 4 on day 29)', () => {
    expect(
      portalGoalPace(month({ target: 4, value: 1, elapsedDays: 29, belowPace: null })),
    ).toBeNull()
  })

  it('On pace once the number is reached, on the quiet days and past them', () => {
    expect(portalGoalPace(month({ value: 40, belowPace: false }))).toBe(
      GOAL_PACE_STATUS.on_pace,
    )
    // 43 of 40: passed, still On pace, and the quiet days do not take it back.
    expect(portalGoalPace(month({ value: 43, belowPace: null, quietDays: true }))).toBe(
      GOAL_PACE_STATUS.on_pace,
    )
    expect(portalGoalPace(month({ value: 41, belowPace: true }))).toBe(
      GOAL_PACE_STATUS.on_pace,
    )
  })

  it('no pill when the figure cannot be read, or there is no month', () => {
    expect(portalGoalPace(month({ value: null, belowPace: null }))).toBeNull()
    expect(portalGoalPace(month({ value: null, quietDays: true }))).toBeNull()
    expect(portalGoalPace(null)).toBeNull()
  })
})
