// Reporting — PostgreSQL persistence of the Property Google rating goal.
//
// Every statement is bound to the Organization and the Property. The partial
// unique index `property_rating_goals_one_active_idx` is what holds "one
// active goal per Property" when two managers set one at once: the loser's
// insert does nothing and is told `active_exists`. A manager's change or end
// is a compare-and-set on the version; a change also forgets the known status,
// so a status the new plan puts the goal in is stored without a notice. An
// evaluation never moves the version and writes only when it changes the row,
// and only onto the plan version it was worked out on, never over a newer
// evaluation, and only onto the tenth, known status and below-pace notice it
// read: a reached step decided on a target the manager has since raised (or a
// quality or pace they changed: all of the plan moves the version), an
// older reading landing after a newer one, or a second evaluation of a change
// another one already stored, changes nothing and tells nobody. The notices an
// evaluation raises are written as outbox facts in its own transaction.

import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  propertyRatingGoalChanges,
  propertyRatingGoalDeferrals,
  propertyRatingGoals,
} from '#/shared/db/schema/goal.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { trace } from '#/shared/observability/trace'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { goalRatingGoalTransitioned } from '../../domain/goal-events'
import type {
  PropertyRatingGoal,
  RatingGoalChange,
  RatingGoalChangeField,
  RatingGoalEndedReason,
  RatingGoalMode,
  RatingGoalState,
  RatingGoalStatus,
} from '../../domain/rating-goal'
import type {
  PropertyRatingGoalRepository,
  RatingGoalEvaluationWrite,
  RatingGoalPropertyFactsReader,
  RatingGoalWriteResult,
} from '../../application/ports/property-rating-goal.repository'
import { isOrganizationHeldByLifecycle } from './goal-organization-lifecycle-hold'

type GoalRow = typeof propertyRatingGoals.$inferSelect
type ChangeRow = typeof propertyRatingGoalChanges.$inferSelect
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

const goalFromRow = (row: GoalRow): PropertyRatingGoal => ({
  id: row.id,
  organizationId: row.organizationId,
  propertyId: row.propertyId,
  sourceEpoch: row.sourceEpoch,
  mode: row.mode as RatingGoalMode,
  targetTenths: row.targetTenths,
  qualityTenths: row.qualityTenths,
  pacePerWeek: row.pacePerWeek,
  state: row.status as RatingGoalState,
  endedReason: row.endedReason as RatingGoalEndedReason | null,
  baseline: {
    reviewCount: row.baselineReviewCount,
    googleAverage: row.baselineGoogleAverage,
    exactAverage: row.baselineExactAverage,
  },
  lastEvaluation: {
    displayedTenths: row.lastDisplayedTenths,
    status: row.lastEvaluatedStatus as RatingGoalStatus | null,
    evaluatedAt: row.lastEvaluatedAt,
    knownStatus: row.lastKnownStatus as RatingGoalStatus | null,
    belowPaceNoticedAt: row.belowPaceNoticedAt,
    tooLowNoticedAt: row.tooLowNoticedAt,
  },
  reachedAt: row.reachedAt,
  endedAt: row.endedAt,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  version: row.version,
})

const changeFromRow = (row: ChangeRow): RatingGoalChange => ({
  id: row.id,
  goalId: row.goalId,
  organizationId: row.organizationId,
  propertyId: row.propertyId,
  changedBy: row.changedBy,
  changedAt: row.changedAt,
  field: row.field as RatingGoalChangeField,
  oldValue: row.oldValue,
  newValue: row.newValue,
})

/** One change writes its rows at one instant: mode, target, quality, then pace. */
const changeFieldOrder = sql`CASE ${propertyRatingGoalChanges.field}
  WHEN 'mode' THEN 0 WHEN 'target' THEN 1 WHEN 'quality' THEN 2 ELSE 3 END`

const goalScope = (organizationId: string, propertyId: string) =>
  and(
    eq(propertyRatingGoals.organizationId, organizationId),
    eq(propertyRatingGoals.propertyId, propertyId),
  )

/** Why a compare-and-set on an active goal's version changed nothing. */
async function refusalFor(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  goalId: string,
): Promise<Exclude<RatingGoalWriteResult, 'written'>> {
  const [row] = await tx
    .select({ status: propertyRatingGoals.status })
    .from(propertyRatingGoals)
    .where(and(goalScope(organizationId, propertyId), eq(propertyRatingGoals.id, goalId)))
    .limit(1)
  return row?.status === 'active' ? 'version_conflict' : 'not_active'
}

/** The SET of an evaluation, terminal step included. */
function evaluationSet(write: RatingGoalEvaluationWrite) {
  const stored = {
    lastDisplayedTenths: sql`COALESCE(${write.displayedTenths}::smallint, ${propertyRatingGoals.lastDisplayedTenths})`,
    lastEvaluatedStatus: write.status,
    lastEvaluatedAt: write.evaluatedAt,
    lastKnownStatus: write.knownStatus,
    belowPaceNoticedAt: write.belowPaceNoticedAt,
    tooLowNoticedAt: write.tooLowNoticedAt,
    updatedAt: write.evaluatedAt,
  }
  switch (write.outcome.kind) {
    case 'continues':
      return stored
    case 'reached':
      return { ...stored, status: 'reached', reachedAt: write.evaluatedAt }
    case 'ended':
      return {
        ...stored,
        status: 'ended',
        endedReason: write.outcome.reason,
        endedAt: write.evaluatedAt,
      }
  }
}

/** True when the evaluation would change the stored row. */
const evaluationChanges = (write: RatingGoalEvaluationWrite) =>
  write.outcome.kind !== 'continues'
    ? sql`true`
    : sql`(${propertyRatingGoals.lastEvaluatedStatus} IS DISTINCT FROM ${write.status}
        OR ${propertyRatingGoals.lastKnownStatus} IS DISTINCT FROM ${write.knownStatus}::varchar
        OR (${write.displayedTenths}::smallint IS NOT NULL
          AND ${propertyRatingGoals.lastDisplayedTenths} IS DISTINCT FROM ${write.displayedTenths}::smallint))`

/**
 * The stored tenth, known status and notice times are still the ones the
 * evaluation read, so its notices are this change's, told once.
 */
const markUnchangedSince = ({ expectedMark }: RatingGoalEvaluationWrite) =>
  sql`(${propertyRatingGoals.lastDisplayedTenths} IS NOT DISTINCT FROM ${expectedMark.displayedTenths}::smallint
    AND ${propertyRatingGoals.lastKnownStatus} IS NOT DISTINCT FROM ${expectedMark.knownStatus}::varchar
    AND ${propertyRatingGoals.belowPaceNoticedAt} IS NOT DISTINCT FROM ${expectedMark.belowPaceNoticedAt}::timestamptz
    AND ${propertyRatingGoals.tooLowNoticedAt} IS NOT DISTINCT FROM ${expectedMark.tooLowNoticedAt}::timestamptz)`

/** One `goal.rating_goal.transitioned` fact per notice, in the write's transaction. */
async function insertNoticeFacts(
  tx: Tx,
  write: RatingGoalEvaluationWrite,
  mode: RatingGoalMode,
): Promise<void> {
  for (const notice of write.notices) {
    await insertOutboxRow(
      tx,
      goalRatingGoalTransitioned({
        organizationId: write.organizationId,
        propertyId: write.propertyId,
        goalId: write.goalId,
        mode,
        notice,
        occurredAt: write.evaluatedAt,
      }),
      { recordedAt: write.evaluatedAt },
    )
  }
}

export const createPropertyRatingGoalRepository = (
  db: Database,
): PropertyRatingGoalRepository => ({
  isOrganizationHeld: (organizationId) =>
    isOrganizationHeldByLifecycle(db, organizationId),

  findActive: async (organizationId, propertyId) => {
    const [row] = await db
      .select()
      .from(propertyRatingGoals)
      .where(
        and(
          goalScope(organizationId, propertyId),
          eq(propertyRatingGoals.status, 'active'),
        ),
      )
      .limit(1)
    return row ? goalFromRow(row) : null
  },

  findById: async (organizationId, propertyId, goalId) => {
    const [row] = await db
      .select()
      .from(propertyRatingGoals)
      .where(
        and(goalScope(organizationId, propertyId), eq(propertyRatingGoals.id, goalId)),
      )
      .limit(1)
    return row ? goalFromRow(row) : null
  },

  listHistory: async (organizationId, propertyId, limit) => {
    const rows = await db
      .select()
      .from(propertyRatingGoals)
      .where(
        and(
          goalScope(organizationId, propertyId),
          inArray(propertyRatingGoals.status, ['reached', 'ended']),
        ),
      )
      .orderBy(
        desc(
          sql`COALESCE(${propertyRatingGoals.reachedAt}, ${propertyRatingGoals.endedAt})`,
        ),
        desc(propertyRatingGoals.id),
      )
      .limit(limit)
    return rows.map(goalFromRow)
  },

  listChanges: async (organizationId, propertyId, goalId, limit) => {
    const rows = await db
      .select()
      .from(propertyRatingGoalChanges)
      .where(
        and(
          eq(propertyRatingGoalChanges.organizationId, organizationId),
          eq(propertyRatingGoalChanges.propertyId, propertyId),
          eq(propertyRatingGoalChanges.goalId, goalId),
        ),
      )
      .orderBy(desc(propertyRatingGoalChanges.changedAt), changeFieldOrder)
      .limit(limit)
    return rows.map(changeFromRow)
  },

  insert: (goal) =>
    trace('reporting.ratingGoal.insert', async () => {
      const inserted = await db
        .insert(propertyRatingGoals)
        .values({
          id: goal.id,
          organizationId: goal.organizationId,
          propertyId: goal.propertyId,
          sourceEpoch: goal.sourceEpoch,
          mode: goal.mode,
          targetTenths: goal.targetTenths,
          qualityTenths: goal.qualityTenths,
          pacePerWeek: goal.pacePerWeek,
          status: 'active',
          baselineReviewCount: goal.baseline.reviewCount,
          baselineGoogleAverage: goal.baseline.googleAverage,
          baselineExactAverage: goal.baseline.exactAverage,
          lastDisplayedTenths: goal.lastEvaluation.displayedTenths,
          lastEvaluatedStatus: goal.lastEvaluation.status,
          lastEvaluatedAt: goal.lastEvaluation.evaluatedAt,
          lastKnownStatus: goal.lastEvaluation.knownStatus,
          belowPaceNoticedAt: goal.lastEvaluation.belowPaceNoticedAt,
          tooLowNoticedAt: goal.lastEvaluation.tooLowNoticedAt,
          createdBy: goal.createdBy,
          createdAt: goal.createdAt,
          updatedAt: goal.updatedAt,
        })
        // The only key a fresh id can collide on is the one-active index.
        .onConflictDoNothing()
        .returning({ id: propertyRatingGoals.id })
      return inserted.length === 0 ? 'active_exists' : 'inserted'
    }),

  changePlan: (change) =>
    trace('reporting.ratingGoal.changePlan', () =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(propertyRatingGoals)
          .set({
            mode: change.plan.mode,
            targetTenths: change.plan.targetTenths,
            qualityTenths: change.plan.qualityTenths,
            pacePerWeek: change.plan.pacePerWeek,
            // The status the new plan puts the goal in is the manager's own
            // doing: the next evaluation stores it without a notice.
            lastKnownStatus: null,
            version: sql`${propertyRatingGoals.version} + 1`,
            updatedAt: change.changedAt,
          })
          .where(
            and(
              goalScope(change.organizationId, change.propertyId),
              eq(propertyRatingGoals.id, change.goalId),
              eq(propertyRatingGoals.status, 'active'),
              eq(propertyRatingGoals.version, change.expectedVersion),
            ),
          )
          .returning({ id: propertyRatingGoals.id })
        if (updated.length === 0) {
          return refusalFor(tx, change.organizationId, change.propertyId, change.goalId)
        }
        if (change.changes.length > 0) {
          await tx.insert(propertyRatingGoalChanges).values([...change.changes])
        }
        return 'written' as const
      }),
    ),

  endByManager: (end) =>
    trace('reporting.ratingGoal.endByManager', () =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(propertyRatingGoals)
          .set({
            status: 'ended',
            endedReason: 'manager',
            endedAt: end.endedAt,
            version: sql`${propertyRatingGoals.version} + 1`,
            updatedAt: end.endedAt,
          })
          .where(
            and(
              goalScope(end.organizationId, end.propertyId),
              eq(propertyRatingGoals.id, end.goalId),
              eq(propertyRatingGoals.status, 'active'),
              eq(propertyRatingGoals.version, end.expectedVersion),
            ),
          )
          .returning({ id: propertyRatingGoals.id })
        if (updated.length === 0) {
          return refusalFor(tx, end.organizationId, end.propertyId, end.goalId)
        }
        return 'written' as const
      }),
    ),

  recordEvaluation: (write) =>
    trace('reporting.ratingGoal.recordEvaluation', () =>
      db.transaction(async (tx) => {
        const [updated] = await tx
          .update(propertyRatingGoals)
          .set(evaluationSet(write))
          .where(
            and(
              goalScope(write.organizationId, write.propertyId),
              eq(propertyRatingGoals.id, write.goalId),
              eq(propertyRatingGoals.status, 'active'),
              eq(propertyRatingGoals.version, write.expectedVersion),
              or(
                isNull(propertyRatingGoals.lastEvaluatedAt),
                lte(propertyRatingGoals.lastEvaluatedAt, write.evaluatedAt),
              ),
              markUnchangedSince(write),
              evaluationChanges(write),
            ),
          )
          .returning({ mode: propertyRatingGoals.mode })
        if (updated === undefined) return false
        await insertNoticeFacts(tx, write, updated.mode as RatingGoalMode)
        return true
      }),
    ),

  listActiveGoalScopes: async (after, limit) =>
    db
      .select({
        goalId: propertyRatingGoals.id,
        organizationId: propertyRatingGoals.organizationId,
        propertyId: propertyRatingGoals.propertyId,
      })
      .from(propertyRatingGoals)
      .where(
        and(
          eq(propertyRatingGoals.status, 'active'),
          after === null ? undefined : gt(propertyRatingGoals.id, after.goalId),
        ),
      )
      .orderBy(asc(propertyRatingGoals.id))
      .limit(limit),

  endForArchivedProperty: (archive) =>
    trace('reporting.ratingGoal.endForArchivedProperty', async () => {
      const ended = await db
        .update(propertyRatingGoals)
        .set({
          status: 'ended',
          endedReason: 'property_archived',
          endedAt: archive.endedAt,
          updatedAt: archive.endedAt,
        })
        .where(
          and(
            goalScope(archive.organizationId, archive.propertyId),
            eq(propertyRatingGoals.status, 'active'),
            lt(propertyRatingGoals.sourceEpoch, archive.archivedEpoch),
          ),
        )
        .returning({ id: propertyRatingGoals.id })
      return ended.length > 0
    }),

  // One row per Property: a repeat keeps the first choice. The tenant foreign
  // key refuses a Property that is not the Organization's.
  recordNotNow: (choice) =>
    trace('reporting.ratingGoal.recordNotNow', async () => {
      const recorded = await db
        .insert(propertyRatingGoalDeferrals)
        .values({
          propertyId: choice.propertyId,
          organizationId: choice.organizationId,
          deferredBy: choice.chosenBy,
          deferredAt: choice.chosenAt,
        })
        .onConflictDoNothing({ target: propertyRatingGoalDeferrals.propertyId })
        .returning({ propertyId: propertyRatingGoalDeferrals.propertyId })
      return recorded.length > 0
    }),
})

/** The Property facts a rating goal reads: zone, lifecycle, epoch, binding. */
export const createRatingGoalPropertyFactsReader = (
  db: Database,
): RatingGoalPropertyFactsReader => ({
  findPropertyFacts: async (organizationId, propertyId) => {
    const [row] = await db
      .select({
        timezone: properties.timezone,
        lifecycleState: properties.lifecycleState,
        sourceEpoch: properties.sourceEpoch,
        googleBindingState: properties.googleBindingState,
      })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, organizationId),
          eq(properties.id, propertyId),
          isNull(properties.deletedAt),
        ),
      )
      .limit(1)
    return row
      ? {
          timezone: row.timezone,
          lifecycleState: row.lifecycleState,
          sourceEpoch: row.sourceEpoch,
          googleBindingActive: row.googleBindingState === 'active',
        }
      : null
  },
})
