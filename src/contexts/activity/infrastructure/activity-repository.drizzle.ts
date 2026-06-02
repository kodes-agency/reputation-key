import { and, eq, desc } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { activityLog } from '#/shared/db/schema/activity.schema'
import type { ActivityRepository } from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'

const activityFromRow = (row: typeof activityLog.$inferSelect): ActivityLog =>
  row as unknown as ActivityLog

export const createActivityRepository = (db: Database): ActivityRepository => ({
  insert: async (entry) => {
    await db.insert(activityLog).values(entry as typeof activityLog.$inferInsert)
  },

  findDuplicate: async (mapped) => {
    const rows = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.resourceType, mapped.resourceType),
          eq(activityLog.resourceId, mapped.resourceId),
          eq(activityLog.action, mapped.action),
          eq(activityLog.organizationId, mapped.organizationId),
        ),
      )
      .limit(1)
    return rows.length > 0
  },

  findByResource: async (resourceType, resourceId, limit) => {
    const rows = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.resourceType, resourceType),
          eq(activityLog.resourceId, resourceId),
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
    return rows.map(activityFromRow)
  },

  findByOrganization: async (orgId, filter, pagination) => {
    const conditions = [eq(activityLog.organizationId, orgId)]

    if (filter.resourceType) {
      conditions.push(eq(activityLog.resourceType, filter.resourceType))
    }
    if (filter.resourceId) {
      conditions.push(eq(activityLog.resourceId, filter.resourceId))
    }
    if (filter.propertyId) {
      conditions.push(eq(activityLog.propertyId, filter.propertyId))
    }

    const rows = await db
      .select()
      .from(activityLog)
      .where(and(...conditions))
      .orderBy(desc(activityLog.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
    return rows.map(activityFromRow)
  },
})
