import { match } from 'ts-pattern'
import type {
  GoalMetric,
  GoalMetricEvaluation,
  GoalSubject,
} from '../domain/goal-program'
import type { GoalProgramBundle } from './ports/goal-program.repository'

export type GoalResultsMatrixAvailability =
  'ready' | 'updating' | 'insufficient_data' | 'temporarily_unavailable'

export type GoalResultsMatrixEvidence =
  | Readonly<{
      kind: 'count'
      value: number | null
      sampleCount: number
    }>
  | Readonly<{
      kind: 'average'
      value: number | null
      sampleCount: number
      minimumSample: number
    }>

export type GoalResultsMatrixRow = Readonly<{
  resultId: string
  programId: string
  assignmentId: string
  scope: GoalSubject['kind']
  subject: GoalSubject
  subjectName: string
  ungroupedPortal: boolean
  metric: GoalMetric
  availability: GoalResultsMatrixAvailability
  outcome: 'met' | 'not_met' | 'pending'
  evidence: GoalResultsMatrixEvidence
  explanation: string
  dataThrough: Date | null
  resultStatus: 'open' | 'reconciling' | 'closed'
  correction: Readonly<{ revision: number; correctedAt: Date }> | null
  targetProvenance: Readonly<{
    programName: string
    programVersion: number
    metricDefinitionVersionId: string
    targetValue: number
    effectiveFrom: Date
  }>
}>

export type GoalResultsMatrix = Readonly<{
  months: readonly Readonly<{
    periodStart: Date
    periodEnd: Date
    propertyTimezone: string
    rows: readonly GoalResultsMatrixRow[]
  }>[]
  unassignedPortals: readonly Readonly<{
    portalId: string
    portalName: string
    groupName: string | null
    message: 'No Goal Programs assigned'
  }>[]
}>

type GoalResultsMatrixInput = Readonly<{
  programs: readonly GoalProgramBundle[]
  property: Readonly<{ id: string; name: string }>
  portalGroups: readonly Readonly<{
    id: string
    name: string
    portalIds: readonly string[]
  }>[]
  portals: readonly Readonly<{
    id: string
    name: string
    publicationState?: 'draft' | 'published' | 'disabled' | 'archived'
  }>[]
}>

const scopeOrder: Readonly<Record<GoalSubject['kind'], number>> = {
  property: 0,
  portal_group: 1,
  portal: 2,
}

function availabilityFor(
  state: GoalMetricEvaluation['state'],
): GoalResultsMatrixAvailability {
  return match(state)
    .with('eligible', () => 'ready' as const)
    .with('updating', () => 'updating' as const)
    .with('insufficient_data', () => 'insufficient_data' as const)
    .with('unavailable', 'quarantined', () => 'temporarily_unavailable' as const)
    .exhaustive()
}

function evidenceFor(
  metric: GoalMetric,
  evaluation: GoalMetricEvaluation,
  minimumSample: number,
): GoalResultsMatrixEvidence {
  if (metric === 'portal_rating_average') {
    return {
      kind: 'average',
      value: evaluation.value,
      sampleCount: evaluation.sampleCount,
      minimumSample,
    }
  }
  return {
    kind: 'count',
    value: evaluation.value,
    sampleCount: evaluation.sampleCount,
  }
}

function countNoun(metric: GoalMetric): string {
  return metric === 'qualified_scans'
    ? 'verified qualified scans'
    : 'eligible private ratings'
}

function resultExplanation(
  metric: GoalMetric,
  target: number,
  minimumSample: number,
  evaluation: GoalMetricEvaluation,
): string {
  if (evaluation.state === 'updating') {
    return evaluation.value === null
      ? 'Updating: evidence is still being verified; no outcome yet.'
      : `Updating: ${evaluation.value} is the last verified value; no outcome yet.`
  }
  if (evaluation.state === 'insufficient_data') {
    return `Insufficient data: ${evaluation.sampleCount} of ${minimumSample} required eligible ratings are ready.`
  }
  if (evaluation.state !== 'eligible' || evaluation.value === null) {
    return 'Unavailable: this result cannot be decided from current evidence.'
  }
  const prefix = evaluation.achieved ? 'Met' : 'Not met'
  if (metric === 'portal_rating_average') {
    return `${prefix}: ${evaluation.value.toFixed(1)} average from ${evaluation.sampleCount} eligible ratings; target is at least ${target.toFixed(1)}.`
  }
  return `${prefix}: ${evaluation.value} ${countNoun(metric)}; target is at least ${target}.`
}

function subjectName(subject: GoalSubject, input: GoalResultsMatrixInput): string {
  if (subject.kind === 'property') return input.property.name
  if (subject.kind === 'portal_group') {
    return (
      input.portalGroups.find((group) => group.id === subject.portalGroupId)?.name ??
      'Portal group'
    )
  }
  return input.portals.find((portal) => portal.id === subject.portalId)?.name ?? 'Portal'
}

/**
 * Builds one explainable monthly manager projection from canonical Program
 * pins. It deliberately exposes no comparative score or ordinal position.
 */
export function buildGoalResultsMatrix(input: GoalResultsMatrixInput): GoalResultsMatrix {
  const groupedPortalIds = new Set(
    input.portalGroups.flatMap((group) => [...group.portalIds]),
  )
  const months = new Map<
    string,
    {
      periodStart: Date
      periodEnd: Date
      propertyTimezone: string
      rows: GoalResultsMatrixRow[]
    }
  >()

  for (const bundle of input.programs) {
    for (const result of bundle.results) {
      const assignment = bundle.assignments.find(
        (candidate) => candidate.id === result.assignmentId,
      )
      const version = bundle.versions.find(
        (candidate) => candidate.id === result.programVersionId,
      )
      if (!assignment || !version) continue
      const key = `${result.periodStart.toISOString()}:${result.periodEnd.toISOString()}`
      const month = months.get(key) ?? {
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        propertyTimezone: result.propertyTimezone,
        rows: [],
      }
      month.rows.push({
        resultId: result.id,
        programId: bundle.program.id,
        assignmentId: assignment.id,
        scope: assignment.subject.kind,
        subject: assignment.subject,
        subjectName: subjectName(assignment.subject, input),
        ungroupedPortal:
          assignment.subject.kind === 'portal' &&
          !groupedPortalIds.has(assignment.subject.portalId),
        metric: version.metric,
        availability: availabilityFor(result.evaluation.state),
        outcome:
          result.evaluation.state !== 'eligible' || result.evaluation.achieved === null
            ? 'pending'
            : result.evaluation.achieved
              ? 'met'
              : 'not_met',
        evidence: evidenceFor(
          version.metric,
          result.evaluation,
          version.metricMinimumSample,
        ),
        explanation: resultExplanation(
          version.metric,
          version.targetValue,
          version.metricMinimumSample,
          result.evaluation,
        ),
        dataThrough: result.sourceCompleteThrough,
        resultStatus: result.status,
        correction: result.revision
          ? {
              revision: result.revision.number,
              correctedAt: result.revision.createdAt,
            }
          : null,
        targetProvenance: {
          programName: bundle.program.name,
          programVersion: version.version,
          metricDefinitionVersionId: version.metricDefinitionVersionId,
          targetValue: version.targetValue,
          effectiveFrom: version.effectiveFrom,
        },
      })
      months.set(key, month)
    }
  }

  // Property and Group rows stay aggregate subjects; counting their members as
  // hidden Portal assignments would contradict the explicit-scope contract.
  const assignedPortalIds = new Set(
    input.programs.flatMap((bundle) =>
      bundle.program.status === 'ended'
        ? []
        : bundle.assignments.flatMap((assignment) =>
            assignment.programVersionId === bundle.version.id &&
            assignment.subject.kind === 'portal'
              ? [assignment.subject.portalId]
              : [],
          ),
    ),
  )
  const groupByPortalId = new Map(
    input.portalGroups.flatMap((group) =>
      group.portalIds.map((portalId) => [portalId, group.name] as const),
    ),
  )

  return {
    months: [...months.values()]
      .sort((left, right) => right.periodStart.getTime() - left.periodStart.getTime())
      .map((month) => ({
        ...month,
        rows: month.rows.sort(
          (left, right) =>
            scopeOrder[left.scope] - scopeOrder[right.scope] ||
            left.subjectName.localeCompare(right.subjectName) ||
            left.targetProvenance.programName.localeCompare(
              right.targetProvenance.programName,
            ),
        ),
      })),
    unassignedPortals: input.portals
      .filter(
        (portal) =>
          portal.publicationState !== 'archived' && !assignedPortalIds.has(portal.id),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((portal) => ({
        portalId: portal.id,
        portalName: portal.name,
        groupName: groupByPortalId.get(portal.id) ?? null,
        message: 'No Goal Programs assigned' as const,
      })),
  }
}
