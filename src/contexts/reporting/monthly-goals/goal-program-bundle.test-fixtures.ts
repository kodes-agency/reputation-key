// Pure builders of a Goal Program aggregate for the repository suites.
//
// They only build values: the caller writes them through the repository, in
// whatever transaction its suite uses.
import { newTestId } from '#/shared/testing/ambient-test-runtime'
import { METRIC_DEFINITION_IDS, METRIC_VERSION_IDS } from '../readings/contracts'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../application/ports/goal-program.repository'
import type { GoalSubject } from '../domain/goal-program'

export type GoalMonth = Readonly<{ start: Date; end: Date }>

const GOALS = {
  ratings: {
    name: 'Goal',
    metric: 'portal_rating_count',
    metricDefinitionId: METRIC_DEFINITION_IDS.portalRatingCount,
    metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
    targetValue: 25,
  },
  scans: {
    name: 'Scans',
    metric: 'qualified_scans',
    metricDefinitionId: METRIC_DEFINITION_IDS.qualifiedScan,
    metricDefinitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
    targetValue: 400,
  },
} as const

export type GoalKind = keyof typeof GOALS

type VersionInput = Readonly<{
  organizationId: string
  propertyId: string
  programId: string
  effectiveFrom: Date
  at: Date
  goal?: GoalKind
  timezone?: string
}>

export function goalVersion(input: VersionInput): GoalProgramVersion {
  const goal = GOALS[input.goal ?? 'ratings']
  return {
    id: newTestId(),
    programId: input.programId,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    version: 1,
    metricDefinitionId: goal.metricDefinitionId,
    metricDefinitionVersionId: goal.metricDefinitionVersionId,
    metric: goal.metric,
    metricMinimumSample: 0,
    targetValue: goal.targetValue,
    propertyTimezone: input.timezone ?? 'UTC',
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'manager-1',
    createdAt: input.at,
  }
}

/** The subject defaults to the version's own Property. */
export function goalAssignment(
  version: Pick<
    GoalProgramVersion,
    | 'id'
    | 'programId'
    | 'organizationId'
    | 'propertyId'
    | 'metric'
    | 'effectiveFrom'
    | 'createdAt'
  >,
  options: Readonly<{ subject?: GoalSubject; at?: Date }> = {},
): GoalSubjectAssignment {
  return {
    id: newTestId(),
    programId: version.programId,
    programVersionId: version.id,
    organizationId: version.organizationId,
    propertyId: version.propertyId,
    metric: version.metric,
    subject: options.subject ?? { kind: 'property', propertyId: version.propertyId },
    effectiveFrom: version.effectiveFrom,
    effectiveTo: null,
    createdBy: 'manager-1',
    createdAt: options.at ?? version.createdAt,
  }
}

export function openMonth(
  assignment: GoalSubjectAssignment,
  start: Date,
  end: Date,
  at: Date,
  timezone = 'UTC',
): GoalMonthlyResult {
  return {
    id: newTestId(),
    assignmentId: assignment.id,
    programId: assignment.programId,
    programVersionId: assignment.programVersionId,
    organizationId: assignment.organizationId,
    propertyId: assignment.propertyId,
    periodStart: start,
    periodEnd: end,
    propertyTimezone: timezone,
    status: 'open',
    targetValue: null,
    evaluation: {
      state: 'updating',
      value: null,
      sampleCount: 0,
      achieved: null,
      reason: 'period_open',
    },
    sourceCompleteThrough: null,
    evaluationWatermark: null,
    closedAt: null,
    createdAt: at,
    updatedAt: at,
  }
}

type BundleInput = VersionInput &
  Readonly<{
    status: 'scheduled' | 'active'
    subjects?: readonly GoalSubject[]
    /** One open month per subject for each of these, created at the month's `at` or the start. */
    openMonths?: readonly (GoalMonth & Readonly<{ at?: Date }>)[]
  }>

/** A goal of one version, one assignment per subject and the given open months. */
export function goalBundle(input: BundleInput): GoalProgramBundle {
  const version = goalVersion(input)
  const assignments = (input.subjects ?? [undefined]).map((subject) =>
    goalAssignment(version, subject ? { subject } : {}),
  )
  const goal = GOALS[input.goal ?? 'ratings']
  return {
    program: {
      id: input.programId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      name: `${goal.name} ${input.programId}`,
      description: null,
      status: input.status,
      statusReason: input.status === 'scheduled' ? 'awaiting_first_full_month' : null,
      currentVersion: 1,
      createdBy: 'manager-1',
      createdAt: input.at,
      updatedAt: input.at,
    },
    version,
    versions: [version],
    assignments,
    results: (input.openMonths ?? []).flatMap((month) =>
      assignments.map((assignment) =>
        openMonth(
          assignment,
          month.start,
          month.end,
          month.at ?? input.at,
          input.timezone,
        ),
      ),
    ),
  }
}

/** The next version of a Program, for its Property as the one subject. */
export function followingVersion(
  previous: GoalProgramVersion,
  effectiveFrom: Date,
  targetValue: number,
  at: Date,
) {
  const version: GoalProgramVersion = {
    ...previous,
    id: newTestId(),
    version: previous.version + 1,
    targetValue,
    effectiveFrom,
    effectiveTo: null,
    changeReason: 'revised',
    createdAt: at,
  }
  return { version, assignments: [goalAssignment(version)] }
}

/** Each version's window, and each assignment's, by version number. */
export function windowsOf(bundle: GoalProgramBundle | null) {
  const numberOf = (versionId: string) =>
    bundle?.versions.find(({ id }) => id === versionId)?.version ?? 0
  return {
    versions: bundle?.versions.map((version) => [
      version.version,
      version.effectiveFrom,
      version.effectiveTo,
    ]),
    assignments: bundle?.assignments
      .map((subjectAssignment) => ({
        version: numberOf(subjectAssignment.programVersionId),
        window: subjectAssignment,
      }))
      .sort((left, right) => left.version - right.version)
      .map(({ version, window }) => [version, window.effectiveFrom, window.effectiveTo]),
  }
}

export const JANUARY: GoalMonth = {
  start: new Date('2026-01-01T00:00:00.000Z'),
  end: new Date('2026-02-01T00:00:00.000Z'),
}
export const FEBRUARY: GoalMonth = {
  start: JANUARY.end,
  end: new Date('2026-03-01T00:00:00.000Z'),
}
export const MARCH: GoalMonth = {
  start: FEBRUARY.end,
  end: new Date('2026-04-01T00:00:00.000Z'),
}
