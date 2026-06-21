// Goal context — Drizzle goal repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Wrapped in trace() for observability.

import { and, eq, sql, or, desc, isNull, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { goals, goalProgress } from '#/shared/db/schema/goal.schema'
import type {
  GoalRepository,
  GoalListFilter,
} from '../../application/ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import type { GoalId } from '#/shared/domain/ids'
import {
  goalFromRow,
  goalProgressFromRow,
  goalToInsertRow,
  goalProgressToInsertRow,
} from '../mappers/goal.mapper'
import { trace } from '#/shared/observability/trace'
import { getLogger } from '#/shared/observability/logger'
import { goalError } from '../../domain/errors'

const log = getLogger().child({ component: 'goal-repo' })

/** Map goal rows to domain goals, skipping rows with invalid DB data
 *  instead of crashing the entire query. Logs a warning per skipped row. */
function safeMapGoals(rows: ReadonlyArray<typeof goals.$inferSelect>): Goal[] {
  return rows.flatMap((row) => {
    try {
      return [goalFromRow(row)]
    } catch (e) {
      log.warn({ err: e, goalId: row.id }, 'Skipping goal with invalid DB data')
      return []
    }
  })
}

export const createGoalRepository = (db: Database): GoalRepository => ({
  // ── Goal CRUD ──────────────────────────────────────────────────────────

  insert: async (goal) => {
    return trace('goal.insert', async () => {
      const start = Date.now()
      log.debug({ organizationId: goal.organizationId as string }, 'goal insert start')
      const row = goalToInsertRow(goal)
      const result = await db.insert(goals).values(row).returning()
      if (!result[0]) {
        throw goalError('repo_insert_failed', 'Goal insert failed — no row returned')
      }
      log.debug(
        { goalId: result[0].id, duration: Date.now() - start },
        'goal insert complete',
      )
      return goalFromRow(result[0])
    })
  },

  getById: async (id, orgId) => {
    return trace('goal.getById', async () => {
      const rows = await db
        .select()
        .from(goals)
        .where(and(eq(goals.id, id), eq(goals.organizationId, orgId)))
        .limit(1)
      return rows[0] ? goalFromRow(rows[0]) : null
    })
  },

  update: async (id, orgId, data) => {
    return trace('goal.update', async () => {
      const result = await db
        .update(goals)
        .set(data)
        .where(and(eq(goals.id, id), eq(goals.organizationId, orgId)))
        .returning()
      return result[0] ? goalFromRow(result[0]) : null
    })
  },

  list: async (filter: GoalListFilter) => {
    return trace('goal.list', async () => {
      const start = Date.now()
      log.debug({ organizationId: filter.organizationId as string }, 'goal list start')
      const conditions = [eq(goals.organizationId, filter.organizationId)]
      if (filter.propertyId)
        conditions.push(eq(goals.propertyId, filter.propertyId as string))
      if (filter.portalId) conditions.push(eq(goals.portalId, filter.portalId))
      if (filter.portalGroupId)
        conditions.push(eq(goals.portalGroupId, filter.portalGroupId))
      if (filter.status) conditions.push(eq(goals.status, filter.status))
      if (filter.goalType) conditions.push(eq(goals.goalType, filter.goalType))

      const rows = await db
        .select()
        .from(goals)
        .where(and(...conditions))
      log.debug(
        { count: rows.length, duration: Date.now() - start },
        'goal list complete',
      )
      return safeMapGoals(rows)
    })
  },

  listInstances: async (parentGoalId, orgId) => {
    return trace('goal.listInstances', async () => {
      const rows = await db
        .select()
        .from(goals)
        .where(and(eq(goals.parentGoalId, parentGoalId), eq(goals.organizationId, orgId)))
      return safeMapGoals(rows)
    })
  },

  cancelByParent: async (parentGoalId, orgId, now) => {
    return trace('goal.cancelByParent', async () => {
      const result = await db
        .update(goals)
        .set({ status: 'cancelled', updatedAt: now })
        .where(
          and(
            eq(goals.parentGoalId, parentGoalId),
            eq(goals.organizationId, orgId),
            sql`${goals.status} != 'completed'`,
          ),
        )
        .returning()
      return result.length
    })
  },

  // ── Goal Progress ──────────────────────────────────────────────────────

  insertProgress: async (progress) => {
    return trace('goal.insertProgress', async () => {
      const row = goalProgressToInsertRow(progress)
      const result = await db.insert(goalProgress).values(row).returning()
      if (!result[0]) {
        throw goalError(
          'repo_insert_failed',
          'Goal progress insert failed — no row returned',
        )
      }
      return goalProgressFromRow(result[0])
    })
  },

  getProgress: async (goalId, organizationId) => {
    return trace('goal.getProgress', async () => {
      const rows = await db
        .select()
        .from(goalProgress)
        .where(
          and(
            eq(goalProgress.goalId, goalId),
            eq(goalProgress.organizationId, organizationId),
          ),
        )
        .limit(1)
      return rows[0] ? goalProgressFromRow(rows[0]) : null
    })
  },

  // Batch: fetches progress for multiple goals in a single query
  getProgressBatch: async (goalIds, organizationId) => {
    return trace('goal.getProgressBatch', async () => {
      const map = new Map<GoalId, GoalProgress | null>()
      if (goalIds.length === 0) return map
      // Initialize all keys to null
      for (const id of goalIds) {
        map.set(id, null)
      }
      const rows = await db
        .select()
        .from(goalProgress)
        .where(
          and(
            inArray(goalProgress.goalId, [...goalIds] as string[]),
            eq(goalProgress.organizationId, organizationId),
          ),
        )
      for (const row of rows) {
        const progress = goalProgressFromRow(row)
        map.set(progress.goalId, progress)
      }
      return map
    })
  },

  updateProgress: async (goalId, organizationId, data) => {
    return trace('goal.updateProgress', async () => {
      const result = await db
        .update(goalProgress)
        .set(data)
        .where(
          and(
            eq(goalProgress.goalId, goalId),
            eq(goalProgress.organizationId, organizationId),
          ),
        )
        .returning()
      return result[0] ? goalProgressFromRow(result[0]) : null
    })
  },

  // ── Event-driven increment ──────────────────────────────────────────

  findAllActive: async (organizationId) => {
    return trace('goal.findAllActive', async () => {
      const rows = await db
        .select()
        .from(goals)
        .where(and(eq(goals.organizationId, organizationId), eq(goals.status, 'active')))
      return safeMapGoals(rows)
    })
  },
  // ⚠️ CROSS-TENANT by design — background job
  findAllActiveRecurring: async () => {
    return trace('goal.findAllActiveRecurring', async () => {
      const rows = await db
        .select()
        .from(goals)
        .where(
          and(
            eq(goals.status, 'active'),
            eq(goals.goalType, 'recurring'),
            isNull(goals.parentGoalId),
          ),
        )
      return safeMapGoals(rows)
    })
  },
  // ⚠️ CROSS-TENANT by design — background job
  findAllActiveGlobal: async () => {
    return trace('goal.findAllActiveGlobal', async () => {
      const rows = await db.select().from(goals).where(eq(goals.status, 'active'))
      return safeMapGoals(rows)
    })
  },

  findActiveRecurringTemplates: async (organizationId) => {
    return trace('goal.findActiveRecurringTemplates', async () => {
      const rows = await db
        .select()
        .from(goals)
        .where(
          and(
            eq(goals.organizationId, organizationId),
            eq(goals.status, 'active'),
            eq(goals.goalType, 'recurring'),
            isNull(goals.parentGoalId),
          ),
        )
      return safeMapGoals(rows)
    })
  },

  findLatestInstance: async (parentGoalId, orgId) => {
    return trace('goal.findLatestInstance', async () => {
      const rows = await db
        .select()
        .from(goals)
        .where(and(eq(goals.parentGoalId, parentGoalId), eq(goals.organizationId, orgId)))
        .orderBy(desc(goals.periodEnd))
        .limit(1)
      return rows[0] ? goalFromRow(rows[0]) : null
    })
  },

  createGoalAndProgress: async (goal, progress) => {
    return trace('goal.createGoalAndProgress', async () => {
      await db.transaction(async (tx) => {
        await tx.insert(goals).values({
          ...goalToInsertRow(goal),
          id: goal.id as string,
        })
        await tx.insert(goalProgress).values({
          ...goalProgressToInsertRow(progress),
          id: progress.id as string,
          organizationId: goal.organizationId as string,
        })
      })
    })
  },

  findActiveGoalsByMetric: async (
    metricKey,
    organizationId,
    propertyId,
    portalId,
    portalGroupId,
  ) => {
    return trace('goal.findActiveGoalsByMetric', async () => {
      const start = Date.now()
      log.debug(
        { metricKey, organizationId: organizationId as string },
        'goal findActiveGoalsByMetric start',
      )
      const conditions = [
        eq(goals.status, 'active'),
        eq(goals.metricKey, metricKey),
        eq(goals.organizationId, organizationId),
        eq(goals.propertyId, propertyId),
      ]

      // Build scope-matching conditions:
      // 1. Property-scoped goals (portalId IS NULL AND portalGroupId IS NULL) always match
      // 2. Portal-scoped goals match when event has matching portalId
      // 3. Portal-group-scoped goals match when event's portal belongs to the group
      const scopeConditions: ReturnType<typeof or>[] = [
        and(sql`${goals.portalId} IS NULL`, sql`${goals.portalGroupId} IS NULL`)!,
      ]

      if (portalId) {
        scopeConditions.push(eq(goals.portalId, portalId))
      }
      if (portalGroupId) {
        scopeConditions.push(eq(goals.portalGroupId, portalGroupId))
      }

      conditions.push(or(...scopeConditions)!)

      const rows = await db
        .select()
        .from(goals)
        .where(and(...conditions))
      log.debug(
        { metricKey, count: rows.length, duration: Date.now() - start },
        'goal findActiveGoalsByMetric complete',
      )
      return safeMapGoals(rows)
    })
  },

  incrementProgress: async (goalId, aggregation, delta) => {
    return trace('goal.incrementProgress', async () => {
      if (aggregation === 'sum' || aggregation === 'count') {
        const incDelta = aggregation === 'count' ? 1 : delta
        const result = await db
          .update(goalProgress)
          .set({
            currentValue: sql`${goalProgress.currentValue} + ${incDelta}`,
          })
          .where(eq(goalProgress.goalId, goalId))
          .returning({
            currentValue: goalProgress.currentValue,
            currentSum: goalProgress.currentSum,
            currentCount: goalProgress.currentCount,
          })
        if (!result[0]) {
          throw goalError(
            'progress_not_found',
            `incrementProgress: no progress row for goal ${goalId}`,
          )
        }
        return {
          currentValue: result[0].currentValue,
          currentSum: result[0].currentSum,
          currentCount: result[0].currentCount,
        }
      }

      if (aggregation === 'max') {
        const result = await db
          .update(goalProgress)
          .set({
            currentValue: sql`GREATEST(${goalProgress.currentValue}, ${delta})`,
          })
          .where(eq(goalProgress.goalId, goalId))
          .returning({
            currentValue: goalProgress.currentValue,
            currentSum: goalProgress.currentSum,
            currentCount: goalProgress.currentCount,
          })
        if (!result[0]) {
          throw goalError(
            'progress_not_found',
            `incrementProgress: no progress row for goal ${goalId}`,
          )
        }
        return {
          currentValue: result[0].currentValue,
          currentSum: result[0].currentSum,
          currentCount: result[0].currentCount,
        }
      }

      if (aggregation === 'avg') {
        const result = await db
          .update(goalProgress)
          .set({
            currentSum: sql`COALESCE(${goalProgress.currentSum}, 0) + ${delta}`,
            currentCount: sql`COALESCE(${goalProgress.currentCount}, 0) + 1`,
            currentValue: sql`(COALESCE(${goalProgress.currentSum}, 0) + ${delta}) / (COALESCE(${goalProgress.currentCount}, 0) + 1)`,
          })
          .where(eq(goalProgress.goalId, goalId))
          .returning({
            currentValue: goalProgress.currentValue,
            currentSum: goalProgress.currentSum,
            currentCount: goalProgress.currentCount,
          })
        if (!result[0]) {
          throw goalError(
            'progress_not_found',
            `incrementProgress: no progress row for goal ${goalId}`,
          )
        }
        return {
          currentValue: result[0].currentValue,
          currentSum: result[0].currentSum,
          currentCount: result[0].currentCount,
        }
      }

      throw goalError(
        'unsupported_aggregation',
        `incrementProgress: unsupported aggregation ${aggregation}`,
      )
    })
  },

  upsertProgress: async (goalId, organizationId, aggregation, delta) => {
    return trace('goal.upsertProgress', async () => {
      // Verify the goal belongs to this organization before upserting
      const [row] = await db
        .select({ organizationId: goals.organizationId })
        .from(goals)
        .where(eq(goals.id, goalId))
        .limit(1)

      if (!row || row.organizationId !== organizationId) {
        throw goalError(
          'not_found_or_tenant_mismatch',
          `upsertProgress: goal ${goalId} not found or tenant mismatch`,
        )
      }

      if (aggregation === 'sum' || aggregation === 'count') {
        const incDelta = aggregation === 'count' ? 1 : delta
        const result = await db
          .insert(goalProgress)
          .values({
            goalId,
            organizationId,
            currentValue: incDelta,
            currentSum: null,
            currentCount: null,
            lastComputedAt: new Date(),
            computedSource: 'event_increment',
          })
          .onConflictDoUpdate({
            target: goalProgress.goalId,
            set: {
              currentValue: sql`${goalProgress.currentValue} + ${incDelta}`,
            },
          })
          .returning({
            currentValue: goalProgress.currentValue,
            currentSum: goalProgress.currentSum,
            currentCount: goalProgress.currentCount,
          })
        if (!result[0]) {
          throw goalError('upsert_failed', `upsertProgress: failed for goal ${goalId}`)
        }
        return {
          currentValue: result[0].currentValue,
          currentSum: result[0].currentSum,
          currentCount: result[0].currentCount,
        }
      }

      if (aggregation === 'max') {
        const result = await db
          .insert(goalProgress)
          .values({
            goalId,
            organizationId,
            currentValue: delta,
            currentSum: null,
            currentCount: null,
            lastComputedAt: new Date(),
            computedSource: 'event_increment',
          })
          .onConflictDoUpdate({
            target: goalProgress.goalId,
            set: {
              currentValue: sql`GREATEST(${goalProgress.currentValue}, ${delta})`,
            },
          })
          .returning({
            currentValue: goalProgress.currentValue,
            currentSum: goalProgress.currentSum,
            currentCount: goalProgress.currentCount,
          })
        if (!result[0]) {
          throw goalError('upsert_failed', `upsertProgress: failed for goal ${goalId}`)
        }
        return {
          currentValue: result[0].currentValue,
          currentSum: result[0].currentSum,
          currentCount: result[0].currentCount,
        }
      }

      if (aggregation === 'avg') {
        const result = await db
          .insert(goalProgress)
          .values({
            goalId,
            organizationId,
            currentValue: delta,
            currentSum: delta,
            currentCount: 1,
            lastComputedAt: new Date(),
            computedSource: 'event_increment',
          })
          .onConflictDoUpdate({
            target: goalProgress.goalId,
            set: {
              currentSum: sql`COALESCE(${goalProgress.currentSum}, 0) + ${delta}`,
              currentCount: sql`COALESCE(${goalProgress.currentCount}, 0) + 1`,
              currentValue: sql`(COALESCE(${goalProgress.currentSum}, 0) + ${delta}) / (COALESCE(${goalProgress.currentCount}, 0) + 1)`,
            },
          })
          .returning({
            currentValue: goalProgress.currentValue,
            currentSum: goalProgress.currentSum,
            currentCount: goalProgress.currentCount,
          })
        if (!result[0]) {
          throw goalError('upsert_failed', `upsertProgress: failed for goal ${goalId}`)
        }
        return {
          currentValue: result[0].currentValue,
          currentSum: result[0].currentSum,
          currentCount: result[0].currentCount,
        }
      }

      throw goalError(
        'unsupported_aggregation',
        `upsertProgress: unsupported aggregation ${aggregation}`,
      )
    })
  },

  markGoalCompleted: async (goalId, orgId, completedAt) => {
    return trace('goal.markGoalCompleted', async () => {
      await db
        .update(goals)
        .set({ status: 'completed', completedAt, updatedAt: completedAt })
        .where(and(eq(goals.id, goalId), eq(goals.organizationId, orgId)))
    })
  },

  // ── Batch lookups (N+1 elimination) ──────────────────────────────────

  listInstancesBatch: async (parentGoalIds, orgId) => {
    return trace('goal.listInstancesBatch', async () => {
      const map = new Map<GoalId, Goal[]>()
      if (parentGoalIds.length === 0) return map
      // Initialize all keys to empty array
      for (const id of parentGoalIds) {
        map.set(id, [])
      }
      const rows = await db
        .select()
        .from(goals)
        .where(
          and(
            inArray(goals.parentGoalId, [...parentGoalIds] as string[]),
            eq(goals.organizationId, orgId),
          ),
        )
      for (const row of rows) {
        const goal = goalFromRow(row)
        const parentId = goal.parentGoalId!
        const existing = map.get(parentId) ?? []
        existing.push(goal)
        map.set(parentId, existing)
      }
      return map
    })
  },
})
