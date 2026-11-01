import { ratingSubjectSkipsPrivateRating } from '../goal-rating-eligibility'
// Reporting — setting the Property's Monthly portal goal (ADR 0068, PLAN PG-09).
//
// The card's Use (and, later, the set sheet) makes an ordinary Goal Program:
// named "Monthly portal goal", with the Property as its one subject, counting
// private ratings or scans, from the month the card named. It asks the policy
// for `goal.create` before anything is read. One per Property is a screen rule
// and this pre-check, not a lock or a database rule: while any Property count
// goal that has not ended exists, on either measure, a set is refused
// `subject_has_goal`. Two sets in the same second on one measure meet the
// database's no-overlap rule instead, which refuses the second the same way
// (when the two inserts deadlock in that check, the repository runs the victim
// once more, and it meets the winner); on two measures both can land, and the
// earliest-created is the monthly goal.
//
// The number's source is stored for learning (decision 11): `recommended` only
// when the number is the one the card would offer for that month and measure
// now, otherwise `own`, whatever the request said. The engine (`createGoal`)
// refuses a target or a month it does not take, an Organization that is
// closing, and decides scheduled or active.
//
// Changing it (PLAN PG-14) is the engine's own commands, each wrapped to work
// on the Monthly portal goal only, and to record the number's source the same
// way: "November, now" changes the running month and the months after it
// (`changeMonthTarget`, `goal.update`); "From Dec 1" and "Count scans instead"
// change it from its next month (`revise`, `goal.update`), the Property still
// its one subject. Stop ends it (`goal.cancel`): the month it is counting
// keeps counting to its last day and keeps its result, and the months after
// are free for a new goal. Each asks the policy first, before anything is read.
//
// The month-start check-in (PLAN PG-15): its "Use 45" is the change now, with
// the number the sheet recommends for the month now, so it is recorded as
// recommended like any other; its Keep (`goal.update`) records the
// month it answered and nothing else: no version, no change row, the same
// again when pressed twice. Keep is taken only on the running month's first
// seven local days (`check_in_closed` otherwise) and only from a goal that
// runs.
//
// The Overview's "Not now" on the ready prompt (PLAN PG-16; `goal.create`, as
// the read that shows the prompt) records the month the prompt named, for the
// Property: it hides that month's prompt, never a later month's. A month
// already gone (a tab left open since) is taken and changes nothing; a month
// after next month's, which no prompt names, is refused.
//
// A goal for one Portal or one Portal Group takes the same changes from its own
// page (PLAN PG-21), its one subject kept, and its number recorded as
// recommended against its own numbers (the recommendation narrowed to it).
// The average takes a change of its level, now or from its next month, always
// the manager's own number (there is none to recommend), and never of what it
// measures. Every one of them takes Stop, a goal for several subjects too (its
// plain page offers nothing else).
import type { GoalMetric, GoalSubject } from '../../domain/goal-program'
import { goalStartOptions, monthKeyOf } from '../../domain/goal-start'
import type { PortalGoalMeasure } from '../../domain/goal-recommendation-types'
import { checkInMonthAt } from '../../domain/portal-goal-check-in'
import type {
  ChangeMonthlyPortalGoalNowRequest,
  DeferMonthlyPortalGoalPromptRequest,
  KeepMonthlyPortalGoalRequest,
  ReviseMonthlyPortalGoalRequest,
  SetMonthlyPortalGoalRequest,
  StopMonthlyPortalGoalRequest,
} from '../dto/monthly-portal-goal.types'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import {
  isPortalCountGoal,
  isPortalGoalMeasure,
  isPropertyCountGoal,
  monthlyPortalGoalOf,
  portalGoalPageOf,
  type PropertyCountGoal,
} from '../monthly-portal-goal-identity'
import type {
  GoalProgram,
  GoalProgramBundle,
  GoalProgramRepository,
} from '../ports/goal-program.repository'
import type { PortalGoalPromptDeferralStore } from '../ports/portal-goal-prompt-deferrals.port'
import type { GoalMonthTargetChangeResult } from './goal-month-target'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramService,
  type GoalProgramSubjectReader,
} from './goal-programs'
import {
  gatherPortalGoalFacts,
  gatherPortalGoalRecommendation,
  recommendationFrom,
  type PortalGoalRecommendationReads,
} from './goal-recommendation-read'
import { offeredChoices } from './monthly-portal-goal-offer'
import { narrowedFor, portalGoalAddBasisOf } from './portal-goal-add-numbers'

/** What the goal is called, everywhere it is named. */
export const MONTHLY_PORTAL_GOAL_NAME = 'Monthly portal goal'

export type MonthlyPortalGoalSetDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** Every Program of the Property, for the pre-check: nothing is hidden from it. */
  repository: Pick<GoalProgramRepository, 'list'>
  programs: Pick<GoalProgramService, 'create'>
  recommendation: PortalGoalRecommendationReads
  now: () => Date
}>

/** An own number needs eligibility facts, never a readable recommendation. */
async function assertPrivateRatingsAvailable(
  reads: PortalGoalRecommendationReads,
  scope: Readonly<{ organizationId: string; propertyId: string }>,
  subject: GoalSubject,
  now: Date,
): Promise<void> {
  const listed = await reads.facts.listPortalReadiness(
    scope.organizationId,
    scope.propertyId,
    now,
  )
  const skipped =
    subject.kind === 'property'
      ? !listed.truncated &&
        listed.portals.length > 0 &&
        listed.portals.every((portal) => portal.skipPrivateRating === true)
      : ratingSubjectSkipsPrivateRating(listed.portals, subject)
  if (skipped) throw new GoalProgramError('private_ratings_skipped')
}

const isRunning = (bundle: GoalProgramBundle): boolean =>
  isPropertyCountGoal(bundle) && bundle.program.status !== 'ended'

export async function setMonthlyPortalGoal(
  deps: MonthlyPortalGoalSetDeps,
  input: SetMonthlyPortalGoalRequest,
  actor: GoalActor,
): Promise<GoalProgramBundle> {
  const { organizationId } = actor
  const { propertyId, metric, targetValue, startMonth } = input
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId,
    action: 'goal.create',
  })
  // An average is never the Monthly portal goal: it has no count to aim for.
  if (!isPortalGoalMeasure(metric)) throw new GoalProgramError('invalid_target')
  const claimsRecommended = input.targetSource === 'recommended'
  const [programs, recommendation] = await Promise.all([
    deps.repository.list(organizationId, propertyId),
    claimsRecommended
      ? gatherPortalGoalRecommendation(deps.recommendation, {
          organizationId,
          propertyId,
          now: deps.now(),
        })
      : null,
    metric === 'portal_rating_count' && !claimsRecommended
      ? assertPrivateRatingsAvailable(
          deps.recommendation,
          { organizationId, propertyId },
          { kind: 'property', propertyId },
          deps.now(),
        )
      : undefined,
  ])
  if (metric === 'portal_rating_count' && recommendation?.ratingsAvailable === false)
    throw new GoalProgramError('private_ratings_skipped')
  if (programs.some(isRunning)) throw new GoalProgramError('subject_has_goal')
  const recommended =
    claimsRecommended &&
    recommendation !== null &&
    offeredChoices(recommendation, startMonth, metric)?.aBitMore === targetValue
  return deps.programs.create(
    {
      propertyId,
      name: MONTHLY_PORTAL_GOAL_NAME,
      description: null,
      metric,
      targetValue,
      subjects: [{ kind: 'property', propertyId }],
      startMonth,
      targetSource: recommended ? 'recommended' : 'own',
    },
    actor,
  )
}

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type MonthlyPortalGoalSetRequestApi = Readonly<{
  set: (
    policy: GoalExecutionPolicy,
    input: SetMonthlyPortalGoalRequest,
    actor: GoalActor,
  ) => Promise<GoalProgramBundle>
}>

export type MonthlyPortalGoalChangeDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** Every Program of the Property, to know which is the monthly goal. */
  repository: Pick<GoalProgramRepository, 'list'>
  programs: Pick<GoalProgramService, 'changeMonthTarget' | 'revise' | 'changeStatus'>
  recommendation: PortalGoalRecommendationReads
  now: () => Date
}>

type Action = 'goal.update' | 'goal.cancel'

/** Asks the policy for `action`, then reads every Program of the Property. */
async function authorizedPrograms(
  deps: Pick<MonthlyPortalGoalChangeDeps, 'policy' | 'repository'>,
  input: Readonly<{ propertyId: string }>,
  actor: GoalActor,
  action: Action,
): Promise<readonly GoalProgramBundle[]> {
  const { organizationId } = actor
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId: input.propertyId,
    action,
  })
  return deps.repository.list(organizationId, input.propertyId)
}

/** The Property's Monthly portal goal, when it is the Program asked for. */
function theMonthlyGoal(
  programs: readonly GoalProgramBundle[],
  programId: string,
  now: Date,
): PropertyCountGoal {
  const goal = monthlyPortalGoalOf(programs, now)
  if (goal === null || goal.program.id !== programId) {
    throw new GoalProgramError('invalid_subject')
  }
  return goal
}

/** A goal a change is made to, and the one subject it counts. */
type Changed = Readonly<{ goal: GoalProgramBundle; subject: GoalSubject }>

/**
 * The Program asked for, when a change is made to it here (PLAN PG-21): a count
 * goal for one Portal or one Portal Group, the average private rating, or else
 * the Property's Monthly portal goal. A count's number is recorded as
 * recommended against the subject's own.
 */
function theChangedGoal(
  programs: readonly GoalProgramBundle[],
  programId: string,
  now: Date,
): Changed {
  const asked = programs.find(({ program }) => program.id === programId)
  // Not among this Property's goals: the same answer as every goal command.
  if (asked === undefined) throw new GoalProgramError('not_found')
  const page = portalGoalPageOf(asked)
  if (page?.kind === 'subject' && isPortalCountGoal(asked)) {
    return { goal: asked, subject: page.subject }
  }
  if (page?.kind === 'average') {
    return { goal: asked, subject: page.subject }
  }
  const goal = theMonthlyGoal(programs, programId, now)
  return { goal, subject: { kind: 'property', propertyId: goal.program.propertyId } }
}

/**
 * A count stays a count (private ratings or scans, "Count scans instead"), and
 * the average stays the average: a change never turns one into the other.
 */
function assertSameKindOfMeasure(goal: GoalProgramBundle, metric: GoalMetric): void {
  const average = goal.version.metric === 'portal_rating_average'
  if (average !== (metric === 'portal_rating_average')) {
    throw new GoalProgramError('invalid_target')
  }
}

/** The recommendation for `subject`: the Property's, or the Property's narrowed to it. */
async function recommendationOf(
  deps: MonthlyPortalGoalChangeDeps,
  scope: Readonly<{ organizationId: string; propertyId: string }>,
  subject: GoalSubject,
): Promise<PortalGoalRecommendation> {
  const facts = await gatherPortalGoalFacts(deps.recommendation, {
    ...scope,
    now: deps.now(),
  })
  const recommendation = recommendationFrom(facts)
  return subject.kind === 'property'
    ? recommendation
    : narrowedFor(portalGoalAddBasisOf(facts, recommendation), subject)
}

/**
 * Whether `targetValue` is the number recommended for the `asked` month and
 * measure, read only when the screen said so (and the month is one of the
 * goal's counts).
 */
async function recordedSource(
  deps: MonthlyPortalGoalChangeDeps,
  claim: Readonly<{
    propertyId: string
    targetValue: number
    targetSource: 'recommended' | 'own'
  }>,
  actor: GoalActor,
  asked: Readonly<{ month: string; metric: GoalMetric; subject: GoalSubject }> | null,
): Promise<'recommended' | 'own'> {
  if (claim.targetSource !== 'recommended') {
    if (asked?.metric === 'portal_rating_count') {
      await assertPrivateRatingsAvailable(
        deps.recommendation,
        {
          organizationId: actor.organizationId,
          propertyId: claim.propertyId,
        },
        asked.subject,
        deps.now(),
      )
    }
    return 'own'
  }
  if (asked === null || !isPortalGoalMeasure(asked.metric)) return 'own'
  const recommendation = await recommendationOf(
    deps,
    { organizationId: actor.organizationId, propertyId: claim.propertyId },
    asked.subject,
  )
  const measure: PortalGoalMeasure = asked.metric
  if (measure === 'portal_rating_count' && recommendation.ratingsAvailable === false)
    throw new GoalProgramError('private_ratings_skipped')
  return offeredChoices(recommendation, asked.month, measure)?.aBitMore ===
    claim.targetValue
    ? 'recommended'
    : 'own'
}

/** What the month `month` counts: the measure of the version it opened under. */
function measureOfMonth(goal: GoalProgramBundle, month: string): GoalMetric | null {
  const result = goal.results.find(
    ({ periodStart, propertyTimezone }) =>
      monthKeyOf(periodStart, propertyTimezone) === month,
  )
  const version = goal.versions.find(({ id }) => id === result?.programVersionId)
  return version?.metric ?? null
}

/**
 * "November, now": the running month's number, and the months after it, which
 * are always given the new number too. The month locks only once it has ended,
 * so its last day still changes now.
 */
export async function changeMonthlyPortalGoalNow(
  deps: MonthlyPortalGoalChangeDeps,
  input: ChangeMonthlyPortalGoalNowRequest,
  actor: GoalActor,
): Promise<GoalMonthTargetChangeResult> {
  const programs = await authorizedPrograms(deps, input, actor, 'goal.update')
  const { goal, subject } = theChangedGoal(programs, input.programId, deps.now())
  const metric = measureOfMonth(goal, input.month)
  const targetSource = await recordedSource(
    deps,
    input,
    actor,
    metric === null ? null : { month: input.month, metric, subject },
  )
  return deps.programs.changeMonthTarget(
    {
      propertyId: input.propertyId,
      programId: input.programId,
      month: input.month,
      targetValue: input.targetValue,
      expectedTarget: input.expectedTarget,
      expectedVersion: input.expectedVersion,
      expectedFollowingMonth: input.expectedFollowingMonth,
      applyToFollowing: true,
      ...(input.note === undefined ? {} : { note: input.note }),
      targetSource,
    },
    actor,
  )
}

/**
 * "From Dec 1" and "Count scans instead": the goal from its next month, with
 * its one subject kept (the Property, or a goal's Portal or group); a goal
 * that has not started is changed from
 * its first month. It starts with the month the sheet said, or not at all: a
 * sheet read before the month turned is refused `start_month_changed` by the
 * engine, which works the start out after it has opened the months due.
 */
export async function reviseMonthlyPortalGoal(
  deps: MonthlyPortalGoalChangeDeps,
  input: ReviseMonthlyPortalGoalRequest,
  actor: GoalActor,
): Promise<GoalProgramBundle> {
  const programs = await authorizedPrograms(deps, input, actor, 'goal.update')
  const { goal, subject } = theChangedGoal(programs, input.programId, deps.now())
  assertSameKindOfMeasure(goal, input.metric)
  const targetSource = await recordedSource(deps, input, actor, {
    month: input.startMonth,
    metric: input.metric,
    subject,
  })
  return deps.programs.revise(
    {
      propertyId: input.propertyId,
      programId: input.programId,
      metric: input.metric,
      targetValue: input.targetValue,
      subjects: [subject],
      expectedVersion: input.expectedVersion,
      expectedStartMonth: input.startMonth,
      ...(input.note === undefined ? {} : { reason: input.note }),
      targetSource,
    },
    actor,
  )
}

/**
 * Stop: the goal ends. The month it is counting keeps counting to its last day
 * and keeps its result; a goal that has not started frees its month at once.
 * Any Property count goal may be stopped, and any goal with a page of its own
 * (one Portal's, one group's, the average's, and a goal for several subjects'
 * plain page); a goal that names no subject has none, so not from here. One
 * already stopped is refused `invalid_transition`: the engine takes ended to
 * ended as a status already reached, and would answer a conflict.
 */
export async function stopMonthlyPortalGoal(
  deps: MonthlyPortalGoalChangeDeps,
  input: StopMonthlyPortalGoalRequest,
  actor: GoalActor,
): Promise<GoalProgram> {
  const programs = await authorizedPrograms(deps, input, actor, 'goal.cancel')
  const asked = programs.find(({ program }) => program.id === input.programId)
  if (asked !== undefined && portalGoalPageOf(asked) === null) {
    throw new GoalProgramError('invalid_subject')
  }
  if (asked?.program.status === 'ended') throw new GoalProgramError('invalid_transition')
  return deps.programs.changeStatus(
    { propertyId: input.propertyId, programId: input.programId, status: 'ended' },
    actor,
  )
}

export type MonthlyPortalGoalKeepDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** Every Program of the Property, to know which is the monthly goal, and the answer's write. */
  repository: Pick<GoalProgramRepository, 'list' | 'answerCheckIn'>
  now: () => Date
}>

/**
 * The check-in's Keep: the month keeps its number, and its check-in is
 * answered for every manager. It is taken while the month the check-in asked
 * about runs and is on its first seven local days, cut in the zone the month
 * was cut in; and only from a goal that runs (a goal stopped since, before or
 * while this is written, is `invalid_transition`).
 */
export async function keepMonthlyPortalGoal(
  deps: MonthlyPortalGoalKeepDeps,
  input: KeepMonthlyPortalGoalRequest,
  actor: GoalActor,
): Promise<Readonly<{ month: string }>> {
  const programs = await authorizedPrograms(deps, input, actor, 'goal.update')
  const now = deps.now()
  const goal = theMonthlyGoal(programs, input.programId, now)
  if (goal.program.status !== 'active') throw new GoalProgramError('invalid_transition')
  const running = goal.results.find(
    ({ status, periodStart, periodEnd }) =>
      status === 'open' && periodStart <= now && now < periodEnd,
  )
  if (
    running === undefined ||
    monthKeyOf(running.periodStart, running.propertyTimezone) !== input.month ||
    checkInMonthAt(now, running.propertyTimezone) !== input.month
  ) {
    throw new GoalProgramError('check_in_closed')
  }
  const answered = await deps.repository.answerCheckIn({
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    programId: input.programId,
    month: input.month,
  })
  if (!answered) throw new GoalProgramError('invalid_transition')
  return { month: input.month }
}

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type MonthlyPortalGoalChangeRequestApi = Readonly<{
  changeNow: (
    policy: GoalExecutionPolicy,
    input: ChangeMonthlyPortalGoalNowRequest,
    actor: GoalActor,
  ) => Promise<GoalMonthTargetChangeResult>
  revise: (
    policy: GoalExecutionPolicy,
    input: ReviseMonthlyPortalGoalRequest,
    actor: GoalActor,
  ) => Promise<GoalProgramBundle>
  stop: (
    policy: GoalExecutionPolicy,
    input: StopMonthlyPortalGoalRequest,
    actor: GoalActor,
  ) => Promise<GoalProgram>
  keep: (
    policy: GoalExecutionPolicy,
    input: KeepMonthlyPortalGoalRequest,
    actor: GoalActor,
  ) => Promise<Readonly<{ month: string }>>
}>

export type MonthlyPortalGoalPromptDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** The Property's time zone, whose months the prompt names. */
  subjects: Pick<GoalProgramSubjectReader, 'getTimezone'>
  prompts: Pick<PortalGoalPromptDeferralStore, 'defer'>
  now: () => Date
}>

/**
 * The Overview prompt's "Not now": the prompt for `month` (and any earlier
 * month's) is not shown again; a later month's still is. It sets and changes no
 * goal, and the Goals page's card still offers the number.
 */
export async function deferMonthlyPortalGoalPrompt(
  deps: MonthlyPortalGoalPromptDeps,
  input: DeferMonthlyPortalGoalPromptRequest,
  actor: GoalActor,
): Promise<Readonly<{ month: string }>> {
  const { organizationId } = actor
  const { propertyId, month } = input
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId,
    action: 'goal.create',
  })
  const timezone = await deps.subjects.getTimezone(organizationId, propertyId)
  if (!timezone) throw new GoalProgramError('not_found')
  const now = deps.now()
  // A prompt names this month or the next; months are `YYYY-MM`, ordered as strings.
  if (month > goalStartOptions(now, timezone).next.monthKey) {
    throw new GoalProgramError('start_month_changed')
  }
  await deps.prompts.defer({
    organizationId,
    propertyId,
    month,
    deferredBy: actor.userId,
    deferredAt: now,
  })
  return { month }
}

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type MonthlyPortalGoalPromptRequestApi = Readonly<{
  defer: (
    policy: GoalExecutionPolicy,
    input: DeferMonthlyPortalGoalPromptRequest,
    actor: GoalActor,
  ) => Promise<Readonly<{ month: string }>>
}>
