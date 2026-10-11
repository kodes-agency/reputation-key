import type {
  GoalMetric,
  GoalMetricEvaluation,
  GoalMonthlyResultStatus,
  GoalProgramStatus,
  GoalSubject,
} from '../../domain/goal-program'

export type GoalProgram = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  name: string
  description: string | null
  status: GoalProgramStatus
  statusReason: string | null
  currentVersion: number
  createdBy: string
  createdAt: Date
  updatedAt: Date
}>

export type GoalProgramVersion = Readonly<{
  id: string
  programId: string
  organizationId: string
  propertyId: string
  version: number
  metricDefinitionId: string
  metricDefinitionVersionId: string
  metric: GoalMetric
  metricMinimumSample: number
  targetValue: number
  propertyTimezone: string
  effectiveFrom: Date
  effectiveTo: Date | null
  changeReason: string
  createdBy: string
  createdAt: Date
}>

export type GoalSubjectAssignment = Readonly<{
  id: string
  programId: string
  programVersionId: string
  organizationId: string
  propertyId: string
  metric: GoalMetric
  subject: GoalSubject
  effectiveFrom: Date
  effectiveTo: Date | null
  createdBy: string
  createdAt: Date
}>

export type GoalMonthlyResult = Readonly<{
  id: string
  assignmentId: string
  programId: string
  programVersionId: string
  organizationId: string
  propertyId: string
  periodStart: Date
  periodEnd: Date
  propertyTimezone: string
  status: GoalMonthlyResultStatus
  /**
   * This month's own target. Null means the month uses its version's target.
   * Opening a month never sets it, and it is locked once the period ends.
   */
  targetValue: number | null
  evaluation: GoalMetricEvaluation
  sourceCompleteThrough: Date | null
  evaluationWatermark: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** Present only when the immutable closed base is overlaid by a revision. */
  revision?: Readonly<{
    id: string
    number: number
    changeReason: string
    createdAt: Date
  }>
}>

export type GoalResultRevision = Readonly<{
  id: string
  monthlyResultId: string
  organizationId: string
  propertyId: string
  revision: number
  supersedesRevisionId: string | null
  evaluation: GoalMetricEvaluation
  sourceCompleteThrough: Date | null
  evaluationWatermark: Date
  changeReason: string
  createdBy: string
  createdAt: Date
}>

export type ClosedGoalResultHead = Readonly<{
  result: GoalMonthlyResult
  revision: GoalResultRevision | null
}>

export type AppendGoalResultRevisionResult =
  | Readonly<{
      status: 'revised'
      result: GoalMonthlyResult
      revision: GoalResultRevision
      outcomeChanged: boolean
      availabilityChanged: boolean
    }>
  | Readonly<{ status: 'unchanged'; result: GoalMonthlyResult }>
  | Readonly<{ status: 'conflict' }>

export type FindClosedGoalResultIdsForMetricImpactInput = Readonly<{
  organizationId: string
  propertyId: string
  definitionVersionId: string
  portalId: string | null
  portalGroupId: string | null
  eventAt: Date
}>

export type GoalProgramBundle = Readonly<{
  program: GoalProgram
  /** Current definition head; historical versions stay addressable by result pins. */
  version: GoalProgramVersion
  /** Immutable definition-version history used to interpret pinned results. */
  versions: readonly GoalProgramVersion[]
  /** Effective-dated assignment history across every version of the Program. */
  assignments: readonly GoalSubjectAssignment[]
  /** Append-only monthly result history across every version of the Program. */
  results: readonly GoalMonthlyResult[]
}>

/**
 * An assignment of another Program that holds a subject for a metric from the
 * instant asked about: open-ended, or ending after that instant. A window that
 * ends where it starts holds nothing and is never reported.
 */
export type GoalAssignmentConflict = Readonly<{
  subject: GoalSubject
  programId: string
  /** Null while the holding goal is live; otherwise the instant the subject is free. */
  effectiveTo: Date | null
}>

export type GoalProgramRepository = Readonly<{
  /**
   * `subject_has_goal` when a subject already holds the metric inside the new
   * Program's window: the database's no-overlap constraint, for a conflict that
   * appeared after the caller's own check. Nothing is written then.
   */
  create(
    input: Readonly<{
      bundle: GoalProgramBundle
      auditAction: string
    }>,
  ): Promise<'created' | 'subject_has_goal'>
  get(
    organizationId: string,
    propertyId: string,
    programId: string,
  ): Promise<GoalProgramBundle | null>
  list(organizationId: string, propertyId: string): Promise<readonly GoalProgramBundle[]>
  listOperational(): Promise<readonly GoalProgramBundle[]>
  /**
   * Null when the Program is no longer in `expectedStatus`, or when ending it
   * finds its version history changed under it. Nothing is written then.
   * `reason` is the manager's note; without one no status reason is stored.
   */
  changeStatus(
    input: Readonly<{
      organizationId: string
      propertyId: string
      programId: string
      expectedStatus: GoalProgramStatus
      status: GoalProgramStatus
      reason: string | null
      actorId: string
      at: Date
    }>,
  ): Promise<GoalProgram | null>
  /**
   * Write `version` as the Program's new head.
   *
   * `supersedeRowlessHead` says what becomes of the expected version. False:
   * it is in force, and it and its assignments close where the new version
   * starts. True: no month has opened under it (a goal that has not started,
   * or a change still waiting for its month), so it is replaced, and it and
   * its assignments keep the empty window [from, from), which holds no subject.
   *
   * False when the head moved; when an open or reconciling month of the
   * expected version ends after the new version starts; or, when replacing,
   * when any month exists under the expected version. Each means a month
   * opened since the caller read the Program: re-read and recompute to retry.
   */
  revise(
    input: Readonly<{
      expectedVersion: GoalProgramVersion
      version: GoalProgramVersion
      assignments: readonly GoalSubjectAssignment[]
      supersedeRowlessHead: boolean
      actorId: string
      at: Date
    }>,
  ): Promise<boolean>
  /**
   * The requested subjects another Program holds for the metric from
   * `effectiveFrom`, one entry per subject (the hold that lasts longest).
   * `excludeProgramId` leaves a Program's own assignments out.
   */
  findAssignmentConflicts(
    input: Readonly<{
      organizationId: string
      propertyId: string
      excludeProgramId?: string
      metric: GoalMetric
      effectiveFrom: Date
      subjects: readonly GoalSubject[]
    }>,
  ): Promise<readonly GoalAssignmentConflict[]>
  activate(
    input: Readonly<{
      bundle: GoalProgramBundle
      results: readonly GoalMonthlyResult[]
      at: Date
    }>,
  ): Promise<GoalProgram | null>
  appendResults(
    input: Readonly<{
      program: GoalProgram
      version: GoalProgramVersion
      results: readonly GoalMonthlyResult[]
      at: Date
    }>,
  ): Promise<number>
  listDueResults(now: Date): Promise<readonly GoalMonthlyResult[]>
  getDueResult(
    organizationId: string,
    propertyId: string,
    resultId: string,
    now: Date,
  ): Promise<GoalMonthlyResult | null>
  getAssignment(
    organizationId: string,
    propertyId: string,
    assignmentId: string,
  ): Promise<GoalSubjectAssignment | null>
  getVersion(
    organizationId: string,
    propertyId: string,
    programVersionId: string,
  ): Promise<GoalProgramVersion | null>
  updateResult(
    input: Readonly<{
      result: GoalMonthlyResult
      expectedStatus: GoalMonthlyResultStatus
    }>,
  ): Promise<GoalMonthlyResult | null>
  getClosedResult(
    organizationId: string,
    propertyId: string,
    resultId: string,
  ): Promise<ClosedGoalResultHead | null>
  appendResultRevision(
    input: Readonly<{
      head: ClosedGoalResultHead
      revisionId: string
      evaluation: GoalMetricEvaluation
      sourceCompleteThrough: Date | null
      evaluationWatermark: Date
      changeReason: string
      createdBy: string
      at: Date
    }>,
  ): Promise<AppendGoalResultRevisionResult>
  /**
   * Locates immutable closed results whose exact version, subject, and
   * half-open period contain one Metric-owned correction impact.
   */
  findClosedResultIdsForMetricImpact(
    input: FindClosedGoalResultIdsForMetricImpactInput,
  ): Promise<readonly string[]>
}>
