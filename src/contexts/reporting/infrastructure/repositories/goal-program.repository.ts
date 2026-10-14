import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  goalResultRevisions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import type { Tx } from '#/shared/outbox/commit'
import type {
  GoalAssignmentConflict,
  GoalProgram,
  GoalProgramBundle,
  GoalProgramRepository,
} from '../../application/ports/goal-program.repository'
import { holdOutlasts } from '../../application/goal-subject-holds'
import { goalSubjectIdentity } from '../../domain/goal-program'
import {
  createGoalMonthTargetRepository,
  listTargetChanges,
} from './goal-month-target.repository'
import { createGoalMonthlyResultRepository } from './goal-monthly-result.repository'
import {
  isOrganizationHeldByLifecycle,
  organizationLifecycleHoldsProgram,
} from './goal-organization-lifecycle-hold'
import {
  assignmentValues,
  GoalProgramRevisionConflict,
  hasPostgresErrorCode,
  mapAssignment,
  mapProgram,
  mapResult,
  mapVersion,
  programValues,
  resultValues,
  versionValues,
} from './goal-program.rows'

/**
 * PostgreSQL takes at most 65,535 bound values in one statement, and
 * node-postgres writes the count as a 16-bit integer: past it the statement
 * fails ("bind message has N parameter formats but 0 parameters"). Closed
 * months are kept, so the maintenance listing, which loads every scheduled and
 * active program of every tenant, would one day cross it and fail every hour
 * for all of them. Ids are bound in chunks well under the limit.
 */
const MAX_BOUND_IDS = 10_000

/**
 * Runs `select` for each chunk of `ids`, one after the other, and joins the
 * rows. A row belongs to one id, so it appears in one chunk and a chunk's own
 * order is kept within it.
 */
async function selectByIds<Row>(
  ids: readonly string[],
  select: (chunk: readonly string[]) => Promise<readonly Row[]>,
): Promise<readonly Row[]> {
  const rows: Row[] = []
  for (let start = 0; start < ids.length; start += MAX_BOUND_IDS) {
    rows.push(...(await select(ids.slice(start, start + MAX_BOUND_IDS))))
  }
  return rows
}

async function hydrateBundles(
  db: Database,
  programs: readonly (typeof goalPrograms.$inferSelect)[],
): Promise<readonly GoalProgramBundle[]> {
  if (programs.length === 0) return []
  const programIds = programs.map((program) => program.id)
  const [versions, assignments, results] = await Promise.all([
    selectByIds(programIds, (ids) =>
      db
        .select()
        .from(goalProgramVersions)
        .where(inArray(goalProgramVersions.programId, [...ids])),
    ),
    selectByIds(programIds, (ids) =>
      db
        .select()
        .from(goalSubjectAssignments)
        .where(inArray(goalSubjectAssignments.programId, [...ids]))
        .orderBy(asc(goalSubjectAssignments.createdAt), asc(goalSubjectAssignments.id)),
    ),
    selectByIds(programIds, (ids) =>
      db
        .select()
        .from(goalMonthlyResults)
        .where(inArray(goalMonthlyResults.programId, [...ids]))
        .orderBy(asc(goalMonthlyResults.periodStart), asc(goalMonthlyResults.id)),
    ),
  ])
  const revisions = await selectByIds(
    results.map((result) => result.id),
    (ids) =>
      db
        .select()
        .from(goalResultRevisions)
        .where(inArray(goalResultRevisions.monthlyResultId, [...ids]))
        .orderBy(
          asc(goalResultRevisions.monthlyResultId),
          asc(goalResultRevisions.revision),
        ),
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

/**
 * The bundles a page or a command reads, each with the log of its months'
 * target changes. The log is read here, for one tenant's Property, and not in
 * the hydration above: that one loads children by parent id alone.
 */
async function withTargetChanges(
  db: Database,
  organizationId: string,
  propertyId: string,
  bundles: readonly GoalProgramBundle[],
): Promise<readonly GoalProgramBundle[]> {
  const changes = await listTargetChanges(
    db,
    organizationId,
    propertyId,
    bundles.map((bundle) => bundle.program.id),
  )
  return bundles.map((bundle) => ({
    ...bundle,
    targetChanges: changes.filter((change) => change.programId === bundle.program.id),
  }))
}

/**
 * The body of `revise`, inside a transaction its caller owns. False when the
 * Program head moved; a month opened since the caller read the Program throws
 * GoalProgramRevisionConflict, which `revise` reports as false too.
 */
async function reviseInTx(
  tx: Tx,
  input: Parameters<GoalProgramRepository['revise']>[0],
): Promise<boolean> {
  const [program] = await tx
    .update(goalPrograms)
    .set({
      currentVersion: input.version.version,
      updatedAt: input.at,
      // What a goal that has not started waits for follows its plan. A goal
      // activated since the caller read it has no such reason any more, so
      // only a Program still scheduled takes the new one.
      ...(input.scheduledStatusReason === undefined
        ? {}
        : {
            statusReason: sql`case when ${goalPrograms.status} = 'scheduled'
              then ${input.scheduledStatusReason}
              else ${goalPrograms.statusReason} end`,
          }),
    })
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

  // The caller decided from a read taken before this transaction, and
  // maintenance may have opened a month for the expected version since.
  // activate and appendResults lock the Program row first, as the update
  // above does, so this read sees any such month.
  //  - Following a head in force: a month still open or reconciling past the
  //    new start refuses the revision. Closing the version inside that month
  //    would leave the month outside its window for good.
  //  - Replacing a head that had no month: any month at all refuses it. The
  //    head is in force now and has to be followed, not replaced.
  const [blockingMonth] = await tx
    .select({ id: goalMonthlyResults.id })
    .from(goalMonthlyResults)
    .where(
      and(
        eq(goalMonthlyResults.organizationId, input.version.organizationId),
        eq(goalMonthlyResults.propertyId, input.version.propertyId),
        eq(goalMonthlyResults.programId, input.version.programId),
        eq(goalMonthlyResults.programVersionId, input.expectedVersion.id),
        input.supersedeRowlessHead
          ? undefined
          : and(
              inArray(goalMonthlyResults.status, ['open', 'reconciling']),
              gt(goalMonthlyResults.periodEnd, input.version.effectiveFrom),
            ),
      ),
    )
    .limit(1)
  if (blockingMonth) throw new GoalProgramRevisionConflict()

  // A head in force closes where the new version starts. A replaced head
  // keeps the empty window [from, from): it stays in the history, overlaps no
  // other version and holds no subject.
  const [closedVersion] = await tx
    .update(goalProgramVersions)
    .set({
      effectiveTo: input.supersedeRowlessHead
        ? sql`${goalProgramVersions.effectiveFrom}`
        : input.version.effectiveFrom,
    })
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
    .set({
      effectiveTo: input.supersedeRowlessHead
        ? sql`${goalSubjectAssignments.effectiveFrom}`
        : input.version.effectiveFrom,
    })
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
  await tx.insert(goalSubjectAssignments).values(input.assignments.map(assignmentValues))
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
  return true
}

/**
 * Where an ending Program's open version and its assignments close, given the
 * open version's start. The caller has locked the Program row, and the writers
 * that open a month take that lock first, so no month appears after this read.
 *
 * - A Program that never started (still scheduled, with no month) closes where
 *   it starts: the empty window [from, from), whatever the clock says. Its
 *   start may already have passed while it waited for its metric source or for
 *   the hourly job; it still counted nothing and must not hold its subjects.
 * - A Program that has started closes at the latest of the command time, the
 *   open version's start (a change still waiting for its month) and the end
 *   of a month still open or reconciling. Ending must not strand such a month
 *   outside its window; [from, to) then frees the subject for the next month.
 */
async function endingBoundary(
  tx: Tx,
  input: Parameters<GoalProgramRepository['changeStatus']>[0],
  openVersionStart: Date,
): Promise<Date> {
  const ofProgram = and(
    eq(goalMonthlyResults.organizationId, input.organizationId),
    eq(goalMonthlyResults.propertyId, input.propertyId),
    eq(goalMonthlyResults.programId, input.programId),
  )
  if (input.expectedStatus === 'scheduled') {
    const [month] = await tx
      .select({ id: goalMonthlyResults.id })
      .from(goalMonthlyResults)
      .where(ofProgram)
      .limit(1)
    if (!month) return openVersionStart
  }
  const [openResult] = await tx
    .select({ periodEnd: goalMonthlyResults.periodEnd })
    .from(goalMonthlyResults)
    .where(and(ofProgram, inArray(goalMonthlyResults.status, ['open', 'reconciling'])))
    .orderBy(desc(goalMonthlyResults.periodEnd))
    .limit(1)
  return new Date(
    Math.max(
      input.at.getTime(),
      openVersionStart.getTime(),
      openResult?.periodEnd?.getTime() ?? Number.NEGATIVE_INFINITY,
    ),
  )
}

export const createGoalProgramRepository = (db: Database): GoalProgramRepository => {
  /**
   * Runs a status change in a transaction. Ending a Program that finds its
   * version history changed under it throws GoalProgramRevisionConflict; the
   * transaction then wrote nothing, and the caller is told null, as for a
   * status that had already moved.
   */
  const changeStatusOrConflict = async (
    change: (tx: Tx) => Promise<GoalProgram | null>,
  ): Promise<GoalProgram | null> => {
    try {
      return await db.transaction(change)
    } catch (error) {
      if (error instanceof GoalProgramRevisionConflict) return null
      throw error
    }
  }

  return {
    async create(input) {
      const { bundle } = input
      try {
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
        })
      } catch (error) {
        // A new Program has one version, so the only no-overlap constraint it
        // can meet is the subject's: another goal took the subject and metric
        // after the caller checked. The transaction wrote nothing.
        if (hasPostgresErrorCode(error, '23P01')) return 'subject_has_goal'
        throw error
      }
      return 'created'
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
      const bundles = await hydrateBundles(db, rows)
      return (await withTargetChanges(db, organizationId, propertyId, bundles))[0] ?? null
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
      const bundles = await hydrateBundles(db, rows)
      return withTargetChanges(db, organizationId, propertyId, bundles)
    },

    async listOperational() {
      // A closing Organization gets no new Goal work (see the hold's header).
      const rows = await db
        .select()
        .from(goalPrograms)
        .where(
          and(
            inArray(goalPrograms.status, ['scheduled', 'active']),
            sql`NOT ${organizationLifecycleHoldsProgram}`,
          ),
        )
        .orderBy(
          asc(goalPrograms.organizationId),
          asc(goalPrograms.propertyId),
          asc(goalPrograms.id),
        )
      return hydrateBundles(db, rows)
    },

    isOrganizationHeld(organizationId) {
      return isOrganizationHeldByLifecycle(db, organizationId)
    },

    async changeStatus(input) {
      return changeStatusOrConflict(async (tx) => {
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
          // Ending stops future materialization and closes the open version
          // and its assignments at one boundary (see endingBoundary).
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
          const boundary = await endingBoundary(tx, input, openVersion.effectiveFrom)
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
            // A note is recorded only when the manager wrote one.
            ...(input.reason === null ? {} : { reason: input.reason }),
          },
        })
        return mapProgram(row)
      })
    },

    async revise(input) {
      try {
        return await db.transaction((tx) => reviseInTx(tx, input))
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

    async rename(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(goalPrograms)
          .set({
            name: input.name,
            description: input.description,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(goalPrograms.organizationId, input.organizationId),
              eq(goalPrograms.propertyId, input.propertyId),
              eq(goalPrograms.id, input.programId),
              ne(goalPrograms.status, 'ended'),
              // Only while the goal still says what the command read: a
              // rename that landed in between is not undone, and the audit
              // row below names the name this one really replaced.
              eq(goalPrograms.name, input.previousName),
              input.previousDescription === null
                ? isNull(goalPrograms.description)
                : eq(goalPrograms.description, input.previousDescription),
            ),
          )
          .returning()
        if (!row) return null
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          userId: input.actorId,
          action: 'goal.program.renamed',
          resourceType: 'goal_program',
          resourceId: input.programId,
          details: {
            propertyId: input.propertyId,
            previousName: input.previousName,
            name: input.name,
            // The text of a description is not kept here; that it changed is,
            // so an edit of the description alone does not read as no change.
            descriptionChanged: input.description !== input.previousDescription,
          },
        })
        return mapProgram(row)
      })
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
      const requested = new Set(input.subjects.map(goalSubjectIdentity))
      const rows = await db
        .select()
        .from(goalSubjectAssignments)
        .where(
          and(
            eq(goalSubjectAssignments.organizationId, input.organizationId),
            eq(goalSubjectAssignments.propertyId, input.propertyId),
            input.excludeProgramId === undefined
              ? undefined
              : ne(goalSubjectAssignments.programId, input.excludeProgramId),
            eq(goalSubjectAssignments.metricKey, input.metric),
            // What the no-overlap constraint counts against a window open from
            // `effectiveFrom`: an open-ended assignment, or one that ends after
            // it. A window that ends where it starts is empty and holds nothing.
            or(
              isNull(goalSubjectAssignments.effectiveTo),
              and(
                gt(goalSubjectAssignments.effectiveTo, input.effectiveFrom),
                gt(
                  goalSubjectAssignments.effectiveTo,
                  goalSubjectAssignments.effectiveFrom,
                ),
              ),
            ),
            requestedSubjects,
          ),
        )
      const conflicts = new Map<string, GoalAssignmentConflict>()
      for (const row of rows) {
        const assignment = mapAssignment(row)
        const identity = goalSubjectIdentity(assignment.subject)
        if (!requested.has(identity)) continue
        const known = conflicts.get(identity)
        if (known && !holdOutlasts(assignment.effectiveTo, known.effectiveTo)) continue
        conflicts.set(identity, {
          subject: assignment.subject,
          programId: assignment.programId,
          effectiveTo: assignment.effectiveTo,
        })
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
              // A closure request that lands after maintenance listed this
              // program still stops it: the Closing fence cannot pause a
              // scheduled program, so this is the only place that can.
              sql`NOT ${organizationLifecycleHoldsProgram}`,
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
        return mapProgram(row)
      })
    },

    ...createGoalMonthlyResultRepository(db),
    ...createGoalMonthTargetRepository(db, reviseInTx),
  }
}
