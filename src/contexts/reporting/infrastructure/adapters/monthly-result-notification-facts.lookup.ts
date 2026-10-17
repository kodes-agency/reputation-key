import { and, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  goalResultRevisions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { portals } from '#/shared/db/schema/portal.schema'
import type { MonthlyResultNotificationFactsLookup } from '../../application/ports/monthly-result-notification-facts.lookup'
import { parseGoalSubject, type GoalMetric } from '../../domain/goal-program'

/** The correction a notice was raised for; the head is joined separately. */
const requestedRevision = alias(goalResultRevisions, 'requested_revision')

/**
 * True when the version a month was judged under was written after the month
 * began. Both reads join that exact version, so the comparison needs no
 * timezone: it is between two instants.
 */
const setDuringMonth =
  sql<boolean>`${goalProgramVersions.createdAt} > ${goalMonthlyResults.periodStart}`.as(
    'set_during_month',
  )

/**
 * True when the month has a target of its own. The guard lets a month take one
 * only while it is open and running, so a stored one was set during the month.
 */
const targetChangedInMonth =
  sql<boolean>`${goalMonthlyResults.targetValue} IS NOT NULL`.as(
    'target_changed_in_month',
  )

/**
 * The target the month was judged against: a target of its own when it was
 * changed while the month ran, else its version's.
 */
const judgedTarget =
  sql<number>`coalesce(${goalMonthlyResults.targetValue}, ${goalProgramVersions.targetValue})`
    .mapWith(Number)
    .as('judged_target')

/**
 * The name of the Portal or Portal Group a goal is on; null for a Property
 * goal. A Portal context table read behind this port (ADR 0008 r.2): the name
 * is tenant-authored, so it is read when the notice is raised, never carried
 * by an event (ADR 0030).
 */
const subjectName = sql<
  string | null
>`coalesce(${portals.name}, ${portalGroups.name})`.as('subject_name')

/** The Portal a goal is on, inside the result's own tenant and Property. */
const subjectPortal = and(
  eq(portals.organizationId, goalSubjectAssignments.organizationId),
  eq(portals.propertyId, goalSubjectAssignments.propertyId),
  eq(portals.id, goalSubjectAssignments.portalId),
)

/** The Portal Group a goal is on, inside the result's own tenant and Property. */
const subjectPortalGroup = and(
  eq(portalGroups.organizationId, goalSubjectAssignments.organizationId),
  eq(portalGroups.propertyId, goalSubjectAssignments.propertyId),
  eq(portalGroups.id, goalSubjectAssignments.portalGroupId),
)

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
          periodMonth:
            sql<string>`to_char(${goalMonthlyResults.periodStart} AT TIME ZONE ${goalMonthlyResults.propertyTimezone}, 'YYYY-MM')`.as(
              'period_month',
            ),
          closedAchieved: goalMonthlyResults.achieved,
          closedValue: goalMonthlyResults.value,
          headRevisionId: goalResultRevisions.id,
          headAchieved: goalResultRevisions.achieved,
          headValue: goalResultRevisions.value,
          setDuringMonth,
          targetChangedInMonth,
          metric: goalProgramVersions.metricKey,
          target: judgedTarget,
          subjectName,
        })
        .from(goalMonthlyResults)
        .leftJoin(
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
        .leftJoin(portals, subjectPortal)
        .leftJoin(portalGroups, subjectPortalGroup)
        .where(
          and(
            eq(goalMonthlyResults.organizationId, input.organizationId),
            eq(goalMonthlyResults.propertyId, input.propertyId),
            eq(goalMonthlyResults.assignmentId, input.assignmentId),
            eq(goalMonthlyResults.id, input.monthlyResultId),
            eq(goalMonthlyResults.status, 'closed'),
          ),
        )
        .orderBy(sql`${goalResultRevisions.revision} DESC NULLS LAST`)
        .limit(1)

      // A completion stands on the result as it is NOW: the latest correction
      // when there is one, the closed row otherwise.
      const achieved = row?.headRevisionId ? row.headAchieved : row?.closedAchieved
      if (!row || achieved !== true) return null
      const subjectId = row.propertySubjectId ?? row.portalGroupId ?? row.portalId ?? ''
      const subject = parseGoalSubject(row.subjectKind, subjectId, input.propertyId)
      if (!subject) return null
      return {
        programId: row.programId,
        monthlyResultId: row.monthlyResultId,
        assignmentId: row.assignmentId,
        programName: row.programName,
        periodMonth: row.periodMonth,
        subject,
        setDuringMonth: row.setDuringMonth,
        targetChangedInMonth: row.targetChangedInMonth,
        // The CHECK on goal_program_versions admits only the three measures.
        metric: row.metric as GoalMetric,
        value: row.headRevisionId ? row.headValue : row.closedValue,
        target: row.target,
        subjectName: row.subjectName,
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
          value: goalResultRevisions.value,
          setDuringMonth,
          targetChangedInMonth,
          metric: goalProgramVersions.metricKey,
          target: judgedTarget,
          subjectName,
          periodMonth:
            sql<string>`to_char(${goalMonthlyResults.periodStart} AT TIME ZONE ${goalMonthlyResults.propertyTimezone}, 'YYYY-MM')`.as(
              'period_month',
            ),
        })
        .from(goalMonthlyResults)
        .innerJoin(
          requestedRevision,
          and(
            eq(requestedRevision.organizationId, goalMonthlyResults.organizationId),
            eq(requestedRevision.propertyId, goalMonthlyResults.propertyId),
            eq(requestedRevision.monthlyResultId, goalMonthlyResults.id),
            eq(requestedRevision.id, input.revisionId),
            eq(requestedRevision.revision, input.revision),
          ),
        )
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
        .leftJoin(portals, subjectPortal)
        .leftJoin(portalGroups, subjectPortalGroup)
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

      if (!row) return null
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
        periodMonth: row.periodMonth,
        subject,
        setDuringMonth: row.setDuringMonth,
        targetChangedInMonth: row.targetChangedInMonth,
        revisionId: row.revisionId,
        revision: row.revision,
        evaluationState,
        achieved: row.achieved,
        metric: row.metric as GoalMetric,
        value: row.value,
        target: row.target,
        subjectName: row.subjectName,
      }
    },
  }
}
