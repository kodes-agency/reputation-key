// Goal context — Drizzle goal repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Wrapped in trace() for observability.

import { and, eq, sql, or, desc, isNull, inArray, type SQL } from 'drizzle-orm'
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

const log = getLogger().child({ component: 'goal-repo' })

export const createGoalRepository = (db: Database): GoalRepository => ({
  // ── Goal CRUD ──────────────────────────────────────────────────────────

  insert: async (goal) => {
    return trace('goal.insert', async () => {
      const start = Date.now()
      log.debug({ organizationId: goal.organizationId as string }, 'goal insert start')
      const row = goalToInsertRow(goal)
      const result = await db.insert(goals).values(row).returning()
      if (!result[0]) {
        throw new Error('Goal insert failed — no row returned')
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
      if (filter.groupId) conditions.push(eq(goals.groupId, filter.groupId))
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
      return rows.map(goalFromRow)
    })
  },

  listInstances: async (parentGoalId, orgId) => {
    return trace('goal.listInstances', async () => {
      const rows = await db
        .select()
        .from(goals)
        .where(and(eq(goals.parentGoalId, parentGoalId), eq(goals.organizationId, orgId)))
      return rows.map(goalFromRow)
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
        throw new Error('Goal progress insert failed — no row returned')
      }
      return goalProgressFromRow(result[0])
    })
  },

  // Safe: goalId is a globally unique UUID — no cross-tenant risk
  getProgress: async (goalId) => {
    return trace('goal.getProgress', async () => {
      const rows = await db
        .select()
        .from(goalProgress)
        .where(eq(goalProgress.goalId, goalId))
        .limit(1)
      return rows[0] ? goalProgressFromRow(rows[0]) : null
    })
  },

  // Batch: fetches progress for multiple goals in a single query
  getProgressBatch: async (goalIds) => {
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
        .where(inArray(goalProgress.goalId, [...goalIds] as string[]))
      for (const row of rows) {
        const progress = goalProgressFromRow(row)
        map.set(progress.goalId, progress)
      }
      return map
    })
  },

  // Safe: goalId is a globally unique UUID — no cross-tenant risk
  updateProgress: async (goalId, data) => {
    return trace('goal.updateProgress', async () => {
      const result = await db
        .update(goalProgress)
        .set(data)
        .where(eq(goalProgress.goalId, goalId))
        .returning()
      return result[0] ? goalProgressFromRow(result[0]) : null
    })
  },

  // ── Event-driven increment ──────────────────────────────────────────

  findAllActive: async () => {
    return trace('goal.findAllActive', async () => {
      const rows = await db.select().from(goals).where(eq(goals.status, 'active'))
      return rows.map(goalFromRow)
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
      return rows.map(goalFromRow)
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
        })
      })
    })
  },

  findActiveGoalsByMetric: async (
    metricKey,
    organizationId,
    propertyId,
    portalId,
    groupId,
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

      // Match logic:
      // - portal-scoped goals: match on portalId exactly
      // - group-scoped goals: match on groupId exactly
      // - property-scoped goals: both portalId and groupId IS NULL
      // A reading with portalId=null,groupId=null matches only property-scoped goals.
      // A reading with portalId matches portal-scoped + property-scoped goals.
      // A reading with groupId matches group-scoped + property-scoped goals.
      if (portalId) {
        conditions.push(or(eq(goals.portalId, portalId), sql`${goals.portalId} IS NULL`)!)
      } else {
        conditions.push(sql`${goals.portalId} IS NULL`)
      }
      if (groupId) {
        conditions.push(or(eq(goals.groupId, groupId), sql`${goals.groupId} IS NULL`)!)
      } else {
        conditions.push(sql`${goals.groupId} IS NULL`)
      }

      const rows = await db
        .select()
        .from(goals)
        .where(and(...conditions))
      log.debug(
        { metricKey, count: rows.length, duration: Date.now() - start },
        'goal findActiveGoalsByMetric complete',
      )
      return rows.map(goalFromRow)
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
          throw new Error(`incrementProgress: no progress row for goal ${goalId}`)
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
          throw new Error(`incrementProgress: no progress row for goal ${goalId}`)
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
          throw new Error(`incrementProgress: no progress row for goal ${goalId}`)
        }
        return {
          currentValue: result[0].currentValue,
          currentSum: result[0].currentSum,
          currentCount: result[0].currentCount,
        }
      }

      throw new Error(`incrementProgress: unsupported aggregation ${aggregation}`)
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
        throw new Error(`upsertProgress: goal ${goalId} not found or tenant mismatch`)
      }

      if (aggregation === 'sum' || aggregation === 'count') {
        const incDelta = aggregation === 'count' ? 1 : delta
        const result = await db
          .insert(goalProgress)
          .values({
            goalId,
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
          throw new Error(`upsertProgress: failed for goal ${goalId}`)
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
          throw new Error(`upsertProgress: failed for goal ${goalId}`)
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
          throw new Error(`upsertProgress: failed for goal ${goalId}`)
        }
        return {
          currentValue: result[0].currentValue,
          currentSum: result[0].currentSum,
          currentCount: result[0].currentCount,
        }
      }

      throw new Error(`upsertProgress: unsupported aggregation ${aggregation}`)
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

  // ── Staff goal resolution ────────────────────────────────────────────

  listByPortalAndGroupIds: async (input) => {
    return trace('goal.listByPortalAndGroupIds', async () => {
      const { organizationId, portalIds, groupIds } = input
      if (portalIds.length === 0 && groupIds.length === 0) return []

      const conditions = [eq(goals.organizationId, organizationId)]

      const portalOrGroup: SQL[] = []
      if (portalIds.length > 0)
        portalOrGroup.push(inArray(goals.portalId, [...portalIds] as string[]))
      if (groupIds.length > 0)
        portalOrGroup.push(inArray(goals.groupId, [...groupIds] as string[]))

      if (portalOrGroup.length === 1) {
        conditions.push(portalOrGroup[0])
      } else if (portalOrGroup.length > 1) {
        conditions.push(or(...portalOrGroup)!)
      }

      const rows = await db
        .select()
        .from(goals)
        .where(and(...conditions))
      return rows.map(goalFromRow)
    })
  },

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
