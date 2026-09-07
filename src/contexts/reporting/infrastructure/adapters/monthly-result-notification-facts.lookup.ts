import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  goalResultRevisions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import type { MonthlyResultNotificationFactsLookup } from '../../application/ports/monthly-result-notification-facts.lookup'
import { parseGoalSubject } from '../../domain/goal-program'

export const createMonthlyResultNotificationFactsLookup = (
  db: Database,
): MonthlyResultNotificationFactsLookup => {
  return {
    async findMonthlyResultNotificationFacts(input) {
      const [row] = await db
        .select({
          programId: goalPrograms.id,
          programName: goalPrograms.name,
          assignmentId: goalSubjectAssignments.id,
          monthlyResultId: goalMonthlyResults.id,
          subjectKind: goalSubjectAssignments.subjectKind,
          propertySubjectId: goalSubjectAssignments.propertySubjectId,
          portalGroupId: goalSubjectAssignments.portalGroupId,
          portalId: goalSubjectAssignments.portalId,
        })
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
            eq(goalProgramVersions.id, goalSubjectAssignments.programVersionId),
            eq(goalProgramVersions.metricKey, goalSubjectAssignments.metricKey),
          ),
        )
        .innerJoin(
          goalPrograms,
          and(
            eq(goalPrograms.organizationId, goalMonthlyResults.organizationId),
            eq(goalPrograms.propertyId, goalMonthlyResults.propertyId),
            eq(goalPrograms.id, goalMonthlyResults.programId),
          ),
        )
        .where(
          and(
            eq(goalMonthlyResults.organizationId, input.organizationId),
            eq(goalMonthlyResults.propertyId, input.propertyId),
            eq(goalMonthlyResults.assignmentId, input.assignmentId),
            eq(goalMonthlyResults.id, input.monthlyResultId),
            eq(goalMonthlyResults.status, 'closed'),
            eq(goalMonthlyResults.achieved, true),
          ),
        )
        .limit(1)

      if (!row) return null
      const subjectId = row.propertySubjectId ?? row.portalGroupId ?? row.portalId ?? ''
      const subject = parseGoalSubject(row.subjectKind, subjectId, input.propertyId)
      if (!subject) return null
      return {
        programId: row.programId,
        monthlyResultId: row.monthlyResultId,
        assignmentId: row.assignmentId,
        programName: row.programName,
        subject,
      }
    },

    async findMonthlyResultRevisionNotificationFacts(input) {
      const [row] = await db
        .select({
          programId: goalPrograms.id,
          programVersionId: goalMonthlyResults.programVersionId,
          programName: goalPrograms.name,
          assignmentId: goalSubjectAssignments.id,
          monthlyResultId: goalMonthlyResults.id,
          subjectKind: goalSubjectAssignments.subjectKind,
          propertySubjectId: goalSubjectAssignments.propertySubjectId,
          portalGroupId: goalSubjectAssignments.portalGroupId,
          portalId: goalSubjectAssignments.portalId,
          revisionId: goalResultRevisions.id,
          revision: goalResultRevisions.revision,
          evaluationState: goalResultRevisions.evaluationState,
          achieved: goalResultRevisions.achieved,
        })
        .from(goalMonthlyResults)
        .innerJoin(
          goalResultRevisions,
          and(
            eq(goalResultRevisions.organizationId, goalMonthlyResults.organizationId),
            eq(goalResultRevisions.propertyId, goalMonthlyResults.propertyId),
            eq(goalResultRevisions.monthlyResultId, goalMonthlyResults.id),
          ),
        )
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
            eq(goalProgramVersions.id, goalSubjectAssignments.programVersionId),
            eq(goalProgramVersions.metricKey, goalSubjectAssignments.metricKey),
          ),
        )
        .innerJoin(
          goalPrograms,
          and(
            eq(goalPrograms.organizationId, goalMonthlyResults.organizationId),
            eq(goalPrograms.propertyId, goalMonthlyResults.propertyId),
            eq(goalPrograms.id, goalMonthlyResults.programId),
          ),
        )
        .where(
          and(
            eq(goalMonthlyResults.organizationId, input.organizationId),
            eq(goalMonthlyResults.propertyId, input.propertyId),
            eq(goalMonthlyResults.programId, input.programId),
            eq(goalMonthlyResults.programVersionId, input.programVersionId),
            eq(goalMonthlyResults.assignmentId, input.assignmentId),
            eq(goalMonthlyResults.id, input.monthlyResultId),
            eq(goalMonthlyResults.status, 'closed'),
          ),
        )
        .orderBy(desc(goalResultRevisions.revision))
        .limit(1)

      if (
        !row ||
        row.revisionId !== input.revisionId ||
        row.revision !== input.revision
      ) {
        return null
      }
      const subjectId = row.propertySubjectId ?? row.portalGroupId ?? row.portalId ?? ''
      const subject = parseGoalSubject(row.subjectKind, subjectId, input.propertyId)
      if (!subject) return null
      const evaluationState = row.evaluationState as
        'eligible' | 'insufficient_data' | 'unavailable' | 'quarantined'
      if (
        (evaluationState === 'eligible' && typeof row.achieved !== 'boolean') ||
        (evaluationState !== 'eligible' && row.achieved !== null)
      ) {
        return null
      }
      return {
        programId: row.programId,
        programVersionId: row.programVersionId,
        monthlyResultId: row.monthlyResultId,
        assignmentId: row.assignmentId,
        programName: row.programName,
        subject,
        revisionId: row.revisionId,
        revision: row.revision,
        evaluationState,
        achieved: row.achieved,
      }
    },
  }
}
