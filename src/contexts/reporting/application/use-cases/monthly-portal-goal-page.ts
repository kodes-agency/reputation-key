// Reporting — the Monthly portal goal's page, `/goals/portals` (ADR 0068, PLAN
// PG-13).
//
// One composed read, asked for `goal.create` like the card, since whoever sees
// the page is whoever may set the goal. It reads what the card reads, once, and
// returns the card's arm: before a goal it is what the page shows. With a goal,
// it adds what the page shows beside it: the month before (or that it had no
// goal) and the usual for the month the goal counts or starts; every published
// Portal's count of the running month, drawn only when they add up to the
// governed figure; and the established Portals that have gone quiet. With a
// goal or after one, the months of the goal and of the goals it took over from,
// and what changed (`monthly-portal-goal-history.ts`): a stopped goal whose last
// month has closed is no goal any more, but its months are still here. And
// always the other Portal goals, with this month so far of the active ones and
// their subjects' names: side reads, so a failure there leaves the page whole
// and says so. It writes nothing.
import type { LoggerPort } from '#/shared/domain/logger.port'
import { goalSubjectIdentity, type GoalSubject } from '../../domain/goal-subject'
import { addLocalDays, localDateOf } from '../../domain/local-days'
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
import { inParallel, listProgressOf } from './goal-list-progress'
import type { GoalActor, GoalExecutionPolicy } from './goal-programs'
import {
  gatherMonthlyPortalGoal,
  monthlyPortalGoalCardOf,
  type MonthlyPortalGoalCardDeps,
  type MonthlyPortalGoalCardRequestApi,
} from './monthly-portal-goal-card'
import type {
  MonthlyPortalGoalChangeRequestApi,
  MonthlyPortalGoalPromptRequestApi,
  MonthlyPortalGoalSetRequestApi,
} from './monthly-portal-goal'
import type { MonthlyPortalGoalLineRequestApi } from './monthly-portal-goal-line'
import {
  goalChangesOf,
  goalMonthsOf,
  successionOf,
  type ShownMonths,
} from './monthly-portal-goal-history'
import { monthCountsOf } from './monthly-portal-goal-running'

export type MonthlyPortalGoalPageDeps = MonthlyPortalGoalCardDeps &
  Readonly<{
    /** The names of the other Portal goals' Portal Groups, and of Portals not listed. */
    subjectNames: Pick<GoalSubjectNameReader, 'getSubjectName'>
    /** A side read that failed: the page still draws, without it. */
    logger: Pick<LoggerPort, 'warn'>
  }>

/** Subject names asked of Portal at once. */
const SUBJECT_NAME_CONCURRENCY = 3

/** Before a goal the card shows no month. */
const NOTHING_SHOWN: ShownMonths = { month: null, lastMonth: null }

const publishedOf = (recommendation: PortalGoalRecommendation) =>
  recommendation.portals.filter(
    ({ publicationState }) => publicationState === 'published',
  )

/** What the goal shows now: the month it counts, else the goal's own measure. */
const shownMeasure = (goal: PortalGoalOfCard) =>
  goal.month?.measure ?? goal.countingMonth?.measure ?? goal.measure

/**
 * Every published Portal's count of the running month, in name order (up to
 * 100), with what the rest brought in, when they add up to the governed
 * figure; else none.
 */
function rowsOf(
  recommendation: PortalGoalRecommendation,
  month: PortalGoalRunningMonth | null,
): PortalGoalPageRows | null {
  const counts = month === null ? null : monthCountsOf(recommendation, month)
  return counts === null ? null : { ...counts, truncated: recommendation.truncated }
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

/**
 * P-4's tiles beside the month the goal counts or starts; the page of a goal
 * for one Portal or one group (PG-21) works them out the same way, from its own
 * numbers.
 */
export function tilesOf(
  recommendation: PortalGoalRecommendation,
  goal: PortalGoalOfCard,
  months: PortalGoalPageView['months'],
  today: string,
): PortalGoalPageTiles {
  const anchor = anchorMonthOf(goal, today)
  const before = addLocalDays(`${anchor}-01`, -1).slice(0, 7)
  // The usual of the month the tiles stand beside: next month's days for a
  // goal that starts then, as its card offered it.
  const { fullMonth } = recommendation.measures[shownMeasure(goal)]
  const whole =
    anchor === recommendation.months.next.key ? fullMonth.next : fullMonth.current
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
 * by its name there, any other Portal and each Portal Group asked of Portal, a
 * few at a time. A name that cannot be read is left out (the row says
 * "Portal" or "Group"), and the failure is logged once.
 */
async function subjectNamesOf(
  deps: Pick<MonthlyPortalGoalPageDeps, 'subjectNames' | 'logger'>,
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
  let failure: unknown = null
  const named = await inParallel(
    [...subjects],
    SUBJECT_NAME_CONCURRENCY,
    async ([key, subject]) => {
      const known = listed.get(key)
      if (known !== undefined) return [[key, known] as const]
      try {
        const name = await deps.subjectNames.getSubjectName(
          scope.organizationId,
          scope.propertyId,
          subject,
        )
        return name === null ? [] : [[key, name] as const]
      } catch (error) {
        failure = error
        return []
      }
    },
  )
  if (failure !== null) {
    // Identifiers stay out of the log: the request's own trace names the page.
    deps.logger.warn(
      { error: failure },
      "A name of the other portal goals' subjects could not be read",
    )
  }
  return Object.fromEntries(named.flat())
}

/**
 * The other Portal goals, with this month so far of the active ones (null when
 * it could not be read: their rows say so) and their subjects' names.
 */
async function extrasOf(
  deps: MonthlyPortalGoalPageDeps,
  goals: readonly GoalProgramBundle[],
  recommendation: PortalGoalRecommendation,
  context: Readonly<{ now: Date; actor: GoalActor; propertyId: string }>,
): Promise<PortalGoalPageExtras> {
  const { now, actor, propertyId } = context
  const [progress, subjectNames] = await Promise.all([
    listProgressOf(deps, goals, now, actor).catch((error: unknown) => {
      deps.logger.warn(
        { error },
        "The other portal goals' month so far could not be read",
      )
      return null
    }),
    subjectNamesOf(deps, goals, recommendation, {
      organizationId: actor.organizationId,
      propertyId,
    }),
  ])
  return { goals, progress, subjectNames }
}

export async function readMonthlyPortalGoalPage(
  deps: MonthlyPortalGoalPageDeps,
  input: Readonly<{ propertyId: string }>,
  actor: GoalActor,
): Promise<PortalGoalPageView> {
  const gathered = await gatherMonthlyPortalGoal(deps, input, actor)
  const { goal, programs, recommendation, now } = gathered
  const today = localDateOf(now, recommendation.timezone)
  const others = programs.filter(
    ({ program }) => program.status !== 'ended' && program.id !== goal?.program.id,
  )
  const [card, extras] = await Promise.all([
    monthlyPortalGoalCardOf(deps, gathered, actor),
    extrasOf(deps, others, recommendation, { now, actor, propertyId: input.propertyId }),
  ])
  // After the card: its governed figures are the months it shows, so only a
  // month it does not show is read again.
  const succession = successionOf(programs, goal)
  const shown: ShownMonths =
    card.state === 'goal'
      ? { month: card.goal.month, lastMonth: card.goal.lastMonth }
      : NOTHING_SHOWN
  const months = await goalMonthsOf(deps, succession, shown, { now, today, actor })
  const page = {
    card,
    today,
    timezone: recommendation.timezone,
    portals: publishedOf(recommendation).map(({ portalId, name }) => ({
      portalId,
      name,
    })),
    facts: factsOf(recommendation),
    months,
    changes: goalChangesOf(succession, recommendation),
    anyMonthClosed: succession.some(({ results }) =>
      results.some(({ status }) => status === 'closed'),
    ),
    extras,
  }
  if (card.state !== 'goal') return { ...page, tiles: null, rows: null }
  return {
    ...page,
    tiles: tilesOf(recommendation, card.goal, months, today),
    rows: rowsOf(recommendation, card.goal.month),
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
    MonthlyPortalGoalSetRequestApi &
    MonthlyPortalGoalChangeRequestApi &
    MonthlyPortalGoalPromptRequestApi &
    MonthlyPortalGoalLineRequestApi
}>
