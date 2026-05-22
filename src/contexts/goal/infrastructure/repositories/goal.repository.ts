// Goal context — Drizzle goal repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Wrapped in trace() for observability.

import { and, eq, sql } from 'drizzle-orm'
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

export const createGoalRepository = (db: Database): GoalRepository => ({
  // ── Goal CRUD ──────────────────────────────────────────────────────────

  insert: async (goal) => {
    return trace('goal.insert', async () => {
      const row = goalToInsertRow(goal)
      const result = await db.insert(goals).values(row).returning()
      if (!result[0]) {
        throw new Error('Goal insert failed — no row returned')
      }
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
      const conditions = [
        eq(goals.organizationId, filter.organizationId),
        eq(goals.propertyId, filter.propertyId),
      ]
      if (filter.portalId) conditions.push(eq(goals.portalId, filter.portalId))
      if (filter.teamId) conditions.push(eq(goals.teamId, filter.teamId))
      if (filter.staffId) conditions.push(eq(goals.staffId, filter.staffId))
      if (filter.status) conditions.push(eq(goals.status, filter.status))
      if (filter.goalType) conditions.push(eq(goals.goalType, filter.goalType))

      const rows = await db
        .select()
        .from(goals)
        .where(and(...conditions))
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
})
