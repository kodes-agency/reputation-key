// Reporting — the page of a goal for one Portal, one Portal Group, or the
// average private rating, on `$goalId` (ADR 0068, PLAN PG-21).
//
// One composed read, asked for `goal.create` like the Monthly portal goal's,
// since whoever sees a portal goal's page is whoever may set one. It reads the
// clock once, then the Programs the actor may see and the recommendation's
// facts together. A Property count goal is the Monthly portal goal: it says so,
// and `$goalId` sends it to `/goals/portals`. A count goal for one Portal or one
// Portal Group is shown as the Monthly portal goal is, from its own subject:
// the Property's recommendation narrowed to it (`narrowedFor`) gives its usual,
// its change sheet's offers and its Portals' go-lives, and the governed read of
// its own subject gives its months. It has no Portals' rows, no quiet Portals
// and no other goals, and no way to a next goal once stopped (that is "Add a
// portal goal"'s). The average has no number to recommend: its level and, while
// it is active, this month's governed average, or how many ratings it still
// needs. A goal for several subjects has no page. It writes nothing.
import { goalMonthDays } from '../../domain/goal-pace'
import type { GoalSubject } from '../../domain/goal-subject'
import { localDateOf } from '../../domain/local-days'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type { PortalGoalPageView } from '../dto/monthly-portal-goal-page.types'
import type {
  PortalGoalAverageOfPage,
  PortalGoalSingleSubject,
  PortalGoalSinglePageView,
} from '../dto/portal-goal-single-page.types'
import {
  isPortalCountGoal,
  portalGoalPageOf,
  type PortalCountGoal,
} from '../monthly-portal-goal-identity'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
} from './goal-programs'
import { progressOf } from './goal-progress'
import { gatherPortalGoalFacts, recommendationFrom } from './goal-recommendation-read'
import { changeFactsOf } from './monthly-portal-goal-change-facts'
import { goalChangesOf, goalMonthsOf } from './monthly-portal-goal-history'
import { portalGoalSheetFactsOf } from './monthly-portal-goal-offer'
import { tilesOf, type MonthlyPortalGoalPageDeps } from './monthly-portal-goal-page'
import { monthKeyOf, monthlyPortalGoalOnCard } from './monthly-portal-goal-running'
import { narrowedFor, portalGoalAddBasisOf } from './portal-goal-add-numbers'

export type PortalGoalSinglePageInput = Readonly<{
  propertyId: string
  programId: string
}>

type Context = Readonly<{
  now: Date
  today: string
  actor: GoalActor
  scope: Readonly<{ organizationId: string; propertyId: string }>
}>

/** A Portal by the name the recommendation lists it with; else, and a group, asked of Portal. */
async function subjectNameOf(
  deps: Pick<MonthlyPortalGoalPageDeps, 'subjectNames'>,
  subject: GoalSubject,
  recommendation: PortalGoalRecommendation,
  scope: Context['scope'],
): Promise<PortalGoalSingleSubject> {
  if (subject.kind === 'property') return { kind: 'property', name: null }
  if (subject.kind === 'portal') {
    const listed = [...recommendation.portals, ...recommendation.drafts].find(
      ({ portalId }) => portalId === subject.portalId,
    )
    if (listed) return { kind: 'portal', name: listed.name }
  }
  const name = await deps.subjectNames.getSubjectName(
    scope.organizationId,
    scope.propertyId,
    subject,
  )
  return { kind: subject.kind, name }
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

/** The average: its level, and while it is active this month's governed figure. */
async function averageOf(
  deps: MonthlyPortalGoalPageDeps,
  bundle: GoalProgramBundle,
  subject: GoalSubject,
  context: Context & Readonly<{ timezone: string }>,
): Promise<PortalGoalAverageOfPage> {
  const { program, version } = bundle
  const { now, actor, timezone } = context
  const goal = {
    programId: program.id,
    status: program.status,
    target: version.targetValue,
    startsOn: null,
    month: null,
    change: changeFactsOf(bundle, now, timezone),
  } satisfies PortalGoalAverageOfPage
  if (program.status === 'scheduled') {
    return {
      ...goal,
      startsOn: localDateOf(version.effectiveFrom, version.propertyTimezone),
    }
  }
  if (program.status !== 'active') return goal
  const progress = await progressOf(deps, bundle, subject, 'active', now, actor)
  if (progress === null || progress.reading.kind === 'not_started') return goal
  const { period, reading, targetValue } = progress
  return {
    ...goal,
    month: {
      key: monthKeyOf(period.start, progress.timezone),
      target: targetValue,
      daysAfterToday: goalMonthDays(period, now, progress.timezone).daysLeft,
      reading,
    },
  }
}

export async function readPortalGoalSinglePage(
  deps: MonthlyPortalGoalPageDeps,
  input: PortalGoalSinglePageInput,
  actor: GoalActor,
): Promise<PortalGoalSinglePageView> {
  const { organizationId } = actor
  const { propertyId } = input
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId,
    action: 'goal.create',
  })
  const now = deps.now()
  const scope = { organizationId, propertyId }
  const [programs, facts] = await Promise.all([
    deps.reads.list(propertyId, actor),
    gatherPortalGoalFacts(deps.recommendation, { ...scope, now }),
  ])
  const bundle = programs.find(({ program }) => program.id === input.programId)
  const page = bundle === undefined ? null : portalGoalPageOf(bundle)
  if (bundle === undefined || page === null) throw new GoalProgramError('not_found')
  if (page.kind === 'monthly') return { kind: 'monthly' }
  const recommendation = recommendationFrom(facts)
  const context = { now, today: localDateOf(now, recommendation.timezone), actor, scope }
  const subject = await subjectNameOf(deps, page.subject, recommendation, scope)
  if (page.kind === 'average') {
    const { timezone } = recommendation
    return {
      kind: 'average',
      subject,
      today: context.today,
      goal: await averageOf(deps, bundle, page.subject, { ...context, timezone }),
    }
  }
  if (!isPortalCountGoal(bundle) || page.subject.kind === 'property') {
    throw new GoalProgramError('not_found')
  }
  const narrowed = narrowedFor(portalGoalAddBasisOf(facts, recommendation), page.subject)
  return {
    kind: 'subject',
    subject,
    page: await subjectPageOf(deps, bundle, narrowed, context),
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
