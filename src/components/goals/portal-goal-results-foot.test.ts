import { describe, expect, it } from 'vitest'
import {
  MONTHLY_GOAL,
  OLD_SPA_GOAL,
  RECEPTION_GOAL,
  SEAVIEW_GOALS,
  STOPPED_GOAL,
  portalGoalBundle,
} from './portal-goal-results.stories.fixtures'
import {
  ENDED_PORTAL_GOALS_HASH,
  allResultsLink,
  anyPortalGoalMonthClosed,
  endedPortalGoalsLink,
} from './portal-goal-results-foot'
import {
  ENDED_PORTAL_GOALS_ID,
  ENDED_PORTAL_GOALS_TITLE,
} from './portal-goal-results-view'

/** A goal set for December, with no month closed yet. */
const SCHEDULED = portalGoalBundle({
  id: 'goal-scheduled',
  name: 'Monthly portal goal',
  metric: 'portal_rating_count',
  target: 45,
  subject: { kind: 'property', propertyId: 'property-seaview' },
  from: '2026-12',
  months: [{ yearMonth: '2026-12', open: true }],
})

describe('allResultsLink', () => {
  it('the foot link appears once a month has closed', () => {
    expect(allResultsLink(false)).toBeNull()
    expect(allResultsLink(true)).toBe('All monthly results')
  })
})

describe('the way to every month’s result (R-3)', () => {
  it('opens once a month of a portal goal has closed', () => {
    expect(anyPortalGoalMonthClosed([MONTHLY_GOAL])).toBe(true)
    expect(anyPortalGoalMonthClosed([SCHEDULED, STOPPED_GOAL])).toBe(true)
  })

  it('is not there while every month is still counting, nor before a goal', () => {
    expect(anyPortalGoalMonthClosed([SCHEDULED])).toBe(false)
    expect(anyPortalGoalMonthClosed([RECEPTION_GOAL, OLD_SPA_GOAL])).toBe(false)
    expect(anyPortalGoalMonthClosed([])).toBe(false)
  })
})

describe('the way to the ended portal goals (R-4)', () => {
  it('counts the ended goals', () => {
    expect(endedPortalGoalsLink(SEAVIEW_GOALS)).toBe('Ended portal goals (3)')
    expect(endedPortalGoalsLink([MONTHLY_GOAL, RECEPTION_GOAL])).toBe(
      'Ended portal goals (1)',
    )
  })

  it('says nothing before a goal has ended', () => {
    expect(endedPortalGoalsLink([MONTHLY_GOAL, SCHEDULED])).toBeNull()
    expect(endedPortalGoalsLink([])).toBeNull()
  })

  it('lands on the results page’s ended goals, and names them as that page does', () => {
    expect(ENDED_PORTAL_GOALS_HASH).toBe(ENDED_PORTAL_GOALS_ID)
    expect(endedPortalGoalsLink([STOPPED_GOAL])).toBe(`${ENDED_PORTAL_GOALS_TITLE} (1)`)
  })
})
