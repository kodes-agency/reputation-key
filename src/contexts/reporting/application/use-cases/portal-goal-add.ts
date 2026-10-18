// Reporting — adding a portal goal (ADR 0068, PLAN PG-20).
//
// The add sheet's two commands, each an ordinary Goal Program written by the
// engine's own create (no new rule, no new storage):
//
// - `addPortalGoal`: a goal for one Portal or one Portal Group, counting
//   private ratings or scans, or the average private rating for the whole
//   Property. It goes through `createGoal`, named as a goal set for several
//   subjects names each one ("Reception · Private ratings"; the average is
//   "Average private rating").
// - `addPortalGoals`: a goal for each ticked Portal, all in one month and
//   measure, through `createGoalsForSubjects`: each row is its own goal, and a
//   row that cannot be saved is reported without holding the others back.
//
// Both ask the policy for `goal.create` before anything is read. The number's
// source is stored for learning (decision 11): `recommended` only when it is
// the number the sheet would offer that subject for that month and measure
// now, otherwise `own`, whatever the request said. A Property count goal is
// never made here: that is the Monthly portal goal, set from its card.
import { MAX_GOAL_BULK_ITEMS } from '../../domain/goal-bulk-create'
import type { GoalTargetSource } from '../../domain/goal-program'
import type {
  AddPortalGoalRequest,
  AddPortalGoalsRequest,
  AddPortalGoalsResult,
  PortalGoalAddOptions,
  PortalGoalAddSubject,
} from '../dto/monthly-portal-goal-add.types'
import { goalMetricLabel } from '../goal-metric-label'
import { isPortalGoalMeasure } from '../monthly-portal-goal-identity'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import {
  subjectGoalName,
  type GoalBulkCreateInput,
  type GoalBulkCreateResult,
  type GoalSubjectNameReader,
} from './goal-bulk-create'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramService,
} from './goal-programs'
import {
  gatherPortalGoalFacts,
  recommendationFrom,
  type PortalGoalRecommendationReads,
} from './goal-recommendation-read'
import { portalGoalAddBasisOf, recommendedNumberFor } from './portal-goal-add-numbers'

export type PortalGoalAddDeps = Readonly<{
  policy: GoalExecutionPolicy
  programs: Pick<GoalProgramService, 'create'>
  createForSubjects: (
    input: GoalBulkCreateInput,
    actor: GoalActor,
  ) => Promise<GoalBulkCreateResult>
  subjectNames: Pick<GoalSubjectNameReader, 'getSubjectName'>
  recommendation: PortalGoalRecommendationReads
  now: () => Date
}>

type Scope = Readonly<{ organizationId: string; propertyId: string }>

async function authorize(deps: PortalGoalAddDeps, scope: Scope, actor: GoalActor) {
  await deps.policy.authorize({ actor, ...scope, action: 'goal.create' })
}

/**
 * Where each number came from: `recommended` only for a subject whose number,
 * in that month and measure, is the one the sheet offers it now. The
 * recommendation is read only when the request claims one.
 */
async function sourcesOf(
  deps: PortalGoalAddDeps,
  scope: Scope,
  request: Readonly<{ metric: string; startMonth: string }>,
  rows: readonly Readonly<{
    subject: PortalGoalAddSubject
    targetValue: number
    targetSource: GoalTargetSource
  }>[],
): Promise<readonly GoalTargetSource[]> {
  if (rows.every(({ targetSource }) => targetSource === 'own')) {
    return rows.map(() => 'own')
  }
  const facts = await gatherPortalGoalFacts(deps.recommendation, {
    ...scope,
    now: deps.now(),
  })
  const basis = portalGoalAddBasisOf(facts, recommendationFrom(facts))
  const offered = basis.month === request.startMonth && basis.measure === request.metric
  return rows.map(({ subject, targetValue, targetSource }) =>
    targetSource === 'recommended' &&
    offered &&
    recommendedNumberFor(basis, subject) === targetValue
      ? 'recommended'
      : 'own',
  )
}

/** A Portal's or a group's goal is named for it; the Property's average for the measure. */
async function goalNameOf(
  deps: PortalGoalAddDeps,
  scope: Scope,
  request: AddPortalGoalRequest,
): Promise<string> {
  const { subject, metric } = request
  if (subject.kind === 'property') return goalMetricLabel(metric)
  const name = await deps.subjectNames.getSubjectName(
    scope.organizationId,
    scope.propertyId,
    subject,
  )
  if (name === null) throw new GoalProgramError('invalid_subject')
  return subjectGoalName(name, metric)
}

/**
 * A goal for one Portal or one Portal Group (private ratings or scans), or the
 * Property's average private rating. A count goal for the Property alone is
 * refused (`invalid_subject`): it is the Monthly portal goal.
 */
export async function addPortalGoal(
  deps: PortalGoalAddDeps,
  request: AddPortalGoalRequest,
  actor: GoalActor,
): Promise<GoalProgramBundle> {
  const scope = { organizationId: actor.organizationId, propertyId: request.propertyId }
  await authorize(deps, scope, actor)
  const { subject, metric } = request
  const isCount = isPortalGoalMeasure(metric)
  if (subject.kind === 'property' ? isCount : !isCount) {
    throw new GoalProgramError('invalid_subject')
  }
  const [name, [targetSource = 'own']] = await Promise.all([
    goalNameOf(deps, scope, request),
    subject.kind === 'property'
      ? [] // The average has no recommended number.
      : sourcesOf(deps, scope, request, [{ ...request, subject }]),
  ])
  return deps.programs.create(
    {
      propertyId: request.propertyId,
      name,
      description: null,
      metric,
      targetValue: request.targetValue,
      subjects: [
        subject.kind === 'property'
          ? { kind: 'property', propertyId: request.propertyId }
          : subject,
      ],
      startMonth: request.startMonth,
      targetSource,
    },
    actor,
  )
}

/**
 * A goal for each Portal of the request, in its month and measure, in saves of
 * at most 50 rows. Each row is saved or not on its own; the answer says which,
 * in the order sent. A save refused as a whole (its month has turned, the
 * Organization is closing) throws.
 */
export async function addPortalGoals(
  deps: PortalGoalAddDeps,
  request: AddPortalGoalsRequest,
  actor: GoalActor,
): Promise<AddPortalGoalsResult> {
  const scope = { organizationId: actor.organizationId, propertyId: request.propertyId }
  await authorize(deps, scope, actor)
  const rows = request.items.map((item) => ({
    ...item,
    subject: { kind: 'portal', portalId: item.portalId } as const,
  }))
  const sources = await sourcesOf(deps, scope, request, rows)
  const items = rows.map(({ subject, targetValue }, index) => ({
    subject,
    targetValue,
    targetSource: sources[index] ?? 'own',
  }))
  const outcomes: AddPortalGoalsResult['outcomes'][number][] = []
  for (let start = 0; start < items.length; start += MAX_GOAL_BULK_ITEMS) {
    const saved = await deps.createForSubjects(
      {
        propertyId: request.propertyId,
        metric: request.metric,
        startMonth: request.startMonth,
        items: items.slice(start, start + MAX_GOAL_BULK_ITEMS),
      },
      actor,
    )
    for (const outcome of saved.outcomes) {
      if (outcome.subject.kind !== 'portal') continue
      outcomes.push({
        portalId: outcome.subject.portalId,
        saved: outcome.code === 'created',
      })
    }
  }
  return { outcomes }
}

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type PortalGoalAddRequestApi = Readonly<{
  portalGoalAdd: Readonly<{
    options: (
      policy: GoalExecutionPolicy,
      input: Readonly<{ propertyId: string }>,
      actor: GoalActor,
    ) => Promise<PortalGoalAddOptions>
    one: (
      policy: GoalExecutionPolicy,
      input: AddPortalGoalRequest,
      actor: GoalActor,
    ) => Promise<GoalProgramBundle>
    each: (
      policy: GoalExecutionPolicy,
      input: AddPortalGoalsRequest,
      actor: GoalActor,
    ) => Promise<AddPortalGoalsResult>
  }>
}>
