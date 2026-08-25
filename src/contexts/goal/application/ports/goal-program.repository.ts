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
  evaluation: GoalMetricEvaluation
  sourceCompleteThrough: Date | null
  evaluationWatermark: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

export type GoalProgramBundle = Readonly<{
  program: GoalProgram
  version: GoalProgramVersion
  assignments: readonly GoalSubjectAssignment[]
  results: readonly GoalMonthlyResult[]
}>

export type GoalProgramRepository = Readonly<{
  create(
    input: Readonly<{
      bundle: GoalProgramBundle
      auditAction: string
      outboxEventId: string
    }>,
  ): Promise<void>
  get(
    organizationId: string,
    propertyId: string,
    programId: string,
  ): Promise<GoalProgramBundle | null>
  list(organizationId: string, propertyId: string): Promise<readonly GoalProgramBundle[]>
  changeStatus(
    input: Readonly<{
      organizationId: string
      propertyId: string
      programId: string
      expectedStatus: GoalProgramStatus
      status: GoalProgramStatus
      reason: string
      actorId: string
      at: Date
      outboxEventId: string
    }>,
  ): Promise<GoalProgram | null>
  revise(
    input: Readonly<{
      expectedVersion: GoalProgramVersion
      version: GoalProgramVersion
      assignments: readonly GoalSubjectAssignment[]
      results: readonly GoalMonthlyResult[]
      actorId: string
      at: Date
      outboxEventId: string
    }>,
  ): Promise<void>
  listDueResults(now: Date): Promise<readonly GoalMonthlyResult[]>
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
      outboxEventId: string
    }>,
  ): Promise<GoalMonthlyResult | null>
}>
