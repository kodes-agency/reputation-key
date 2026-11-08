// Authorize and apply Program visibility before reading details (ADR 0068).
// Each page keeps its own governed figures; Stop retains due months even when
// progress cannot be read. Historical assignments and results remain intact.

import { goalMonthDays } from '../domain/goal-pace'
import { goalSubjectIdentity, type GoalSubject } from '../domain/goal-subject'
import { localDateOf } from '../domain/local-days'
import type { PortalGoalRecommendation } from '../application/dto/goal-recommendation.types'
import type { PortalGoalPageView } from '../application/dto/monthly-portal-goal-page.types'
import type {
  PortalGoalAverageOfPage,
  PortalGoalSingleSubject,
  PortalGoalSinglePageView,
} from '../application/dto/portal-goal-single-page.types'
import { nextRevisionStart } from '../application/goal-revision-start'
import { assignmentHoldsFrom } from './subject-assignments.server'
import {
  isPortalCountGoal,
  portalGoalPageOf,
  type PortalCountGoal,
} from '../application/monthly-portal-goal-identity'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import { listProgressOf } from '../application/use-cases/goal-list-progress'
import { dueResultsForProgram } from '../application/use-cases/goal-program-shared'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramService,
} from './goal-programs.server'
import { progressOf } from '../application/use-cases/goal-progress'
import {
  gatherPortalGoalFacts,
  recommendationFrom,
} from '../application/use-cases/goal-recommendation-read'
import { changeFactsOf } from './monthly-portal-goal-change-facts.server'
import {
  averageMeasureOf,
  goalChangesOf,
  goalMonthsOf,
} from './monthly-portal-goal-history.server'
import { portalGoalSheetFactsOf } from './monthly-portal-goal-offer.server'
import {
  subjectNamesOf,
  tilesOf,
  type MonthlyPortalGoalPageDeps,
} from './monthly-portal-goal-page.server'
import { monthKeyOf, monthlyPortalGoalOnCard } from './monthly-portal-goal-running.server'
import {
  narrowedFor,
  portalGoalAddBasisOf,
} from '../application/use-cases/portal-goal-add-numbers'

export type PortalGoalSinglePageDeps = MonthlyPortalGoalPageDeps &
  Readonly<{
    /** The Programs the actor may see: the one asked for, and the Property's. */
    reads: Pick<GoalProgramService, 'get' | 'list'>
  }>

export type PortalGoalSinglePageInput = Readonly<{
  propertyId: string
  programId: string
}>

type Scope = Readonly<{ organizationId: string; propertyId: string }>

type Context = Readonly<{
  now: Date
  today: string
  actor: GoalActor
  scope: Scope
}>

/** A subject by the names the read has, else (a group, a Portal not listed) asked of Portal. */
async function subjectNameOf(
  deps: Pick<MonthlyPortalGoalPageDeps, 'subjectNames'>,
  subject: GoalSubject,
  scope: Scope,
  listed: Readonly<Record<string, string>> = {},
): Promise<PortalGoalSingleSubject> {
  const key = goalSubjectIdentity(subject)
  if (subject.kind === 'property') return { kind: 'property', key, name: null }
  const known = listed[key]
  if (known !== undefined) return { kind: subject.kind, key, name: known }
  const name = await deps.subjectNames.getSubjectName(
    scope.organizationId,
    scope.propertyId,
    subject,
  )
  return { kind: subject.kind, key, name }
}

/** The Portals the recommendation lists, by `portal:<id>`. */
const listedPortals = (recommendation: PortalGoalRecommendation) =>
  Object.fromEntries(
    [...recommendation.portals, ...recommendation.drafts].map(({ portalId, name }) => [
      goalSubjectIdentity({ kind: 'portal', portalId }),
      name,
    ]),
  )

/**
 * The subject already holds a goal for the other measure from the month a
 * change of measure would start, so "Count scans instead" would be refused.
 */
function otherMeasureHeld(
  programs: readonly GoalProgramBundle[],
  bundle: PortalCountGoal,
  subject: GoalSubject,
  context: Readonly<{ now: Date; timezone: string }>,
): boolean {
  const other =
    bundle.version.metric === 'portal_rating_count'
      ? 'qualified_scans'
      : 'portal_rating_count'
  const { period } = nextRevisionStart(bundle, context.now, context.timezone)
  const identity = goalSubjectIdentity(subject)
  return programs.some(
    ({ program, assignments }) =>
      program.id !== bundle.program.id &&
      assignments.some(
        (assignment) =>
          assignment.metric === other &&
          goalSubjectIdentity(assignment.subject) === identity &&
          assignmentHoldsFrom(assignment, period.start),
      ),
  )
}

/** A Portal's or a group's count goal, as the Monthly portal goal's page shows one. */
async function subjectPageOf(
  deps: MonthlyPortalGoalPageDeps,
  bundle: PortalCountGoal,
  narrowed: PortalGoalRecommendation,
  context: Context,
): Promise<PortalGoalPageView> {
  const { now, today, actor } = context
  const shown = await monthlyPortalGoalOnCard(deps, bundle, {
    recommendation: narrowed,
    now,
    actor,
  })
  // Its page draws no Portals' rows, and a next goal is "Add a portal goal"'s.
  const goal = { ...shown, rows: null, newGoalFrom: null }
  const months = await goalMonthsOf(
    deps,
    [bundle],
    { month: goal.month, lastMonth: goal.lastMonth },
    { now, today, actor },
  )
  return {
    card: { state: 'goal', today, goal, sheet: portalGoalSheetFactsOf(narrowed) },
    today,
    timezone: narrowed.timezone,
    portals: [],
    tiles: tilesOf(narrowed, goal, months, today),
    rows: null,
    facts: {},
    months,
    changes: goalChangesOf([bundle], narrowed),
    extras: { goals: [], progress: [], subjectNames: {} },
    anyMonthClosed: bundle.results.some(({ status }) => status === 'closed'),
  }
}

async function subjectViewOf(
  deps: PortalGoalSinglePageDeps,
  bundle: PortalCountGoal,
  subject: Exclude<GoalSubject, Readonly<{ kind: 'property' }>>,
  context: Omit<Context, 'today'>,
): Promise<PortalGoalSinglePageView> {
  const { now, actor, scope } = context
  const [programs, facts] = await Promise.all([
    deps.reads.list(scope.propertyId, actor),
    gatherPortalGoalFacts(deps.recommendation, { ...scope, now }),
  ])
  const recommendation = recommendationFrom(facts)
  const { timezone } = recommendation
  const today = localDateOf(now, timezone)
  const narrowed = narrowedFor(portalGoalAddBasisOf(facts, recommendation), subject)
  const [named, page] = await Promise.all([
    subjectNameOf(deps, subject, scope, listedPortals(recommendation)),
    subjectPageOf(deps, bundle, narrowed, { ...context, today }),
  ])
  return {
    kind: 'subject',
    subject: named,
    page,
    otherMeasureHeld:
      narrowed.staffTarget === true ||
      (page.card.state === 'goal' &&
        page.card.goal.change !== null &&
        otherMeasureHeld(programs, bundle, subject, { now, timezone })),
  }
}

/** Stop opens due months before ending; progress and change availability cannot say what it retains. */
function retainedMonthOnStop(
  bundle: GoalProgramBundle,
  now: Date,
): Readonly<{ key: string }> | null {
  if (bundle.program.status === 'scheduled') return null
  const months = [
    ...bundle.results,
    ...(bundle.program.status === 'active'
      ? dueResultsForProgram(bundle, () => '', now)
      : []),
  ].filter(({ status }) => status === 'open' || status === 'reconciling')
  const latest = months.reduce<(typeof months)[number] | null>(
    (last, month) => (!last || month.periodEnd > last.periodEnd ? month : last),
    null,
  )
  return latest ? { key: monthKeyOf(latest.periodStart, latest.propertyTimezone) } : null
}

/** A goal's status, its first day while it waits, and the months Stop retains. */
function goalOfPage(bundle: GoalProgramBundle, now: Date, timezone: string) {
  const { program, version } = bundle
  return {
    programId: program.id,
    status: program.status,
    target: version.targetValue,
    startsOn:
      program.status === 'scheduled'
        ? localDateOf(version.effectiveFrom, version.propertyTimezone)
        : null,
    endedOn:
      program.status === 'ended' && program.endedAt
        ? localDateOf(program.endedAt, timezone)
        : null,
    countingMonth: retainedMonthOnStop(bundle, now),
    change: changeFactsOf(bundle, now, timezone),
  }
}

/** The average's month while it is active: its governed figure, or the ratings it needs. */
async function averageMonthOf(
  deps: MonthlyPortalGoalPageDeps,
  bundle: GoalProgramBundle,
  subject: GoalSubject,
  context: Readonly<{ now: Date; actor: GoalActor }>,
): Promise<PortalGoalAverageOfPage['month']> {
  if (bundle.program.status !== 'active') return null
  const { now, actor } = context
  const progress = await progressOf(deps, bundle, subject, 'active', now, actor)
  if (progress === null || progress.reading.kind === 'not_started') return null
  const { period, reading, targetValue } = progress
  return {
    key: monthKeyOf(period.start, progress.timezone),
    target: targetValue,
    daysAfterToday: goalMonthDays(period, now, progress.timezone).daysLeft,
    reading,
  }
}

/**
 * The average: its level, this month while it is active, and its own months
 * and changes (no go-lives: no recommendation is read for it).
 */
async function averageViewOf(
  deps: MonthlyPortalGoalPageDeps,
  bundle: GoalProgramBundle,
  subject: GoalSubject,
  context: Omit<Context, 'today'>,
): Promise<PortalGoalSinglePageView> {
  const { now, actor, scope } = context
  const timezone = bundle.version.propertyTimezone
  const today = localDateOf(now, timezone)
  const [named, month] = await Promise.all([
    subjectNameOf(deps, subject, scope),
    averageMonthOf(deps, bundle, subject, { now, actor }),
  ])
  const goal = {
    ...goalOfPage(bundle, now, timezone),
    version: bundle.program.currentVersion,
    month,
  }
  const shown = month && {
    key: month.key,
    measure: 'portal_rating_average' as const,
    value: month.reading.kind === 'live' ? month.reading.value : null,
  }
  const months = await goalMonthsOf(
    deps,
    [bundle],
    { month: shown, lastMonth: null },
    { now, today, actor },
    averageMeasureOf,
  )
  return {
    kind: 'average',
    subject: named,
    today,
    goal,
    months,
    changes: goalChangesOf([bundle], { timezone, portals: [] }, averageMeasureOf),
  }
}

/** A goal for several subjects: whom it counts, and this month as the Goals list reads it. */
async function severalViewOf(
  deps: MonthlyPortalGoalPageDeps,
  bundle: GoalProgramBundle,
  subjects: readonly GoalSubject[],
  context: Omit<Context, 'today'>,
): Promise<PortalGoalSinglePageView> {
  const { now, actor, scope } = context
  const facts = await gatherPortalGoalFacts(deps.recommendation, { ...scope, now })
  const recommendation = recommendationFrom(facts)
  const { timezone } = recommendation
  const [names, progress] = await Promise.all([
    subjectNamesOf(deps, [bundle], recommendation, scope),
    listProgressOf(deps, [bundle], now, actor).catch((error: unknown) => {
      deps.logger.warn({ error }, "A goal's month so far could not be read")
      return []
    }),
  ])
  const named = await Promise.all(
    subjects.map((subject) => subjectNameOf(deps, subject, scope, names)),
  )
  return {
    kind: 'several',
    subjects: named,
    today: localDateOf(now, timezone),
    goal: {
      ...goalOfPage(bundle, now, timezone),
      metric: bundle.version.metric,
      live: progress[0] ?? null,
    },
  }
}

export async function readPortalGoalSinglePage(
  deps: PortalGoalSinglePageDeps,
  input: PortalGoalSinglePageInput,
  actor: GoalActor,
): Promise<PortalGoalSinglePageView> {
  const { organizationId } = actor
  const { propertyId, programId } = input
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId,
    action: 'goal.create',
  })
  const now = deps.now()
  const context = { now, actor, scope: { organizationId, propertyId } }
  const bundle = await deps.reads.get({ propertyId, programId }, actor)
  const page = portalGoalPageOf(bundle)
  if (page === null) throw new GoalProgramError('not_found')
  switch (page.kind) {
    case 'monthly':
      return { kind: 'monthly' }
    case 'several':
      return severalViewOf(deps, bundle, page.subjects, context)
    case 'average':
      return averageViewOf(deps, bundle, page.subject, context)
    case 'subject':
      if (!isPortalCountGoal(bundle) || page.subject.kind === 'property') {
        throw new GoalProgramError('not_found')
      }
      return subjectViewOf(deps, bundle, page.subject, context)
  }
}

/** Request-facing: each invocation receives its scoped policy, like the Program reads. */
export type PortalGoalSinglePageRequestApi = Readonly<{
  portalGoalSingle: Readonly<{
    page: (
      policy: GoalExecutionPolicy,
      input: PortalGoalSinglePageInput,
      actor: GoalActor,
    ) => Promise<PortalGoalSinglePageView>
  }>
}>
