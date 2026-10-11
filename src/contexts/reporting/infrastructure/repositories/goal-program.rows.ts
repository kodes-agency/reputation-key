// Goal Program persistence — the row shapes both repository modules share.
//
// A leaf: it imports no sibling repository module, so goal-program.repository.ts
// and goal-monthly-result.repository.ts can each depend on it without a cycle.
// It maps database rows to the port's types, builds insert values from them,
// and holds the Postgres error helper and the revision-conflict signal.
import type {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  goalResultRevisions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import type {
  GoalMonthlyResult,
  GoalResultRevision,
  GoalProgram,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import { parseGoalSubject } from '../../domain/goal-program'

export class GoalProgramRevisionConflict extends Error {}

export function hasPostgresErrorCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>()
  let candidate = error
  while (typeof candidate === 'object' && candidate !== null && !seen.has(candidate)) {
    seen.add(candidate)
    if ((candidate as { code?: unknown }).code === code) return true
    candidate = (candidate as { cause?: unknown }).cause
  }
  return false
}

export function mapProgram(row: typeof goalPrograms.$inferSelect): GoalProgram {
  return {
    ...row,
    status: row.status as GoalProgram['status'],
  }
}

export function mapVersion(
  row: typeof goalProgramVersions.$inferSelect,
): GoalProgramVersion {
  return {
    id: row.id,
    programId: row.programId,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    version: row.version,
    metricDefinitionId: row.metricDefinitionId,
    metricDefinitionVersionId: row.metricDefinitionVersionId,
    metric: row.metricKey as GoalProgramVersion['metric'],
    metricMinimumSample: row.metricMinimumSample,
    targetValue: row.targetValue,
    propertyTimezone: row.propertyTimezone,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    changeReason: row.changeReason,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

export function mapAssignment(
  row: typeof goalSubjectAssignments.$inferSelect,
): GoalSubjectAssignment {
  const subjectId = row.propertySubjectId ?? row.portalGroupId ?? row.portalId ?? ''
  const subject = parseGoalSubject(row.subjectKind, subjectId, row.propertyId)
  if (!subject) throw new Error(`Invalid Goal assignment subject ${row.id}`)
  return {
    id: row.id,
    programId: row.programId,
    programVersionId: row.programVersionId,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    metric: row.metricKey as GoalSubjectAssignment['metric'],
    subject,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

export function mapResult(
  row: typeof goalMonthlyResults.$inferSelect,
  correction?: typeof goalResultRevisions.$inferSelect,
): GoalMonthlyResult {
  const evaluation = correction
    ? {
        state: correction.evaluationState as GoalMonthlyResult['evaluation']['state'],
        value: correction.value,
        sampleCount: correction.sampleCount,
        achieved: correction.achieved,
        reason: correction.reason,
      }
    : {
        state: row.evaluationState as GoalMonthlyResult['evaluation']['state'],
        value: row.value,
        sampleCount: row.sampleCount,
        achieved: row.achieved,
        reason: row.reason,
      }
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    programId: row.programId,
    programVersionId: row.programVersionId,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    propertyTimezone: row.propertyTimezone,
    status: row.status as GoalMonthlyResult['status'],
    targetValue: row.targetValue,
    evaluation,
    sourceCompleteThrough: correction
      ? correction.sourceCompleteThrough
      : row.sourceCompleteThrough,
    evaluationWatermark: correction
      ? correction.evaluationWatermark
      : row.evaluationWatermark,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: correction?.createdAt ?? row.updatedAt,
    ...(correction
      ? {
          revision: {
            id: correction.id,
            number: correction.revision,
            changeReason: correction.changeReason,
            createdAt: correction.createdAt,
          },
        }
      : {}),
  }
}

export function mapResultRevision(
  row: typeof goalResultRevisions.$inferSelect,
): GoalResultRevision {
  return {
    id: row.id,
    monthlyResultId: row.monthlyResultId,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    revision: row.revision,
    supersedesRevisionId: row.supersedesRevisionId,
    evaluation: {
      state: row.evaluationState as GoalResultRevision['evaluation']['state'],
      value: row.value,
      sampleCount: row.sampleCount,
      achieved: row.achieved,
      reason: row.reason,
    },
    sourceCompleteThrough: row.sourceCompleteThrough,
    evaluationWatermark: row.evaluationWatermark,
    changeReason: row.changeReason,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

export const programValues = (program: GoalProgram) => ({ ...program })

export const versionValues = (version: GoalProgramVersion) => ({
  id: version.id,
  programId: version.programId,
  organizationId: version.organizationId,
  propertyId: version.propertyId,
  version: version.version,
  metricDefinitionId: version.metricDefinitionId,
  metricDefinitionVersionId: version.metricDefinitionVersionId,
  metricKey: version.metric,
  metricMinimumSample: version.metricMinimumSample,
  targetValue: version.targetValue,
  propertyTimezone: version.propertyTimezone,
  effectiveFrom: version.effectiveFrom,
  effectiveTo: version.effectiveTo,
  changeReason: version.changeReason,
  createdBy: version.createdBy,
  createdAt: version.createdAt,
})

export const assignmentValues = (assignment: GoalSubjectAssignment) => ({
  id: assignment.id,
  programId: assignment.programId,
  programVersionId: assignment.programVersionId,
  organizationId: assignment.organizationId,
  propertyId: assignment.propertyId,
  metricKey: assignment.metric,
  subjectKind: assignment.subject.kind,
  propertySubjectId:
    assignment.subject.kind === 'property' ? assignment.subject.propertyId : null,
  portalGroupId:
    assignment.subject.kind === 'portal_group' ? assignment.subject.portalGroupId : null,
  portalId: assignment.subject.kind === 'portal' ? assignment.subject.portalId : null,
  effectiveFrom: assignment.effectiveFrom,
  effectiveTo: assignment.effectiveTo,
  createdBy: assignment.createdBy,
  createdAt: assignment.createdAt,
})

export const resultValues = (result: GoalMonthlyResult) => ({
  id: result.id,
  assignmentId: result.assignmentId,
  programId: result.programId,
  programVersionId: result.programVersionId,
  organizationId: result.organizationId,
  propertyId: result.propertyId,
  periodStart: result.periodStart,
  periodEnd: result.periodEnd,
  propertyTimezone: result.propertyTimezone,
  status: result.status,
  // A month always opens on its version's target. The column is only ever
  // set by an UPDATE of a month that is still running.
  targetValue: null,
  evaluationState: result.evaluation.state,
  value: result.evaluation.value,
  sampleCount: result.evaluation.sampleCount,
  achieved: result.evaluation.achieved,
  reason: result.evaluation.reason,
  sourceCompleteThrough: result.sourceCompleteThrough,
  evaluationWatermark: result.evaluationWatermark,
  closedAt: result.closedAt,
  createdAt: result.createdAt,
  updatedAt: result.updatedAt,
})
