import { describe, expect, it } from 'vitest'
import type { PortalGoalSheetFacts } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  changedDraft,
  openingDraft,
  portalGoalSheetModel,
  type PortalGoalSheetDraft,
} from './portal-goal-sheet-view'
import {
  OFFER_NOVEMBER as RATINGS_NOVEMBER,
  SHEET_FIRST_WEEKS as FIRST_WEEKS,
  SHEET_READY as READY,
} from './portal-goal.stories.fixtures'

// The set sheet's month (copy deck S-2): what the box keeps when the manager
// picks the other month, and the month in effect once the read offers others.
// Seaview's Oct 23 (40 recommended for November, nothing for October in one
// case), and the first weeks on Oct 17, when nothing is recommended yet.
const ratings = { measure: 'portal_rating_count' } as const

const typed = (draft: PortalGoalSheetDraft, text: string, facts = READY) =>
  changedDraft(draft, { kind: 'type', text }, facts)

describe('the set sheet month', () => {
  it('an own number stays when the month changes without an offer', () => {
    const own = typed(openingDraft(FIRST_WEEKS, ratings), '12', FIRST_WEEKS)
    const november = changedDraft(own, { kind: 'month', month: '2026-11' }, FIRST_WEEKS)

    expect(portalGoalSheetModel(november, FIRST_WEEKS)).toMatchObject({
      description: 'Starts on Nov 1.',
      primary: { label: 'Set 12 for November' },
    })
  })

  it('a suggestion for one month is not kept for a month with no offer', () => {
    // October cannot be offered (its number is not ready), November can.
    const novemberOnly: PortalGoalSheetFacts = {
      ...READY,
      offers: {
        ...READY.offers,
        portal_rating_count: { current: null, next: RATINGS_NOVEMBER },
      },
    }
    const opened = openingDraft(novemberOnly, ratings)
    const toOctober = (draft: PortalGoalSheetDraft) =>
      portalGoalSheetModel(
        changedDraft(draft, { kind: 'month', month: '2026-10' }, novemberOnly),
        novemberOnly,
      )

    // November's recommended 40, or its stretch, was never chosen for October.
    expect(toOctober(opened)).toMatchObject({
      month: '2026-10',
      number: { text: '', value: null },
      status: { text: 'No recommendation yet.', restore: null },
      primary: { label: 'Set goal', disabled: true },
      submission: null,
    })
    const stretch = changedDraft(opened, { kind: 'number', value: 45 }, novemberOnly)
    expect(toOctober(stretch).number.text).toBe('')
    // A number of the manager's own goes with them.
    expect(toOctober(typed(opened, '52', novemberOnly)).primary).toEqual({
      label: 'Set 52 for October',
      disabled: false,
    })
  })

  it('a month the read no longer offers falls back to the one it opens on', () => {
    // After the month turned, the read offers November and December.
    const turned: PortalGoalSheetFacts = {
      ...FIRST_WEEKS,
      month: '2026-11',
      ownNumber: {
        current: { key: '2026-11', soFar: { ratings: 0, scans: 0 } },
        next: { key: '2026-12' },
      },
    }
    const october = typed(openingDraft(FIRST_WEEKS, ratings), '12', FIRST_WEEKS)

    expect(portalGoalSheetModel(october, turned)).toMatchObject({
      month: '2026-11',
      months: [
        { value: '2026-11', label: 'November' },
        { value: '2026-12', label: 'December' },
      ],
      submission: { startMonth: '2026-11', targetValue: 12 },
    })
  })
})
