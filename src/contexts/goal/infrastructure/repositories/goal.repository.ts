// Goal context — Drizzle goal repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Wrapped in trace() for observability.

import { and, eq, sql, or, desc, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { goals, goalProgress } from '#/shared/db/schema/goal.schema'
import type {
  GoalRepository,
  GoalListFilter,
} from '../../application/ports/goal.repository'
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
      if (filter.teamId) conditions.push(eq(goals.teamId, filter.teamId))
      if (filter.staffId) conditions.push(eq(goals.staffId, filter.staffId))
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

  findLatestInstance: async (parentGoalId) => {
    return trace('goal.findLatestInstance', async () => {
      const rows = await db
        .select()
        .from(goals)
        .where(eq(goals.parentGoalId, parentGoalId))
        .orderBy(desc(goals.periodEnd))
        .limit(1)
      return rows[0] ? goalFromRow(rows[0]) : null
    })
  },

  createGoalAndProgress: async (goal, progress) => {
    return trace('goal.createGoalAndProgress', async () => {
      await db.insert(goals).values({
        ...goalToInsertRow(goal),
        id: goal.id as string,
      })
      await db.insert(goalProgress).values({
        ...goalProgressToInsertRow(progress),
        id: progress.id as string,
      })
    })
  },

  findActiveGoalsByMetric: async (metricKey, organizationId, propertyId, portalId) => {
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

      // When event has a portalId, match both portal-scoped goals (exact match)
      // and property-scoped goals (portalId IS NULL).
      // When event has no portalId, only match property-scoped goals.
      if (portalId) {
        conditions.push(or(eq(goals.portalId, portalId), sql`${goals.portalId} IS NULL`)!)
      } else {
        conditions.push(sql`${goals.portalId} IS NULL`)
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
        // Increment sum and count, then recompute currentValue
        const result = await db
          .update(goalProgress)
          .set({
            currentSum: sql`${goalProgress.currentSum} + ${delta}`,
            currentCount: sql`${goalProgress.currentCount} + 1`,
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

        const newSum = result[0].currentSum!
        const newCount = result[0].currentCount!
        const newAvg = newCount > 0 ? newSum / newCount : 0

        // Update currentValue with recomputed average
        await db
          .update(goalProgress)
          .set({ currentValue: newAvg })
          .where(eq(goalProgress.goalId, goalId))

        return {
          currentValue: newAvg,
          currentSum: newSum,
          currentCount: newCount,
        }
      }

      throw new Error(`incrementProgress: unsupported aggregation ${aggregation}`)
    })
  },

  markGoalCompleted: async (goalId, completedAt) => {
    return trace('goal.markGoalCompleted', async () => {
      await db
        .update(goals)
        .set({ status: 'completed', completedAt, updatedAt: completedAt })
        .where(eq(goals.id, goalId))
    })
  },
})
