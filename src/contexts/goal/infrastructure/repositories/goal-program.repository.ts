import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type {
  GoalMonthlyResult,
  GoalProgram,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import { parseGoalSubject } from '../../domain/goal-program'

function mapProgram(row: typeof goalPrograms.$inferSelect): GoalProgram {
  return {
    ...row,
    status: row.status as GoalProgram['status'],
  }
}

function mapVersion(row: typeof goalProgramVersions.$inferSelect): GoalProgramVersion {
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

function mapAssignment(
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

function mapResult(row: typeof goalMonthlyResults.$inferSelect): GoalMonthlyResult {
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
    evaluation: {
      state: row.evaluationState as GoalMonthlyResult['evaluation']['state'],
      value: row.value,
      sampleCount: row.sampleCount,
      achieved: row.achieved,
      reason: row.reason,
    },
    sourceCompleteThrough: row.sourceCompleteThrough,
    evaluationWatermark: row.evaluationWatermark,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const programValues = (program: GoalProgram) => ({ ...program })

const versionValues = (version: GoalProgramVersion) => ({
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

const assignmentValues = (assignment: GoalSubjectAssignment) => ({
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

const resultValues = (result: GoalMonthlyResult) => ({
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

async function hydrateBundles(
  db: Database,
  programs: readonly (typeof goalPrograms.$inferSelect)[],
): Promise<readonly GoalProgramBundle[]> {
  if (programs.length === 0) return []
  const programIds = programs.map((program) => program.id)
  const [versions, assignments, results] = await Promise.all([
    db
      .select()
      .from(goalProgramVersions)
      .where(inArray(goalProgramVersions.programId, programIds)),
    db
      .select()
      .from(goalSubjectAssignments)
      .where(inArray(goalSubjectAssignments.programId, programIds))
      .orderBy(asc(goalSubjectAssignments.createdAt), asc(goalSubjectAssignments.id)),
    db
      .select()
      .from(goalMonthlyResults)
      .where(inArray(goalMonthlyResults.programId, programIds))
      .orderBy(asc(goalMonthlyResults.periodStart), asc(goalMonthlyResults.id)),
  ])

  return programs.flatMap((programRow) => {
    const versionRow = versions.find(
      (version) =>
        version.programId === programRow.id &&
        version.version === programRow.currentVersion,
    )
    if (!versionRow) return []
    return [
      {
        program: mapProgram(programRow),
        version: mapVersion(versionRow),
        assignments: assignments
          .filter((assignment) => assignment.programVersionId === versionRow.id)
          .map(mapAssignment),
        results: results
          .filter((result) => result.programVersionId === versionRow.id)
          .map(mapResult),
      },
    ]
  })
}

export function createGoalProgramRepository(db: Database): GoalProgramRepository {
  return {
    async create(input) {
      const { bundle } = input
      await db.transaction(async (tx) => {
        await tx.insert(goalPrograms).values(programValues(bundle.program))
        await tx.insert(goalProgramVersions).values(versionValues(bundle.version))
        if (bundle.assignments.length > 0) {
          await tx
            .insert(goalSubjectAssignments)
            .values(bundle.assignments.map(assignmentValues))
        }
        if (bundle.results.length > 0) {
          await tx.insert(goalMonthlyResults).values(bundle.results.map(resultValues))
        }
        await tx.insert(auditLogs).values({
          organizationId: bundle.program.organizationId,
          userId: bundle.program.createdBy,
          action: input.auditAction,
          resourceType: 'goal_program',
          resourceId: bundle.program.id,
          details: {
            propertyId: bundle.program.propertyId,
            programVersionId: bundle.version.id,
            metric: bundle.version.metric,
            assignmentCount: bundle.assignments.length,
          },
        })
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: 'goal.program.created',
          eventVersion: 1,
          organizationId: bundle.program.organizationId,
          propertyId: bundle.program.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: bundle.program.id,
          payload: {
            programId: bundle.program.id,
            programVersionId: bundle.version.id,
            metric: bundle.version.metric,
            assignmentCount: bundle.assignments.length,
          },
        })
      })
    },

    async get(organizationId, propertyId, programId) {
      const rows = await db
        .select()
        .from(goalPrograms)
        .where(
          and(
            eq(goalPrograms.organizationId, organizationId),
            eq(goalPrograms.propertyId, propertyId),
            eq(goalPrograms.id, programId),
          ),
        )
        .limit(1)
      return (await hydrateBundles(db, rows))[0] ?? null
    },

    async list(organizationId, propertyId) {
      const rows = await db
        .select()
        .from(goalPrograms)
        .where(
          and(
            eq(goalPrograms.organizationId, organizationId),
            eq(goalPrograms.propertyId, propertyId),
          ),
        )
        .orderBy(asc(goalPrograms.name), asc(goalPrograms.id))
      return hydrateBundles(db, rows)
    },

    async listOperational() {
      const rows = await db
        .select()
        .from(goalPrograms)
        .where(inArray(goalPrograms.status, ['scheduled', 'active']))
        .orderBy(
          asc(goalPrograms.organizationId),
          asc(goalPrograms.propertyId),
          asc(goalPrograms.id),
        )
      return hydrateBundles(db, rows)
    },

    async changeStatus(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(goalPrograms)
          .set({
            status: input.status,
            statusReason: input.reason,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(goalPrograms.organizationId, input.organizationId),
              eq(goalPrograms.propertyId, input.propertyId),
              eq(goalPrograms.id, input.programId),
              eq(goalPrograms.status, input.expectedStatus),
            ),
          )
          .returning()
        if (!row) return null
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          userId: input.actorId,
          action: 'goal.program.status_changed',
          resourceType: 'goal_program',
          resourceId: input.programId,
          details: {
            propertyId: input.propertyId,
            previousStatus: input.expectedStatus,
            status: input.status,
            reason: input.reason,
          },
        })
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: 'goal.program.status_changed',
          eventVersion: 1,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: input.programId,
          payload: {
            programId: input.programId,
            previousStatus: input.expectedStatus,
            status: input.status,
            reason: input.reason,
          },
        })
        return mapProgram(row)
      })
    },

    async revise(input) {
      await db.transaction(async (tx) => {
        const [program] = await tx
          .update(goalPrograms)
          .set({ currentVersion: input.version.version, updatedAt: input.at })
          .where(
            and(
              eq(goalPrograms.organizationId, input.version.organizationId),
              eq(goalPrograms.propertyId, input.version.propertyId),
              eq(goalPrograms.id, input.version.programId),
              eq(goalPrograms.currentVersion, input.expectedVersion.version),
            ),
          )
          .returning({ id: goalPrograms.id })
        if (!program) throw new Error('Goal Program revision conflict')

        const [closedVersion] = await tx
          .update(goalProgramVersions)
          .set({ effectiveTo: input.version.effectiveFrom })
          .where(
            and(
              eq(goalProgramVersions.id, input.expectedVersion.id),
              eq(goalProgramVersions.organizationId, input.version.organizationId),
              eq(goalProgramVersions.propertyId, input.version.propertyId),
              isNull(goalProgramVersions.effectiveTo),
            ),
          )
          .returning({ id: goalProgramVersions.id })
        if (!closedVersion) throw new Error('Goal Program version closure conflict')
        const closedAssignments = await tx
          .update(goalSubjectAssignments)
          .set({ effectiveTo: input.version.effectiveFrom })
          .where(
            and(
              eq(goalSubjectAssignments.programVersionId, input.expectedVersion.id),
              eq(goalSubjectAssignments.organizationId, input.version.organizationId),
              eq(goalSubjectAssignments.propertyId, input.version.propertyId),
              isNull(goalSubjectAssignments.effectiveTo),
            ),
          )
          .returning({ id: goalSubjectAssignments.id })
        if (closedAssignments.length === 0) {
          throw new Error('Goal Program assignment closure conflict')
        }
        await tx.insert(goalProgramVersions).values(versionValues(input.version))
        await tx
          .insert(goalSubjectAssignments)
          .values(input.assignments.map(assignmentValues))
        await tx.insert(goalMonthlyResults).values(input.results.map(resultValues))
        await tx.insert(auditLogs).values({
          organizationId: input.version.organizationId,
          userId: input.actorId,
          action: 'goal.program.revised',
          resourceType: 'goal_program',
          resourceId: input.version.programId,
          details: {
            propertyId: input.version.propertyId,
            previousProgramVersionId: input.expectedVersion.id,
            programVersionId: input.version.id,
            metric: input.version.metric,
            assignmentCount: input.assignments.length,
          },
        })
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: 'goal.program.revised',
          eventVersion: 1,
          organizationId: input.version.organizationId,
          propertyId: input.version.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: input.version.programId,
          payload: {
            programId: input.version.programId,
            previousProgramVersionId: input.expectedVersion.id,
            programVersionId: input.version.id,
            metric: input.version.metric,
            assignmentCount: input.assignments.length,
          },
        })
      })
    },

    async activate(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(goalPrograms)
          .set({ status: 'active', statusReason: null, updatedAt: input.at })
          .where(
            and(
              eq(goalPrograms.organizationId, input.bundle.program.organizationId),
              eq(goalPrograms.propertyId, input.bundle.program.propertyId),
              eq(goalPrograms.id, input.bundle.program.id),
              eq(goalPrograms.currentVersion, input.bundle.version.version),
              eq(goalPrograms.status, 'scheduled'),
            ),
          )
          .returning()
        if (!row) return null
        if (input.results.length > 0) {
          await tx
            .insert(goalMonthlyResults)
            .values(input.results.map(resultValues))
            .onConflictDoNothing()
        }
        await tx.insert(auditLogs).values({
          organizationId: row.organizationId,
          userId: 'system',
          action: 'goal.program.activated',
          resourceType: 'goal_program',
          resourceId: row.id,
          details: {
            propertyId: row.propertyId,
            programVersionId: input.bundle.version.id,
            resultCount: input.results.length,
          },
        })
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: 'goal.program.activated',
          eventVersion: 1,
          organizationId: row.organizationId,
          propertyId: row.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: row.id,
          payload: {
            programId: row.id,
            programVersionId: input.bundle.version.id,
            resultCount: input.results.length,
          },
        })
        return mapProgram(row)
      })
    },

    async appendResults(input) {
      if (input.results.length === 0) return 0
      return db.transaction(async (tx) => {
        const [head] = await tx
          .update(goalPrograms)
          .set({ updatedAt: input.at })
          .where(
            and(
              eq(goalPrograms.organizationId, input.program.organizationId),
              eq(goalPrograms.propertyId, input.program.propertyId),
              eq(goalPrograms.id, input.program.id),
              eq(goalPrograms.status, 'active'),
              eq(goalPrograms.currentVersion, input.version.version),
            ),
          )
          .returning({ id: goalPrograms.id })
        if (!head) return 0
        const inserted = await tx
          .insert(goalMonthlyResults)
          .values(input.results.map(resultValues))
          .onConflictDoNothing()
          .returning({ id: goalMonthlyResults.id })
        if (inserted.length === 0) return 0
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType: 'goal.monthly_results.scheduled',
          eventVersion: 1,
          organizationId: input.program.organizationId,
          propertyId: input.program.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: input.program.id,
          payload: {
            programId: input.program.id,
            programVersionId: input.version.id,
            resultCount: inserted.length,
            periodStart: input.results[0]?.periodStart.toISOString() ?? null,
            periodEnd: input.results[0]?.periodEnd.toISOString() ?? null,
          },
        })
        return inserted.length
      })
    },

    async listDueResults(now) {
      const rows = await db
        .select()
        .from(goalMonthlyResults)
        .where(
          and(
            or(
              eq(goalMonthlyResults.status, 'open'),
              eq(goalMonthlyResults.status, 'reconciling'),
            ),
            lte(goalMonthlyResults.periodEnd, now),
          ),
        )
        .orderBy(asc(goalMonthlyResults.periodEnd), asc(goalMonthlyResults.id))
      return rows.map(mapResult)
    },

    async getDueResult(organizationId, propertyId, resultId, now) {
      const [row] = await db
        .select()
        .from(goalMonthlyResults)
        .where(
          and(
            eq(goalMonthlyResults.organizationId, organizationId),
            eq(goalMonthlyResults.propertyId, propertyId),
            eq(goalMonthlyResults.id, resultId),
            or(
              eq(goalMonthlyResults.status, 'open'),
              eq(goalMonthlyResults.status, 'reconciling'),
            ),
            lte(goalMonthlyResults.periodEnd, now),
          ),
        )
        .limit(1)
      return row ? mapResult(row) : null
    },

    async getAssignment(organizationId, propertyId, assignmentId) {
      const [row] = await db
        .select()
        .from(goalSubjectAssignments)
        .where(
          and(
            eq(goalSubjectAssignments.organizationId, organizationId),
            eq(goalSubjectAssignments.propertyId, propertyId),
            eq(goalSubjectAssignments.id, assignmentId),
          ),
        )
        .limit(1)
      return row ? mapAssignment(row) : null
    },

    async getVersion(organizationId, propertyId, programVersionId) {
      const [row] = await db
        .select()
        .from(goalProgramVersions)
        .where(
          and(
            eq(goalProgramVersions.organizationId, organizationId),
            eq(goalProgramVersions.propertyId, propertyId),
            eq(goalProgramVersions.id, programVersionId),
          ),
        )
        .limit(1)
      return row ? mapVersion(row) : null
    },

    async updateResult(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(goalMonthlyResults)
          .set({
            status: input.result.status,
            evaluationState: input.result.evaluation.state,
            value: input.result.evaluation.value,
            sampleCount: input.result.evaluation.sampleCount,
            achieved: input.result.evaluation.achieved,
            reason: input.result.evaluation.reason,
            sourceCompleteThrough: input.result.sourceCompleteThrough,
            evaluationWatermark: input.result.evaluationWatermark,
            closedAt: input.result.closedAt,
            updatedAt: input.result.updatedAt,
          })
          .where(
            and(
              eq(goalMonthlyResults.organizationId, input.result.organizationId),
              eq(goalMonthlyResults.propertyId, input.result.propertyId),
              eq(goalMonthlyResults.id, input.result.id),
              eq(goalMonthlyResults.status, input.expectedStatus),
            ),
          )
          .returning()
        if (!row) return null
        await tx.insert(outboxEvents).values({
          id: input.outboxEventId,
          eventType:
            input.result.status === 'closed'
              ? 'goal.monthly_result.closed'
              : 'goal.monthly_result.reconciled',
          eventVersion: 1,
          organizationId: input.result.organizationId,
          propertyId: input.result.propertyId,
          sourceContext: 'goal',
          sourceAggregateId: input.result.programId,
          payload: {
            programId: input.result.programId,
            programVersionId: input.result.programVersionId,
            assignmentId: input.result.assignmentId,
            monthlyResultId: input.result.id,
            periodStart: input.result.periodStart.toISOString(),
            periodEnd: input.result.periodEnd.toISOString(),
            status: input.result.status,
            evaluationState: input.result.evaluation.state,
            achieved: input.result.evaluation.achieved,
          },
        })
        return mapResult(row)
      })
    },
  }
}
