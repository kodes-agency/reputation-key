import { and, eq, desc, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { activityLog } from '#/shared/db/schema/activity.schema'
import type { OrganizationId } from '#/shared/domain/ids'
import type {
  ActivityRepository,
  FindDuplicateInput,
} from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'

const VALID_ROLES = new Set<string>(['Staff', 'PropertyManager', 'AccountAdmin'])

const activityFromRow = (row: typeof activityLog.$inferSelect): ActivityLog => ({
  id: row.id,
  actorId: row.actorId,
  actorName: row.actorName,
  actorAvatarUrl: row.actorAvatarUrl,
  actorRole: (VALID_ROLES.has(row.actorRole) ? row.actorRole : 'Staff') as Role,
  action: row.action as ActivityLog['action'],
  resourceType: row.resourceType as ActivityLog['resourceType'],
  resourceId: row.resourceId,
  propertyId: row.propertyId,
  organizationId: row.organizationId,
  payload: row.payload as ActivityLog['payload'],
  source: row.source as ActivityLog['source'],
  createdAt: row.createdAt,
})

export const createActivityRepository = (db: Database): ActivityRepository => ({
  insert: async (entry) => {
    await db.insert(activityLog).values(entry as typeof activityLog.$inferInsert)
  },

  findDuplicate: async (input: FindDuplicateInput) => {
    const rows = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.resourceType, input.resourceType),
          eq(activityLog.resourceId, input.resourceId),
          eq(activityLog.action, input.action),
          eq(activityLog.organizationId, input.organizationId),
          sql`${activityLog.payload} = ${JSON.stringify(input.payload)}::jsonb`,
        ),
      )
      .limit(1)
    return rows.length > 0
  },

  findByResource: async (orgId: OrganizationId, resourceType, resourceId, limit) => {
    const rows = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.organizationId, orgId),
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
