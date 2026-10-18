// Monthly portal goal — what the add sheet reads and sends (types only; PLAN
// PG-20, copy deck M-1…M-14).
//
// "Add a portal goal" is one click deeper than the Monthly portal goal (P-5): a
// goal for one Portal, one for each Portal, one for a Portal Group, or the
// average private rating. No zod and no values: a component imports these with
// `import type`, so nothing here reaches a bundle (PLAN E10). The server decides
// every number, which options are open and why (PLAN E12); the sheet only words
// them. Days are Property-local `YYYY-MM-DD`, months `YYYY-MM`.

import type { PortalGoalMeasure } from './goal-recommendation.types'

/** What a count goal of the add sheet is for: one Portal, or one Portal Group. */
export type PortalGoalAddSubject =
  | Readonly<{ kind: 'portal'; portalId: string }>
  | Readonly<{ kind: 'portal_group'; portalGroupId: string }>

/** "20 · your usual", "22 · a bit more" (the recommended number, P-3), "24 · stretch". */
export type PortalGoalAddChoices = Readonly<{
  usual: number
  aBitMore: number
  stretch: number
}>

/** The goal that already counts the measure for a subject from the month offered. */
export type PortalGoalAddHeld = Readonly<{ programId: string; name: string }>

/** One Portal or Portal Group a goal can be added for, in the month and measure offered. */
export type PortalGoalAddOffer = Readonly<{
  subject: PortalGoalAddSubject
  name: string
  /**
   * The rule on its own rate and month so far (a group's rate is its members'
   * summed); null while it has no number: new, nothing counted, or unreadable.
   */
  choices: PortalGoalAddChoices | null
  /** This month so far, when this month is offered and it can be read; else null. */
  soFar: number | null
  /** Live but not in the number yet: the local day it is ("New · ready Oct 29"). */
  readyOn: string | null
  /** "Has a goal": it takes no second goal on the measure. */
  heldBy: PortalGoalAddHeld | null
}>

/** One row of "A goal for each portal". */
export type PortalGoalAddEachRow = Readonly<{
  offer: PortalGoalAddOffer
  /** Ticked with its recommended number, unless it is new or has a goal. */
  ticked: boolean
  /** The number it starts on: its recommended one; null with none. */
  number: number | null
}>

export type PortalGoalAddOptions = Readonly<{
  /** The month offered: this month through the 20th local day, else the next. */
  month: string
  /** The month offered is this month: it counts from its first day. */
  current: boolean
  /** Private ratings, or scans when the Portals had scans but no private ratings (P-2). */
  measure: PortalGoalMeasure
  /** A goal for one Portal: each live Portal, in name order; none under 2 live Portals. */
  onePortal: readonly PortalGoalAddOffer[]
  /** A goal for each Portal: the same Portals, as rows. */
  eachPortal: readonly PortalGoalAddEachRow[]
  /** A goal for a Portal Group: each group with a live Portal, in name order. */
  groups: readonly PortalGoalAddOffer[]
  /** The average private rating for the whole Property. */
  average: Readonly<{
    /** It needs 10 private ratings a month: open with that many in the last 4 weeks. */
    available: boolean
    /** Every private rating of the last 4 weeks: "Your portals had 6 in the last 4 weeks." */
    last4Weeks: number
    heldBy: PortalGoalAddHeld | null
  }>
  /** The Property's time zone, whose months the goal follows. */
  timezone: string
}>

/** A goal for one Portal, one Portal Group, or the average for the Property. */
export type AddPortalGoalRequest = Readonly<{
  propertyId: string
  subject: PortalGoalAddSubject | Readonly<{ kind: 'property' }>
  metric: PortalGoalMeasure | 'portal_rating_average'
  targetValue: number
  startMonth: string
  /** What the sheet offered; the server stores `recommended` only when it is so. */
  targetSource: 'recommended' | 'own'
}>

/** A goal for each ticked Portal, all in one month and measure. */
export type AddPortalGoalsRequest = Readonly<{
  propertyId: string
  metric: PortalGoalMeasure
  startMonth: string
  items: readonly Readonly<{
    portalId: string
    targetValue: number
    targetSource: 'recommended' | 'own'
  }>[]
}>

/** What became of each Portal of a save for each Portal, in the order sent. */
export type AddPortalGoalsResult = Readonly<{
  outcomes: readonly Readonly<{ portalId: string; saved: boolean }>[]
}>
