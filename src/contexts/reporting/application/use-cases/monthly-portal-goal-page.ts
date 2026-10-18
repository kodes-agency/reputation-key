// Reporting — the Monthly portal goal's page, `/goals/portals` (ADR 0068, PLAN
// PG-13).
//
// One composed read, asked for `goal.create` like the card, since whoever sees
// the page is whoever may set the goal. It reads what the card reads, once, and
// returns the card's arm: before a goal it is what the page shows. With a goal,
// it adds what the page shows beside it: the month before (or that it had no
// goal) and the usual for this month; every published Portal's count of the
// running month, drawn only when they add up to the governed figure; the
// established Portals that have gone quiet; the months of the goal and of the
// goals it took over from, and what changed (`monthly-portal-goal-history.ts`).
// And always the other Portal goals, with this month so far of the active ones
// and their subjects' names. It writes nothing.
import { goalSubjectIdentity, type GoalSubject } from '../../domain/goal-subject'
import { addLocalDays } from '../../domain/local-days'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalPageExtras,
  PortalGoalPageRows,
  PortalGoalPageTiles,
  PortalGoalPageView,
  PortalGoalQuietFact,
} from '../dto/monthly-portal-goal-page.types'
import type {
  PortalGoalOfCard,
  PortalGoalRunningMonth,
} from '../dto/monthly-portal-goal.types'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import type { GoalSubjectNameReader } from './goal-bulk-create'
import { listProgressOf } from './goal-list-progress'
import type { GoalActor, GoalExecutionPolicy } from './goal-programs'
import {
  gatherMonthlyPortalGoal,
  monthlyPortalGoalCardOf,
  type MonthlyPortalGoalCardDeps,
  type MonthlyPortalGoalCardRequestApi,
} from './monthly-portal-goal-card'
import type { MonthlyPortalGoalSetRequestApi } from './monthly-portal-goal'
import {
  goalChangesOf,
  goalMonthsOf,
  successionOf,
  type ShownMonths,
} from './monthly-portal-goal-history'

export type MonthlyPortalGoalPageDeps = MonthlyPortalGoalCardDeps &
  Readonly<{
    /** The names of the other Portal goals' Portal Groups, and of Portals not listed. */
    subjectNames: Pick<GoalSubjectNameReader, 'getSubjectName'>
  }>

const publishedOf = (recommendation: PortalGoalRecommendation) =>
  recommendation.portals.filter(
    ({ publicationState }) => publicationState === 'published',
  )

/** What the goal shows now: the month it counts, else the goal's own measure. */
const shownMeasure = (goal: PortalGoalOfCard) =>
  goal.month?.measure ?? goal.countingMonth?.measure ?? goal.measure

/**
 * Every published Portal's count of the running month, in name order, with what
 * the rest brought in, when they add up to the governed figure; else none.
 */
function rowsOf(
  recommendation: PortalGoalRecommendation,
  month: PortalGoalRunningMonth | null,
): PortalGoalPageRows | null {
  if (month === null || month.value === null) return null
  const { measure } = month
  if (
    recommendation.monthToDate[measure] === null ||
    month.key !== recommendation.months.current.key
  ) {
    return null
  }
  const portals = publishedOf(recommendation).map(({ portalId, name, monthToDate }) => ({
    portalId,
    name,
    count: monthToDate[measure],
  }))
  const elsewhere = recommendation.elsewhere[measure]
  const listed = portals.reduce((sum, { count }) => sum + count, 0)
  if (listed + elsewhere !== month.value) return null
  return { portals, elsewhere, total: month.value, truncated: recommendation.truncated }
}

/** The established published Portals that have gone quiet, by Portal. */
function factsOf(
  recommendation: PortalGoalRecommendation,
): Readonly<Record<string, PortalGoalQuietFact>> {
  return Object.fromEntries(
    publishedOf(recommendation).flatMap(({ portalId, inBasis, noScansSince }) =>
      inBasis && noScansSince !== null
        ? [
            [
              portalId,
              {
                noScansSince: noScansSince.since,
                usualPerWeek: noScansSince.usualPerWeek,
              },
            ],
          ]
        : [],
    ),
  )
}

/** The month the tiles stand beside: the one counting, or the first one to come. */
function anchorMonthOf(goal: PortalGoalOfCard, today: string): string {
  return (
    goal.month?.key ??
    goal.startsOn?.slice(0, 7) ??
    goal.countingMonth?.key ??
    today.slice(0, 7)
  )
}

function tilesOf(
  recommendation: PortalGoalRecommendation,
  goal: PortalGoalOfCard,
  months: PortalGoalPageView['months'],
  today: string,
): PortalGoalPageTiles {
  const before = addLocalDays(`${anchorMonthOf(goal, today)}-01`, -1).slice(0, 7)
  const whole = recommendation.measures[shownMeasure(goal)].fullMonth.current
  return {
    lastMonth: months.find(({ key }) => key === before) ?? {
      key: before,
      outcome: 'no_goal',
    },
    usual:
      whole === null || recommendation.basis === null
        ? null
        : { about: whole.about, weeks: recommendation.basis.weeks },
  }
}

/**
 * The other Portal goals' subjects by name: a Portal the recommendation lists
 * by its name there, any other Portal and each Portal Group asked of Portal.
 */
async function subjectNamesOf(
  deps: Pick<MonthlyPortalGoalPageDeps, 'subjectNames'>,
  goals: readonly GoalProgramBundle[],
  recommendation: PortalGoalRecommendation,
  scope: Readonly<{ organizationId: string; propertyId: string }>,
): Promise<PortalGoalPageExtras['subjectNames']> {
  const listed = new Map(
    [...recommendation.portals, ...recommendation.drafts].map(({ portalId, name }) => [
      goalSubjectIdentity({ kind: 'portal', portalId }),
      name,
    ]),
  )
  const subjects = new Map<string, Exclude<GoalSubject, Readonly<{ kind: 'property' }>>>()
  // The subjects each goal names now, as its row on the page does.
  const current = goals.flatMap(({ assignments, version }) =>
    assignments
      .filter(({ programVersionId }) => programVersionId === version.id)
      .map(({ subject }) => subject),
  )
  for (const subject of current) {
    if (subject.kind !== 'property') subjects.set(goalSubjectIdentity(subject), subject)
  }
  const named = await Promise.all(
    [...subjects].map(async ([key, subject]) => {
      const name =
        listed.get(key) ??
        (await deps.subjectNames.getSubjectName(
          scope.organizationId,
          scope.propertyId,
          subject,
        ))
      return name === null ? [] : [[key, name] as const]
    }),
  )
  return Object.fromEntries(named.flat())
}

export async function readMonthlyPortalGoalPage(
  deps: MonthlyPortalGoalPageDeps,
  input: Readonly<{ propertyId: string }>,
  actor: GoalActor,
): Promise<PortalGoalPageView> {
  const gathered = await gatherMonthlyPortalGoal(deps, input, actor)
  const { goal, programs, recommendation, now } = gathered
  const others = programs.filter(
    ({ program }) => program.status !== 'ended' && program.id !== goal?.program.id,
  )
  const [card, progress, subjectNames] = await Promise.all([
    monthlyPortalGoalCardOf(deps, gathered, actor),
    listProgressOf(deps, others, now, actor),
    subjectNamesOf(deps, others, recommendation, {
      organizationId: actor.organizationId,
      propertyId: input.propertyId,
    }),
  ])
  const page = {
    card,
    timezone: recommendation.timezone,
    portals: publishedOf(recommendation).map(({ name }) => name),
    facts: factsOf(recommendation),
    extras: { goals: others, progress, subjectNames },
  }
  if (goal === null || card.state !== 'goal') {
    return {
      ...page,
      tiles: null,
      rows: null,
      months: [],
      changes: [],
      anyMonthClosed: false,
    }
  }
  const succession = successionOf(programs, goal)
  const shown: ShownMonths = { month: card.goal.month, lastMonth: card.goal.lastMonth }
  const months = goalMonthsOf(succession, shown, now)
  return {
    ...page,
    tiles: tilesOf(recommendation, card.goal, months, card.today),
    rows: rowsOf(recommendation, card.goal.month),
    months,
    changes: goalChangesOf(succession, recommendation),
    anyMonthClosed: succession.some(({ results }) =>
      results.some(({ status }) => status === 'closed'),
    ),
  }
}

/** Request-facing: each invocation receives its scoped policy, like the Program reads. */
export type MonthlyPortalGoalRequestApi = Readonly<{
  monthlyPortalGoal: MonthlyPortalGoalCardRequestApi &
    Readonly<{
      page: (
        policy: GoalExecutionPolicy,
        input: Readonly<{ propertyId: string }>,
        actor: GoalActor,
      ) => Promise<PortalGoalPageView>
    }> &
    MonthlyPortalGoalSetRequestApi
}>
