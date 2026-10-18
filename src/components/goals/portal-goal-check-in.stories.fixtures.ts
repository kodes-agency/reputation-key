// The month-start check-in's story fixtures (PLAN PG-15, golden G4): Seaview's
// goal of 40 private ratings a month, running since November, read on Dec 1 to
// 8. The 4 weeks to Nov 30 at Reception, Restaurant and Spa brought in 34, so a
// 31-day December gets about 38: Use 45, Keep 40. Every shape is the read's own
// type, from Reporting's application layer; nothing here is worked out, only
// stated.
import type {
  PortalGoalCardView,
  PortalGoalCheckIn,
  PortalGoalLastMonth,
  PortalGoalOfCard,
  PortalGoalOffer,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  CARD_LAST_MONTH_MET,
  CARD_LAST_MONTH_NOT_MET,
  CARD_LAST_MONTH_UPDATING,
} from './portal-goal-running.stories.fixtures'
import { OFFER_NOVEMBER, OFFER_SCANS } from './portal-goal.stories.fixtures'

/** K-10: December as a whole month, from the 4 weeks to Nov 30. */
const DECEMBER_WHOLE: PortalGoalOffer = {
  ...OFFER_NOVEMBER,
  month: '2026-12',
  days: 31,
  choices: { usual: 40, aBitMore: 45, stretch: 50 },
  usualAbout: 38,
  // 34 in 28 live days, for 31 days.
  usualExact: { num: '527', den: '14' },
  basis: {
    weeks: 4,
    days: 28,
    lastDay: '2026-11-30',
    count: 34,
    portals: [
      { name: 'Reception', count: 15, liveDays: 28 },
      { name: 'Restaurant', count: 9, liveDays: 28 },
      { name: 'Spa', count: 10, liveDays: 28 },
    ],
  },
  newPortals: [],
}

const DECEMBER = { month: '2026-12', measure: 'portal_rating_count', target: 40 } as const

/** G4: Use 45, Keep 40. */
export const CHECK_IN_OFFER: Extract<PortalGoalCheckIn, { kind: 'offer' }> = {
  ...DECEMBER,
  kind: 'offer',
  offer: DECEMBER_WHOLE,
}

/** December already counts against 45, the recommended number. */
export const CHECK_IN_SAME: Extract<PortalGoalCheckIn, { kind: 'same' }> = {
  ...DECEMBER,
  target: 45,
  kind: 'same',
}

/** No private ratings in the 4 weeks to Nov 30. */
export const CHECK_IN_NOTHING: Extract<PortalGoalCheckIn, { kind: 'nothing' }> = {
  ...DECEMBER,
  kind: 'nothing',
  weeks: 4,
}

/** A goal of 50 scans: 55 recommended for December. */
export const CHECK_IN_SCANS: Extract<PortalGoalCheckIn, { kind: 'offer' }> = {
  ...DECEMBER,
  measure: 'qualified_scans',
  target: 50,
  kind: 'offer',
  offer: {
    ...OFFER_SCANS,
    month: '2026-12',
    days: 31,
    basis: { ...DECEMBER_WHOLE.basis, count: 46 },
  },
}

/** A card of the goal, with its goal changed as said. */
function withGoal(
  card: PortalGoalCardView,
  goal: Partial<PortalGoalOfCard>,
  today?: string,
): PortalGoalCardView {
  if (card.state !== 'goal') throw new Error('expected a card with a goal')
  return {
    ...card,
    today: today ?? card.today,
    goal: { ...card.goal, ...goal },
  }
}

/** K-1: November while it is read, 36 of 40 so far, final on Dec 2. */
const NOVEMBER_SO_FAR: PortalGoalLastMonth = {
  key: '2026-11',
  measure: 'portal_rating_count',
  value: 36,
  target: 40,
  outcome: 'updating',
  finalOn: '2026-12-02',
}

/** Dec 1: November is read, and December asks. */
export const CARD_CHECK_IN = withGoal(CARD_LAST_MONTH_UPDATING, {
  lastMonth: NOVEMBER_SO_FAR,
  checkIn: CHECK_IN_OFFER,
})

/** Dec 3: November closed, met (K-6, G-31), and December still asks. */
export const CARD_CHECK_IN_CLOSED_MET = withGoal(CARD_LAST_MONTH_MET, {
  checkIn: CHECK_IN_OFFER,
})

/** Dec 3: November closed, not met: neutral, never red. */
export const CARD_CHECK_IN_CLOSED_NOT_MET = withGoal(CARD_LAST_MONTH_NOT_MET, {
  checkIn: CHECK_IN_OFFER,
})

/** Dec 1, December at 45 already: one line under the running card. */
export const CARD_CHECK_IN_SAME = withGoal(CARD_LAST_MONTH_UPDATING, {
  lastMonth: NOVEMBER_SO_FAR,
  checkIn: CHECK_IN_SAME,
})

/** Dec 1, nothing came in over the 4 weeks: Keep 40, or another number. */
export const CARD_CHECK_IN_NOTHING = withGoal(CARD_LAST_MONTH_UPDATING, {
  lastMonth: NOVEMBER_SO_FAR,
  checkIn: CHECK_IN_NOTHING,
})

/** Dec 1, once answered: the running card, with no check-in. */
export const CARD_CHECK_IN_ANSWERED = withGoal(CARD_LAST_MONTH_UPDATING, {
  lastMonth: NOVEMBER_SO_FAR,
  checkIn: null,
})

/** Dec 8: the check-in has folded away, and December keeps 40. */
export const CARD_DAY_8 = withGoal(
  CARD_LAST_MONTH_MET,
  {
    lastMonth: null,
    checkIn: null,
    rows: { kind: 'one', name: 'Reception' },
    month:
      CARD_LAST_MONTH_MET.state === 'goal' && CARD_LAST_MONTH_MET.goal.month
        ? {
            ...CARD_LAST_MONTH_MET.goal.month,
            value: 9,
            elapsedDays: 8,
            daysAfterToday: 23,
            quietDays: false,
            belowPace: null,
          }
        : null,
  },
  '2026-12-08',
)
