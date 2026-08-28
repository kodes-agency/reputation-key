import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  goalResultRevisions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type {
  GoalMonthlyResult,
  GoalResultRevision,
  GoalProgram,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import { parseGoalSubject } from '../../domain/goal-program'
import {
  goalMonthlyResultClosed,
  goalMonthlyResultReconciled,
  goalMonthlyResultRevised,
} from '../../domain/events'

class GoalProgramRevisionConflict extends Error {}

function hasPostgresErrorCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>()
  let candidate = error
  while (typeof candidate === 'object' && candidate !== null && !seen.has(candidate)) {
    seen.add(candidate)
    if ((candidate as { code?: unknown }).code === code) return true
    candidate = (candidate as { cause?: unknown }).cause
  }
  return false
}

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

function mapResult(
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

function mapResultRevision(
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
  const revisions =
    results.length === 0
      ? []
      : await db
          .select()
          .from(goalResultRevisions)
          .where(
            inArray(
              goalResultRevisions.monthlyResultId,
              results.map((result) => result.id),
            ),
          )
          .orderBy(
            asc(goalResultRevisions.monthlyResultId),
            asc(goalResultRevisions.revision),
          )
  const correctionByResultId = new Map<string, typeof goalResultRevisions.$inferSelect>()
  for (const revision of revisions) {
    correctionByResultId.set(revision.monthlyResultId, revision)
  }

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
        versions: versions
          .filter((version) => version.programId === programRow.id)
          .sort((left, right) => left.version - right.version)
          .map(mapVersion),
        assignments: assignments
          .filter((assignment) => assignment.programId === programRow.id)
          .map(mapAssignment),
        results: results
          .filter((result) => result.programId === programRow.id)
          .map((result) => mapResult(result, correctionByResultId.get(result.id))),
      },
    ]
  })
}

export const createGoalProgramRepository = (db: Database): GoalProgramRepository => {
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
        if (input.status === 'ended') {
          // Ending stops future materialization but must not strand an already
          // opened monthly result outside its immutable assignment/version
          // window. Close at the latest of: command time, the planned start
          // (an empty interval when cancelled before start), or an open result's
          // month end. [from, to) then releases the subject for the next month.
          const [openVersion] = await tx
            .select({ effectiveFrom: goalProgramVersions.effectiveFrom })
            .from(goalProgramVersions)
            .where(
              and(
                eq(goalProgramVersions.organizationId, input.organizationId),
                eq(goalProgramVersions.propertyId, input.propertyId),
                eq(goalProgramVersions.programId, input.programId),
                isNull(goalProgramVersions.effectiveTo),
              ),
            )
            .limit(1)
          if (!openVersion) throw new GoalProgramRevisionConflict()
          const [openResult] = await tx
            .select({ periodEnd: goalMonthlyResults.periodEnd })
            .from(goalMonthlyResults)
            .where(
              and(
                eq(goalMonthlyResults.organizationId, input.organizationId),
                eq(goalMonthlyResults.propertyId, input.propertyId),
                eq(goalMonthlyResults.programId, input.programId),
                inArray(goalMonthlyResults.status, ['open', 'reconciling']),
              ),
            )
            .orderBy(desc(goalMonthlyResults.periodEnd))
            .limit(1)
          const boundary = new Date(
            Math.max(
              input.at.getTime(),
              openVersion.effectiveFrom.getTime(),
              openResult?.periodEnd?.getTime() ?? Number.NEGATIVE_INFINITY,
            ),
          )
          await tx
            .update(goalSubjectAssignments)
            .set({
              effectiveTo: sql`greatest(${goalSubjectAssignments.effectiveFrom}, ${boundary})`,
            })
            .where(
              and(
                eq(goalSubjectAssignments.organizationId, input.organizationId),
                eq(goalSubjectAssignments.propertyId, input.propertyId),
                eq(goalSubjectAssignments.programId, input.programId),
                isNull(goalSubjectAssignments.effectiveTo),
              ),
            )
          const closedVersions = await tx
            .update(goalProgramVersions)
            .set({
              effectiveTo: sql`greatest(${goalProgramVersions.effectiveFrom}, ${boundary})`,
            })
            .where(
              and(
                eq(goalProgramVersions.organizationId, input.organizationId),
                eq(goalProgramVersions.propertyId, input.propertyId),
                eq(goalProgramVersions.programId, input.programId),
                isNull(goalProgramVersions.effectiveTo),
              ),
            )
            .returning({ id: goalProgramVersions.id })
          if (closedVersions.length !== 1) throw new GoalProgramRevisionConflict()
        }
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
      try {
        return await db.transaction(async (tx) => {
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
          if (!program) return false

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
          if (!closedVersion) throw new GoalProgramRevisionConflict()
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
            throw new GoalProgramRevisionConflict()
          }
          await tx.insert(goalProgramVersions).values(versionValues(input.version))
          await tx
            .insert(goalSubjectAssignments)
            .values(input.assignments.map(assignmentValues))
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
          return true
        })
      } catch (error) {
        if (
          error instanceof GoalProgramRevisionConflict ||
          hasPostgresErrorCode(error, '23P01')
        ) {
          return false
        }
        throw error
      }
    },

    async findAssignmentConflicts(input) {
      if (input.subjects.length === 0) return []
      const propertySubjectIds = input.subjects.flatMap((subject) =>
        subject.kind === 'property' ? [subject.propertyId] : [],
      )
      const portalGroupIds = input.subjects.flatMap((subject) =>
        subject.kind === 'portal_group' ? [subject.portalGroupId] : [],
      )
      const portalIds = input.subjects.flatMap((subject) =>
        subject.kind === 'portal' ? [subject.portalId] : [],
      )
      const requestedSubjects = or(
        propertySubjectIds.length > 0
          ? and(
              eq(goalSubjectAssignments.subjectKind, 'property'),
              inArray(goalSubjectAssignments.propertySubjectId, propertySubjectIds),
            )
          : undefined,
        portalGroupIds.length > 0
          ? and(
              eq(goalSubjectAssignments.subjectKind, 'portal_group'),
              inArray(goalSubjectAssignments.portalGroupId, portalGroupIds),
            )
          : undefined,
        portalIds.length > 0
          ? and(
              eq(goalSubjectAssignments.subjectKind, 'portal'),
              inArray(goalSubjectAssignments.portalId, portalIds),
            )
          : undefined,
      )
      if (!requestedSubjects) return []
      const requested = new Set(
        input.subjects.map((subject) => {
          switch (subject.kind) {
            case 'property':
              return `property:${subject.propertyId}`
            case 'portal_group':
              return `portal_group:${subject.portalGroupId}`
            case 'portal':
              return `portal:${subject.portalId}`
          }
        }),
      )
      const rows = await db
        .select()
        .from(goalSubjectAssignments)
        .where(
          and(
            eq(goalSubjectAssignments.organizationId, input.organizationId),
            eq(goalSubjectAssignments.propertyId, input.propertyId),
            ne(goalSubjectAssignments.programId, input.excludeProgramId),
            eq(goalSubjectAssignments.metricKey, input.metric),
            or(
              isNull(goalSubjectAssignments.effectiveTo),
              gt(goalSubjectAssignments.effectiveTo, input.effectiveFrom),
            ),
            requestedSubjects,
          ),
        )
      const conflicts = new Map<string, GoalSubjectAssignment['subject']>()
      for (const row of rows) {
        const subject = mapAssignment(row).subject
        const identity =
          subject.kind === 'property'
            ? `property:${subject.propertyId}`
            : subject.kind === 'portal_group'
              ? `portal_group:${subject.portalGroupId}`
              : `portal:${subject.portalId}`
        if (requested.has(identity)) conflicts.set(identity, subject)
      }
      return [...conflicts.values()]
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
