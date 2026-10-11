// Goal Program persistence — monthly results: opening, reading, reconciling,
// closing and correcting them.
//
// Composed into the one GoalProgramRepository port by goal-program.repository.ts.
// The Program, version and assignment writes stay there; the row mapping both
// modules use is in goal-program.rows.ts.
import { and, asc, desc, eq, gt, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  goalResultRevisions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type {
  GoalMonthlyResult,
  GoalProgramRepository,
} from '../../application/ports/goal-program.repository'
import {
  goalMonthlyResultClosed,
  goalMonthlyResultReconciled,
  goalMonthlyResultRevised,
} from '../../domain/goal-events'
import {
  hasPostgresErrorCode,
  mapAssignment,
  mapResult,
  mapResultRevision,
  mapVersion,
  resultValues,
} from './goal-program.rows'

function sameEvaluation(
  left: GoalMonthlyResult['evaluation'],
  right: GoalMonthlyResult['evaluation'],
): boolean {
  return (
    left.state === right.state &&
    left.value === right.value &&
    left.sampleCount === right.sampleCount &&
    left.achieved === right.achieved &&
    left.reason === right.reason
  )
}

const sameDate = (left: Date | null, right: Date | null): boolean =>
  left?.getTime() === right?.getTime()

type GoalMonthlyResultRepository = Pick<
  GoalProgramRepository,
  | 'appendResults'
  | 'listDueResults'
  | 'findClosedResultIdsForMetricImpact'
  | 'getDueResult'
  | 'getAssignment'
  | 'getVersion'
  | 'updateResult'
  | 'getClosedResult'
  | 'appendResultRevision'
>

export const createGoalMonthlyResultRepository = (
  db: Database,
): GoalMonthlyResultRepository => {
  return {
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
      return rows.map((row) => mapResult(row))
    },

    async findClosedResultIdsForMetricImpact(input) {
      const matchingSubject = or(
        and(
          eq(goalSubjectAssignments.subjectKind, 'property'),
          eq(goalSubjectAssignments.propertySubjectId, input.propertyId),
        ),
        input.portalGroupId
          ? and(
              eq(goalSubjectAssignments.subjectKind, 'portal_group'),
              eq(goalSubjectAssignments.portalGroupId, input.portalGroupId),
            )
          : undefined,
        input.portalId
          ? and(
              eq(goalSubjectAssignments.subjectKind, 'portal'),
              eq(goalSubjectAssignments.portalId, input.portalId),
            )
          : undefined,
      )
      const rows = await db
        .select({ id: goalMonthlyResults.id })
        .from(goalMonthlyResults)
        .innerJoin(
          goalSubjectAssignments,
          and(
            eq(goalSubjectAssignments.organizationId, goalMonthlyResults.organizationId),
            eq(goalSubjectAssignments.propertyId, goalMonthlyResults.propertyId),
            eq(goalSubjectAssignments.programId, goalMonthlyResults.programId),
            eq(
              goalSubjectAssignments.programVersionId,
              goalMonthlyResults.programVersionId,
            ),
            eq(goalSubjectAssignments.id, goalMonthlyResults.assignmentId),
          ),
        )
        .innerJoin(
          goalProgramVersions,
          and(
            eq(goalProgramVersions.organizationId, goalMonthlyResults.organizationId),
            eq(goalProgramVersions.propertyId, goalMonthlyResults.propertyId),
            eq(goalProgramVersions.programId, goalMonthlyResults.programId),
            eq(goalProgramVersions.id, goalMonthlyResults.programVersionId),
          ),
        )
        .where(
          and(
            eq(goalMonthlyResults.organizationId, input.organizationId),
            eq(goalMonthlyResults.propertyId, input.propertyId),
            eq(goalMonthlyResults.status, 'closed'),
            eq(goalProgramVersions.metricDefinitionVersionId, input.definitionVersionId),
            lte(goalMonthlyResults.periodStart, input.eventAt),
            gt(goalMonthlyResults.periodEnd, input.eventAt),
            matchingSubject,
          ),
        )
        .orderBy(asc(goalMonthlyResults.id))

      return [...new Set(rows.map((row) => row.id))]
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
        const updated = mapResult(row)
        if (updated.status === 'open') {
          throw new Error('Goal result update cannot emit a fact for open status')
        }
        const eventArgs = {
          organizationId: updated.organizationId,
          propertyId: updated.propertyId,
          programId: updated.programId,
          programVersionId: updated.programVersionId,
          assignmentId: updated.assignmentId,
          monthlyResultId: updated.id,
          periodStart: updated.periodStart,
          periodEnd: updated.periodEnd,
          evaluationState: updated.evaluation.state,
          achieved: updated.evaluation.achieved,
          occurredAt: updated.updatedAt,
        } as const
        const event =
          updated.status === 'closed'
            ? goalMonthlyResultClosed(eventArgs)
            : goalMonthlyResultReconciled(eventArgs)
        await insertOutboxRow(tx, event, { recordedAt: updated.updatedAt })
        return updated
      })
    },

    async getClosedResult(organizationId, propertyId, resultId) {
      const [row] = await db
        .select()
        .from(goalMonthlyResults)
        .where(
          and(
            eq(goalMonthlyResults.organizationId, organizationId),
            eq(goalMonthlyResults.propertyId, propertyId),
            eq(goalMonthlyResults.id, resultId),
            eq(goalMonthlyResults.status, 'closed'),
          ),
        )
        .limit(1)
      if (!row) return null
      const [revisionRow] = await db
        .select()
        .from(goalResultRevisions)
        .where(
          and(
            eq(goalResultRevisions.organizationId, organizationId),
            eq(goalResultRevisions.propertyId, propertyId),
            eq(goalResultRevisions.monthlyResultId, resultId),
          ),
        )
        .orderBy(desc(goalResultRevisions.revision))
        .limit(1)
      return {
        result: mapResult(row, revisionRow),
        revision: revisionRow ? mapResultRevision(revisionRow) : null,
      }
    },

    async appendResultRevision(input) {
      try {
        return await db.transaction(async (tx) => {
          const [base] = await tx
            .select()
            .from(goalMonthlyResults)
            .where(
              and(
                eq(goalMonthlyResults.organizationId, input.head.result.organizationId),
                eq(goalMonthlyResults.propertyId, input.head.result.propertyId),
                eq(goalMonthlyResults.id, input.head.result.id),
                eq(goalMonthlyResults.status, 'closed'),
              ),
            )
            .for('update')
            .limit(1)
          if (!base) return { status: 'conflict' as const }
          const [latestRow] = await tx
            .select()
            .from(goalResultRevisions)
            .where(
              and(
                eq(goalResultRevisions.organizationId, input.head.result.organizationId),
                eq(goalResultRevisions.propertyId, input.head.result.propertyId),
                eq(goalResultRevisions.monthlyResultId, input.head.result.id),
              ),
            )
            .orderBy(desc(goalResultRevisions.revision))
            .limit(1)
          if ((latestRow?.id ?? null) !== (input.head.revision?.id ?? null)) {
            return { status: 'conflict' as const }
          }
          const current = mapResult(base, latestRow)
          if (
            sameEvaluation(current.evaluation, input.evaluation) &&
            sameDate(current.sourceCompleteThrough, input.sourceCompleteThrough)
          ) {
            return { status: 'unchanged' as const, result: current }
          }
          const revision = (latestRow?.revision ?? 0) + 1
          const revisionRow = {
            id: input.revisionId,
            monthlyResultId: current.id,
            organizationId: current.organizationId,
            propertyId: current.propertyId,
            revision,
            supersedesRevisionId: latestRow?.id ?? null,
            evaluationState: input.evaluation.state,
            value: input.evaluation.value,
            sampleCount: input.evaluation.sampleCount,
            achieved: input.evaluation.achieved,
            reason: input.evaluation.reason,
            sourceCompleteThrough: input.sourceCompleteThrough,
            evaluationWatermark: input.evaluationWatermark,
            changeReason: input.changeReason,
            createdBy: input.createdBy,
            createdAt: input.at,
          }
          const [inserted] = await tx
            .insert(goalResultRevisions)
            .values(revisionRow)
            .returning()
          if (!inserted) return { status: 'conflict' as const }

          const outcomeChanged = current.evaluation.achieved !== input.evaluation.achieved
          const availabilityChanged = current.evaluation.state !== input.evaluation.state
          await tx.insert(auditLogs).values({
            organizationId: current.organizationId,
            userId: input.createdBy,
            action: 'goal.monthly_result.revised',
            resourceType: 'goal_monthly_result',
            resourceId: current.id,
            details: {
              propertyId: current.propertyId,
              programId: current.programId,
              revision,
              supersedesRevisionId: latestRow?.id ?? null,
              changeReason: input.changeReason,
              outcomeChanged,
              availabilityChanged,
            },
          })
          const event = goalMonthlyResultRevised({
            organizationId: current.organizationId,
            propertyId: current.propertyId,
            programId: current.programId,
            programVersionId: current.programVersionId,
            assignmentId: current.assignmentId,
            monthlyResultId: current.id,
            revisionId: inserted.id,
            revision,
            supersedesRevisionId: latestRow?.id ?? null,
            periodStart: current.periodStart,
            periodEnd: current.periodEnd,
            evaluationState: input.evaluation.state,
            achieved: input.evaluation.achieved,
            outcomeChanged,
            availabilityChanged,
            occurredAt: input.at,
          })
          await insertOutboxRow(tx, event, { recordedAt: input.at })
          const mappedRevision = mapResultRevision(inserted)
          return {
            status: 'revised' as const,
            result: mapResult(base, inserted),
            revision: mappedRevision,
            outcomeChanged,
            availabilityChanged,
          }
        })
      } catch (error) {
        if (hasPostgresErrorCode(error, '23505')) {
          return { status: 'conflict' as const }
        }
        throw error
      }
    },
  }
}
