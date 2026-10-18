// Reporting — the numbers "Add a portal goal" offers for one Portal or one
// Portal Group (ADR 0068, PLAN PG-20). Pure.
//
// The Monthly portal goal's rule (`goal-recommendation.ts`), on a subject of
// its own, in the month and measure the Property's recommendation offers (this
// month through the 20th local day, else the next; private ratings, or scans
// when the Portals had scans but no private ratings):
//
// - a Portal's rate is its own, once it has 2 weeks live, and this month's
//   choices stand on its own month so far;
// - a Portal Group's rate is the sum of its members' now (each with 2 weeks
//   live), and its month so far is every reading recorded with the group,
//   whatever Portal it came from then: a Portal that moved on the 10th counts
//   in its old group until then and in its new one after (G19).
//
// A measure with a reading the governed read would quarantine, in the basis or
// this month, has no number (the same caution as the Property's: a suggestion
// never stands on a reading it cannot trust). Its live days are not told apart
// here, so a flagged day of the basis on which the Portal was not live counts
// too: it errs toward no number, never toward a wrong one.
//
// A goal for one Portal or one Portal Group stands on the same scope once it is
// set (PLAN PG-21): its page's usual and its change sheet's offers come from the
// Property's recommendation narrowed to it (`narrowedFor`).
import {
  narrowedRecommendation,
  subjectRecommendation,
} from '../../domain/goal-recommendation'
import type {
  PerMeasure,
  PortalFacts,
  PortalGoalMeasure,
  RecommendationGroupDayCount,
} from '../../domain/goal-recommendation-types'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalAddChoices,
  PortalGoalAddSubject,
} from '../dto/monthly-portal-goal-add.types'
import type { PortalGoalFacts } from './goal-recommendation-read'

/** The month and measure the add sheet offers, and what its numbers stand on. */
export type PortalGoalAddBasis = Readonly<{
  facts: PortalGoalFacts
  recommendation: PortalGoalRecommendation
  month: string
  current: boolean
  measure: PortalGoalMeasure
}>

export function portalGoalAddBasisOf(
  facts: PortalGoalFacts,
  recommendation: PortalGoalRecommendation,
): PortalGoalAddBasis {
  const month = recommendation.defaultMonthKey
  return {
    facts,
    recommendation,
    month,
    current: month === recommendation.months.current.key,
    measure: recommendation.defaultMeasure,
  }
}

/** What one subject is offered: its choices, and this month so far when it is offered. */
export type SubjectNumbers = Readonly<{
  choices: PortalGoalAddChoices | null
  soFar: number | null
}>

const perMeasure = <T>(of: (measure: PortalGoalMeasure) => T): PerMeasure<T> => ({
  portal_rating_count: of('portal_rating_count'),
  qualified_scans: of('qualified_scans'),
})

/** The measures with a flagged day at or after `from`. */
function flaggedSince(
  flags: readonly Readonly<{ measure: PortalGoalMeasure; localDay: string }>[],
  from: string,
): ReadonlySet<PortalGoalMeasure> {
  return new Set(
    flags.filter(({ localDay }) => localDay >= from).map(({ measure }) => measure),
  )
}

/** What one subject's numbers stand on: its members, its month so far, and its flagged measures. */
type SubjectScope = Readonly<{
  members: readonly PortalFacts[]
  monthToDate: PerMeasure<number>
  unreadable: ReadonlySet<PortalGoalMeasure>
}>

function numbersOf(
  basis: PortalGoalAddBasis,
  { members, monthToDate, unreadable }: SubjectScope,
): SubjectNumbers {
  const { recommendation, measure, current } = basis
  const measures = subjectRecommendation({
    members: members.filter(({ inBasis }) => inBasis),
    monthToDate,
    unreadable,
    months: recommendation.months,
  })[measure]
  const offered = current ? measures.fromToday : measures.fullMonth.next
  return {
    choices:
      offered === null
        ? null
        : { usual: offered.usual, aBitMore: offered.aBitMore, stretch: offered.stretch },
    soFar: current && !unreadable.has(measure) ? monthToDate[measure] : null,
  }
}

const monthFirstDay = (basis: PortalGoalAddBasis): string =>
  `${basis.recommendation.months.current.key}-01`

function portalScope(basis: PortalGoalAddBasis, portal: PortalFacts): SubjectScope {
  const flags = basis.facts.counts.unreadable.filter(
    ({ portalId }) => portalId === portal.portalId,
  )
  return {
    members: [portal],
    monthToDate: portal.monthToDate,
    unreadable: flaggedSince(flags, basis.recommendation.window.firstDay),
  }
}

/** A Portal's own numbers. */
export function portalNumbers(
  basis: PortalGoalAddBasis,
  portal: PortalFacts,
): SubjectNumbers {
  return numbersOf(basis, portalScope(basis, portal))
}

/** The Portals listed in a group now, in name order. */
export function groupMembers(
  basis: PortalGoalAddBasis,
  groupId: string,
): readonly PortalFacts[] {
  const inGroup = new Set(
    basis.facts.listed.portals
      .filter(({ portalGroupId }) => portalGroupId === groupId)
      .map(({ portalId }) => portalId),
  )
  return basis.recommendation.portals.filter(({ portalId }) => inGroup.has(portalId))
}

function groupMonthToDate(
  days: readonly RecommendationGroupDayCount[],
  from: string,
): PerMeasure<number> {
  return perMeasure((measure) =>
    days.reduce(
      (sum, day) =>
        day.measure === measure && day.localDay >= from ? sum + day.count : sum,
      0,
    ),
  )
}

function groupScope(basis: PortalGoalAddBasis, groupId: string): SubjectScope {
  const { counts } = basis.facts
  const members = groupMembers(basis, groupId)
  const memberIds = new Set(members.map(({ portalId }) => portalId))
  const from = monthFirstDay(basis)
  const unreadable = new Set([
    ...flaggedSince(
      counts.groupUnreadable.filter((flag) => flag.groupId === groupId),
      from,
    ),
    ...flaggedSince(
      counts.unreadable.filter(
        ({ portalId }) => portalId !== null && memberIds.has(portalId),
      ),
      basis.recommendation.window.firstDay,
    ),
  ])
  return {
    members,
    monthToDate: groupMonthToDate(
      counts.groupDays.filter((day) => day.groupId === groupId),
      from,
    ),
    unreadable,
  }
}

/** A Portal Group's numbers: its members' rates, its own month so far. */
export function groupNumbers(basis: PortalGoalAddBasis, groupId: string): SubjectNumbers {
  return numbersOf(basis, groupScope(basis, groupId))
}

/** A Portal Portal no longer lists (a draft again, archived or deleted): nothing to stand on. */
const UNLISTED: SubjectScope = {
  members: [],
  monthToDate: perMeasure(() => 0),
  unreadable: new Set(['portal_rating_count', 'qualified_scans']),
}

/**
 * The Property's recommendation narrowed to one Portal or one Portal Group
 * (PLAN PG-21): every month and measure of its own numbers, for the page and
 * the change sheet of a goal set for it. A Portal Portal no longer lists has no
 * number and no month so far.
 */
export function narrowedFor(
  basis: PortalGoalAddBasis,
  subject: PortalGoalAddSubject,
): PortalGoalRecommendation {
  const { recommendation } = basis
  if (subject.kind === 'portal_group') {
    return narrowedRecommendation(
      recommendation,
      groupScope(basis, subject.portalGroupId),
    )
  }
  const portal = recommendation.portals.find(
    ({ portalId }) => portalId === subject.portalId,
  )
  return narrowedRecommendation(
    recommendation,
    portal ? portalScope(basis, portal) : UNLISTED,
  )
}

/** The live Portals, in name order: published, with a live run now. */
export const livePortalsOf = (
  recommendation: PortalGoalRecommendation,
): readonly PortalFacts[] =>
  recommendation.portals.filter(
    ({ publicationState, liveSince }) =>
      publicationState === 'published' && liveSince !== null,
  )

/**
 * The recommended number for one subject, in the month and measure offered;
 * null when it has none there (the set command then stores "own").
 */
export function recommendedNumberFor(
  basis: PortalGoalAddBasis,
  subject: PortalGoalAddSubject,
): number | null {
  if (subject.kind === 'portal_group') {
    return groupNumbers(basis, subject.portalGroupId).choices?.aBitMore ?? null
  }
  const portal = livePortalsOf(basis.recommendation).find(
    ({ portalId }) => portalId === subject.portalId,
  )
  return portal ? (portalNumbers(basis, portal).choices?.aBitMore ?? null) : null
}
