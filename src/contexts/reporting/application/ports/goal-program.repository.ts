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

/**
 * What a change to a month's target did for the months after it:
 * - `applied`: they carry the new target, through a version this change wrote
 *   or because the plan for them already had it;
 * - `replaced_scheduled_change`: a change that was waiting for its month had
 *   the same measure and was replaced by one with the new target;
 * - `kept_scheduled_change`: a change that was waiting had another measure and
 *   was left as it was;
 * - `not_applied`: asked for, and not done; `followingReason` says why;
 * - `not_requested`: only the month was to change.
 */
export type GoalMonthTargetFollowingOutcome =
  | 'applied'
  | 'replaced_scheduled_change'
  | 'kept_scheduled_change'
  | 'not_applied'
  | 'not_requested'

/** Why the months after a changed one did not take the new target. */
export type GoalMonthTargetFollowingReason = 'subject_unavailable' | 'metric_unavailable'

/**
 * One month's target, changed while the month ran: who, when, the old and the
 * new value and an optional note. A command writes one of these per month it
 * changed, all sharing `changeId`.
 */
export type GoalMonthTargetChange = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  programId: string
  monthlyResultId: string
  changeId: string
  previousTargetValue: number
  newTargetValue: number
  followingOutcome: GoalMonthTargetFollowingOutcome
  followingReason: GoalMonthTargetFollowingReason | null
  /**
   * The version this change wrote for the months after it; null when it wrote
   * none. A later change can replace that version before its month begins, and
   * the version then keeps an empty window.
   */
  followingVersionId: string | null
  note: string | null
  createdBy: string
  createdAt: Date
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
  /**
   * Every change to a month's own target, oldest first. Read with the Program
   * by `get` and `list`, the reads a page or a command works from; absent on
   * the maintenance read, which never asks how a target came about.
   */
  targetChanges?: readonly GoalMonthTargetChange[]
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

/**
 * What a Program that has not started is waiting for: its metric source, or
 * only its first month. Stored as the Program's status reason while it is
 * scheduled, and decided from the measure its plan has.
 */
export type GoalScheduledStatusReason =
  'metric_source_not_active' | 'awaiting_first_full_month'

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
  /**
   * The Programs maintenance works on: scheduled and active ones, except those
   * of an Organization the lifecycle holds (see `isOrganizationHeld`).
   */
  listOperational(): Promise<readonly GoalProgramBundle[]>
  /**
   * True while the Organization's lifecycle holds it: a closure requested or in
   * progress, or a cancelled closure that still awaits its explicit
   * reactivation. Goal then starts nothing in it: no Program is created,
   * started or resumed, and maintenance activates none.
   */
  isOrganizationHeld(organizationId: string): Promise<boolean>
  /**
   * Null when the Program is no longer in `expectedStatus`, or when ending it
   * finds its version history changed under it. Nothing is written then.
   * `reason` is the manager's note; without one no status reason is stored.
   *
   * Ending closes the open version and its assignments. A Program that never
   * started (still scheduled, with no month) keeps the empty window
   * [from, from) whenever it is ended, so its subjects are free at once. A
   * Program that has started closes at the latest of the command time and the
   * end of a month still open or reconciling, which stays inside its window.
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
   *
   * `scheduledStatusReason` is what the new plan waits for. A Program still
   * scheduled takes it as its status reason in the same update that moves the
   * head; a Program in any other status keeps the reason it has. Omitted
   * leaves the reason alone.
   */
  revise(
    input: Readonly<{
      expectedVersion: GoalProgramVersion
      version: GoalProgramVersion
      assignments: readonly GoalSubjectAssignment[]
      supersedeRowlessHead: boolean
      scheduledStatusReason?: GoalScheduledStatusReason
      actorId: string
      at: Date
    }>,
  ): Promise<boolean>
  /**
   * Set a Program's name and description in place; no version is written.
   * `previousName` and `previousDescription` are what the command read. The
   * update applies only while the Program still says both, so a rename never
   * undoes another one it did not see, and the audit row names exactly what
   * was replaced. Null when the Program does not exist for the tenant, has
   * ended, or no longer has that name and description.
   */
  rename(
    input: Readonly<{
      organizationId: string
      propertyId: string
      programId: string
      name: string
      description: string | null
      previousName: string
      previousDescription: string | null
      actorId: string
      at: Date
    }>,
  ): Promise<GoalProgram | null>
  /**
   * Give the months of a Program that are running at `at` their own target, in
   * one transaction with the log of the change and, when `following.revision`
   * is given, the version that carries the target into the months after.
   *
   * `months` are the running months the command read, each with the target it
   * had stored then. The write applies only while the Program is not ended,
   * `expectedVersion` is still its head, and exactly those months are open and
   * running at `at` with those targets. Otherwise nothing is written:
   * - `revision_conflict`: the head moved, the Program ended, another month
   *   opened, a month's target changed, or the version could not be written;
   * - `month_locked`: a month is no longer open, or the database refused its
   *   new target because the period has ended on its clock.
   */
  changeMonthTarget(
    input: Readonly<{
      organizationId: string
      propertyId: string
      programId: string
      expectedVersion: GoalProgramVersion
      /** Shared by every log row of this command. */
      changeId: string
      months: readonly Readonly<{
        monthlyResultId: string
        /** The id of the log row for this month. */
        changeRowId: string
        /** What the month had stored when it was read: null for its version's target. */
        storedTargetValue: number | null
        /** The target the month was judged against until now. */
        previousTargetValue: number
      }>[]
      /** The target the months are judged against from now on. */
      targetValue: number
      /** What the months store for it: null when it is their version's own target. */
      storedTargetValue: number | null
      following: Readonly<{
        outcome: GoalMonthTargetFollowingOutcome
        reason: GoalMonthTargetFollowingReason | null
        /** The version to write for the months after, with what becomes of the head. */
        revision: Readonly<{
          version: GoalProgramVersion
          assignments: readonly GoalSubjectAssignment[]
          supersedeRowlessHead: boolean
        }> | null
      }>
      note: string | null
      actorId: string
      at: Date
    }>,
  ): Promise<'changed' | 'revision_conflict' | 'month_locked'>
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
