import { match } from 'ts-pattern'
import type {
  GoalMetric,
  GoalMetricEvaluation,
  GoalSubject,
} from '../domain/goal-program'
import type { GoalProgramBundle } from './ports/goal-program.repository'
import { effectiveMonthTarget } from './goal-effective-month-target'
import { monthTargetMarker, type GoalMonthTargetMarker } from './goal-month-target-marker'
import { goalTargetProvenance } from './goal-target-provenance'

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
    /** The target the month is judged against: its own when it has one, else its version's. */
    targetValue: number
    effectiveFrom: Date
    /** When the version's target was set; a later change of subjects alone does not move it. */
    setAt: Date
  }>
  /**
   * Who changed this month's target last, when, what it started at and how
   * many times it changed. Null for a month on the target it started with.
   */
  monthTarget: GoalMonthTargetMarker | null
}>

export type GoalResultsMatrix = Readonly<{
  months: readonly Readonly<{
    periodStart: Date
    periodEnd: Date
    propertyTimezone: string
    rows: readonly GoalResultsMatrixRow[]
  }>[]
}>

type GoalResultsMatrixInput = Readonly<{
  programs: readonly GoalProgramBundle[]
  property: Readonly<{ id: string; name: string }>
  portalGroups: readonly Readonly<{ id: string; name: string }>[]
  portals: readonly Readonly<{ id: string; name: string }>[]
}>

// Pinned, not the runtime's: the Goals page builds the matrix on the server and
// again in the browser, and both must order the rows alike ("Bar 2" before
// "Bar 10", "Spa" before "Рецепция" in every language).
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

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

// A count grouped as the live line groups it ("1,234"), with the locale pinned
// so the server and the browser word a month alike. `formatNumber` is UI-side
// (`#/lib/format`), out of this layer's reach; this is its en-US shape.
const wholeNumber = new Intl.NumberFormat('en-US')

/** "1 scan", "64 private ratings", "1,234 scans": one is singular. */
function countWords(metric: GoalMetric, value: number): string {
  const one = value === 1
  const noun =
    metric === 'qualified_scans'
      ? one
        ? 'scan'
        : 'scans'
      : one
        ? 'private rating'
        : 'private ratings'
  return `${wholeNumber.format(value)} ${noun}`
}

/**
 * A month's result in plain words: "Met: 64 private ratings, the goal was 60.",
 * "Updating: the final figure is on its way.", "More ratings needed: 6 of 10."
 */
function resultExplanation(
  metric: GoalMetric,
  target: number,
  minimumSample: number,
  evaluation: GoalMetricEvaluation,
): string {
  if (evaluation.state === 'updating') return 'Updating: the final figure is on its way.'
  if (evaluation.state === 'insufficient_data') {
    return `More ratings needed: ${evaluation.sampleCount} of ${minimumSample}.`
  }
  if (evaluation.state !== 'eligible' || evaluation.value === null) {
    return 'Unavailable: this result cannot be decided from current evidence.'
  }
  const prefix = evaluation.achieved ? 'Met' : 'Not met'
  if (metric === 'portal_rating_average') {
    return `${prefix}: ${evaluation.value.toFixed(1)} from ${evaluation.sampleCount} ratings, the goal was ${target.toFixed(1)}.`
  }
  return `${prefix}: ${countWords(metric, evaluation.value)}, the goal was ${wholeNumber.format(target)}.`
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
      const targetValue = effectiveMonthTarget(result, version)
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
          targetValue,
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
          targetValue,
          effectiveFrom: version.effectiveFrom,
          setAt: goalTargetProvenance(bundle, version).setAt,
        },
        monthTarget: monthTargetMarker(bundle, result, version),
      })
      months.set(key, month)
    }
  }

  return {
    months: [...months.values()]
      .sort((left, right) => right.periodStart.getTime() - left.periodStart.getTime())
      .map((month) => ({
        ...month,
        rows: month.rows.sort(
          (left, right) =>
            scopeOrder[left.scope] - scopeOrder[right.scope] ||
            byName.compare(left.subjectName, right.subjectName) ||
            byName.compare(
              left.targetProvenance.programName,
              right.targetProvenance.programName,
            ),
        ),
      })),
  }
}
