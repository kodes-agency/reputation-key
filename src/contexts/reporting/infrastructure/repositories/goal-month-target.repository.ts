// Goal Program persistence — a month's own target: changing it while the month
// runs, and reading the log of its changes.
//
// Composed into the one GoalProgramRepository port by goal-program.repository.ts,
// which also hands over `reviseInTx`: the change can write the version that
// carries the target into the months after, in the same transaction, and this
// module must not import the module that composes it.
import { and, asc, eq, gt, inArray, lte, ne } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import {
  goalMonthlyResults,
  goalMonthTargetChanges,
  goalPrograms,
} from '#/shared/db/schema/goal.schema'
import type { Tx } from '#/shared/outbox/commit'
import type {
  GoalMonthTargetChange,
  GoalProgramRepository,
} from '../../application/ports/goal-program.repository'
import { GoalProgramRevisionConflict, hasPostgresErrorCode } from './goal-program.rows'

type ChangeMonthTargetInput = Parameters<GoalProgramRepository['changeMonthTarget']>[0]

/** The body of the repository's `revise`, run inside the caller's transaction. */
type ReviseInTx = (
  tx: Tx,
  input: Parameters<GoalProgramRepository['revise']>[0],
) => Promise<boolean>

/** A month is no longer open, or the database refused its new target. */
class GoalMonthTargetLocked extends Error {}

function mapTargetChange(
  row: typeof goalMonthTargetChanges.$inferSelect,
): GoalMonthTargetChange {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    programId: row.programId,
    monthlyResultId: row.monthlyResultId,
    changeId: row.changeId,
    previousTargetValue: row.previousTargetValue,
    newTargetValue: row.newTargetValue,
    followingOutcome: row.followingOutcome as GoalMonthTargetChange['followingOutcome'],
    followingReason: row.followingReason as GoalMonthTargetChange['followingReason'],
    followingVersionId: row.followingVersionId,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

/**
 * Every change to a month's target of the given Programs, oldest first. It
 * filters on the organization, the Property and the Program together: a
 * Program id alone never selects a row. Called by the Program reads `get` and
 * `list` only, and kept out of the bundle hydration, which loads children by
 * parent id.
 */
export async function listTargetChanges(
  db: Database,
  organizationId: string,
  propertyId: string,
  programIds: readonly string[],
): Promise<readonly GoalMonthTargetChange[]> {
  if (programIds.length === 0) return []
  const rows = await db
    .select()
    .from(goalMonthTargetChanges)
    .where(
      and(
        eq(goalMonthTargetChanges.organizationId, organizationId),
        eq(goalMonthTargetChanges.propertyId, propertyId),
        inArray(goalMonthTargetChanges.programId, [...programIds]),
      ),
    )
    .orderBy(
      asc(goalMonthTargetChanges.createdAt),
      asc(goalMonthTargetChanges.changeId),
      asc(goalMonthTargetChanges.monthlyResultId),
    )
  return rows.map(mapTargetChange)
}

/**
 * The Program's months that are open and running at the command's instant,
 * locked for the rest of the transaction. The instant is the injected clock,
 * as for the due-result reads; the guard checks the database's own.
 */
async function lockRunningMonths(tx: Tx, input: ChangeMonthTargetInput) {
  return tx
    .select({
      id: goalMonthlyResults.id,
      programVersionId: goalMonthlyResults.programVersionId,
      targetValue: goalMonthlyResults.targetValue,
    })
    .from(goalMonthlyResults)
    .where(
      and(
        eq(goalMonthlyResults.organizationId, input.organizationId),
        eq(goalMonthlyResults.propertyId, input.propertyId),
        eq(goalMonthlyResults.programId, input.programId),
        eq(goalMonthlyResults.status, 'open'),
        lte(goalMonthlyResults.periodStart, input.at),
        gt(goalMonthlyResults.periodEnd, input.at),
      ),
    )
    .orderBy(asc(goalMonthlyResults.id))
    .for('update')
}

/**
 * The locked months must be the ones the command read, with the targets it
 * read. A month it read that is not among them has left the open state: its
 * period is over. Anything else means the goal changed since the read.
 */
function assertMonthsAsRead(
  locked: Awaited<ReturnType<typeof lockRunningMonths>>,
  months: ChangeMonthTargetInput['months'],
): void {
  const storedById = new Map(locked.map((month) => [month.id, month.targetValue]))
  if (
    months.length === 0 ||
    months.some((month) => !storedById.has(month.monthlyResultId))
  ) {
    throw new GoalMonthTargetLocked()
  }
  if (
    locked.length !== months.length ||
    months.some(
      (month) => storedById.get(month.monthlyResultId) !== month.storedTargetValue,
    )
  ) {
    throw new GoalProgramRevisionConflict()
  }
}

/**
 * The one statement that changes a month's target. It changes nothing else, so
 * a refusal by the monthly-result guard here is unambiguous: 55000 is the lock
 * on the database clock, 23514 the measure's target rule.
 */
async function writeMonthTargets(tx: Tx, input: ChangeMonthTargetInput): Promise<void> {
  try {
    const updated = await tx
      .update(goalMonthlyResults)
      .set({ targetValue: input.storedTargetValue, updatedAt: input.at })
      .where(
        and(
          eq(goalMonthlyResults.organizationId, input.organizationId),
          eq(goalMonthlyResults.propertyId, input.propertyId),
          eq(goalMonthlyResults.programId, input.programId),
          inArray(
            goalMonthlyResults.id,
            input.months.map((month) => month.monthlyResultId),
          ),
        ),
      )
      .returning({ id: goalMonthlyResults.id })
    if (updated.length !== input.months.length) throw new GoalProgramRevisionConflict()
  } catch (error) {
    if (hasPostgresErrorCode(error, '55000') || hasPostgresErrorCode(error, '23514')) {
      throw new GoalMonthTargetLocked()
    }
    throw error
  }
}

export const createGoalMonthTargetRepository = (
  db: Database,
  reviseInTx: ReviseInTx,
): Pick<GoalProgramRepository, 'changeMonthTarget'> => ({
  async changeMonthTarget(input) {
    try {
      return await db.transaction(async (tx) => {
        // The Program row first, as activation, appending months and revising
        // do: it serializes this change with every writer of versions, and it
        // is the compare-and-set on the head. Then versions, then months.
        const [program] = await tx
          .update(goalPrograms)
          .set({ updatedAt: input.at })
          .where(
            and(
              eq(goalPrograms.organizationId, input.organizationId),
              eq(goalPrograms.propertyId, input.propertyId),
              eq(goalPrograms.id, input.programId),
              eq(goalPrograms.currentVersion, input.expectedVersion.version),
              ne(goalPrograms.status, 'ended'),
            ),
          )
          .returning({ id: goalPrograms.id })
        if (!program) throw new GoalProgramRevisionConflict()

        const { outcome, reason, revision } = input.following
        if (revision) {
          const revised = await reviseInTx(tx, {
            ...revision,
            expectedVersion: input.expectedVersion,
            actorId: input.actorId,
            at: input.at,
          })
          if (!revised) throw new GoalProgramRevisionConflict()
        }

        const locked = await lockRunningMonths(tx, input)
        assertMonthsAsRead(locked, input.months)
        await writeMonthTargets(tx, input)
        await tx.insert(goalMonthTargetChanges).values(
          input.months.map((month) => ({
            id: month.changeRowId,
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            programId: input.programId,
            monthlyResultId: month.monthlyResultId,
            changeId: input.changeId,
            previousTargetValue: month.previousTargetValue,
            newTargetValue: input.targetValue,
            followingOutcome: outcome,
            followingReason: reason,
            followingVersionId: revision?.version.id ?? null,
            note: input.note,
            createdBy: input.actorId,
            createdAt: input.at,
          })),
        )
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          userId: input.actorId,
          action: 'goal.month_target.changed',
          resourceType: 'goal_program',
          resourceId: input.programId,
          details: {
            propertyId: input.propertyId,
            changeId: input.changeId,
            // The version the months belong to, which a change waiting for its
            // month makes different from the head.
            programVersionId: locked[0]?.programVersionId,
            monthCount: input.months.length,
            previousTargetValue: input.months[0]?.previousTargetValue,
            targetValue: input.targetValue,
            followingOutcome: outcome,
            // The note stays in the log of the change; it is not copied here.
            ...(reason === null ? {} : { followingReason: reason }),
            ...(revision ? { followingVersionId: revision.version.id } : {}),
          },
        })
        return 'changed' as const
      })
    } catch (error) {
      // Every refusal is thrown, so the transaction wrote nothing.
      if (error instanceof GoalMonthTargetLocked) return 'month_locked'
      if (
        error instanceof GoalProgramRevisionConflict ||
        hasPostgresErrorCode(error, '23P01')
      ) {
        return 'revision_conflict'
      }
      throw error
    }
  },
})
