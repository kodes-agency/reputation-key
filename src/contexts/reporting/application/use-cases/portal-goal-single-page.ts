// Reporting — the page of a goal for one Portal, one Portal Group, or the
// average private rating, on `$goalId` (ADR 0068, PLAN PG-21).
//
// One composed read, asked for `goal.create` like the Monthly portal goal's,
// since whoever sees a portal goal's page is whoever may set one. It reads the
// clock once, then the one Program asked for (the actor's visibility applied),
// and says which page it has before reading anything else. A Property count
// goal is the Monthly portal goal: it says so, and `$goalId` sends it to
// `/goals/portals`, with nothing more read. A count goal for one Portal or one
// Portal Group is shown as the Monthly portal goal is, from its own subject:
// the Property's recommendation narrowed to it (`narrowedFor`) gives its usual,
// its change sheet's offers and its Portals' go-lives, the governed read of
// its own subject gives its months, and the Property's other goals say
// whether its subject already holds the other measure (then no "Count scans
// instead"). It has no Portals' rows, no quiet Portals and no other goals, and
// no way to a next goal once stopped (that is "Add a portal goal"'s). The
// average has no number to recommend, so no recommendation is read: its level,
// while it is active this month's governed average or how many ratings it
// still needs, and its own months and changes, in its Property's zone. A goal
// for several subjects, made before goals had pages, has a plain page: whom it
// counts, this month as its row on the Goals page says it, and Stop. It writes
// nothing.
import { goalMonthDays } from '../../domain/goal-pace'
import { goalSubjectIdentity, type GoalSubject } from '../../domain/goal-subject'
import { localDateOf } from '../../domain/local-days'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type { PortalGoalPageView } from '../dto/monthly-portal-goal-page.types'
import type {
  PortalGoalAverageOfPage,
  PortalGoalSingleSubject,
  PortalGoalSinglePageView,
} from '../dto/portal-goal-single-page.types'
import { nextRevisionStart } from '../goal-revision-start'
import { subjectHolds } from '../goal-subject-holds'
import {
  isPortalCountGoal,
  portalGoalPageOf,
  type PortalCountGoal,
} from '../monthly-portal-goal-identity'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import { listProgressOf } from './goal-list-progress'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramService,
} from './goal-programs'
import { progressOf } from './goal-progress'
import { gatherPortalGoalFacts, recommendationFrom } from './goal-recommendation-read'
import { changeFactsOf } from './monthly-portal-goal-change-facts'
import {
  averageMeasureOf,
  goalChangesOf,
  goalMonthsOf,
} from './monthly-portal-goal-history'
import { portalGoalSheetFactsOf } from './monthly-portal-goal-offer'
import {
  subjectNamesOf,
  tilesOf,
  type MonthlyPortalGoalPageDeps,
} from './monthly-portal-goal-page'
import { monthKeyOf, monthlyPortalGoalOnCard } from './monthly-portal-goal-running'
import { narrowedFor, portalGoalAddBasisOf } from './portal-goal-add-numbers'

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
  const others = programs.filter(({ program }) => program.id !== bundle.program.id)
  const identity = goalSubjectIdentity(subject)
  return subjectHolds(others, other, period.start).some(
    (hold) => goalSubjectIdentity(hold.subject) === identity,
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
      page.card.state === 'goal' &&
      page.card.goal.change !== null &&
      otherMeasureHeld(programs, bundle, subject, { now, timezone }),
  }
}

/** A goal's status, its first day while it waits, and the day it was stopped. */
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
