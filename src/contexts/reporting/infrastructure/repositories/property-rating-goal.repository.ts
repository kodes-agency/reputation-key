// Reporting — PostgreSQL persistence of the Property Google rating goal.
//
// Every statement is bound to the Organization and the Property. The partial
// unique index `property_rating_goals_one_active_idx` is what holds "one
// active goal per Property" when two managers set one at once: the loser's
// insert does nothing and is told `active_exists`. A manager's change or end
// is a compare-and-set on the version; an evaluation never moves the version
// and writes only when it changes the row.

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  propertyRatingGoalChanges,
  propertyRatingGoals,
} from '#/shared/db/schema/goal.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { trace } from '#/shared/observability/trace'
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

/** One change writes its rows at one instant: mode, then target, then pace. */
const changeFieldOrder = sql`CASE ${propertyRatingGoalChanges.field}
  WHEN 'mode' THEN 0 WHEN 'target' THEN 1 ELSE 2 END`

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
        OR (${write.displayedTenths}::smallint IS NOT NULL
          AND ${propertyRatingGoals.lastDisplayedTenths} IS DISTINCT FROM ${write.displayedTenths}::smallint))`

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
          pacePerWeek: goal.pacePerWeek,
          status: 'active',
          baselineReviewCount: goal.baseline.reviewCount,
          baselineGoogleAverage: goal.baseline.googleAverage,
          baselineExactAverage: goal.baseline.exactAverage,
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
            pacePerWeek: change.plan.pacePerWeek,
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
    trace('reporting.ratingGoal.recordEvaluation', async () => {
      const updated = await db
        .update(propertyRatingGoals)
        .set(evaluationSet(write))
        .where(
          and(
            goalScope(write.organizationId, write.propertyId),
            eq(propertyRatingGoals.id, write.goalId),
            eq(propertyRatingGoals.status, 'active'),
            evaluationChanges(write),
          ),
        )
        .returning({ id: propertyRatingGoals.id })
      return updated.length > 0
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
