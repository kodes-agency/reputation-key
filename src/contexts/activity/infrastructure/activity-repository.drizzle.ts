import { and, eq, desc, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { activityLog } from '#/shared/db/schema/activity.schema'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  activityLogId,
  userId as toUserId,
  propertyId as toPropertyId,
  organizationId as toOrgId,
} from '#/shared/domain/ids'
import type {
  ActivityRepository,
  FindDuplicateInput,
} from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'

const VALID_ROLES = new Set<string>(['Staff', 'PropertyManager', 'AccountAdmin'])

/** Deterministic JSON.stringify — sorts object keys at every level. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') +
    '}'
  )
}

const activityFromRow = (row: typeof activityLog.$inferSelect): ActivityLog => ({
  id: activityLogId(row.id),
  actorId: toUserId(row.actorId),
  actorName: row.actorName,
  actorAvatarUrl: row.actorAvatarUrl,
  actorRole: (VALID_ROLES.has(row.actorRole) ? row.actorRole : 'Staff') as Role,
  action: row.action as ActivityLog['action'],
  resourceType: row.resourceType as ActivityLog['resourceType'],
  resourceId: row.resourceId,
  propertyId: row.propertyId ? toPropertyId(row.propertyId) : null,
  organizationId: toOrgId(row.organizationId),
  payload: row.payload as ActivityLog['payload'],
  source: row.source as ActivityLog['source'],
  createdAt: row.createdAt,
})

export const createActivityRepository = (db: Database): ActivityRepository => ({
  insert: async (entry) => {
    await db.insert(activityLog).values({
      id: entry.id as string,
      actorId: entry.actorId as string,
      actorName: entry.actorName,
      actorAvatarUrl: entry.actorAvatarUrl,
      actorRole: entry.actorRole,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      propertyId: entry.propertyId as string | null,
      organizationId: entry.organizationId as string,
      payload: entry.payload,
      source: entry.source,
      createdAt: entry.createdAt,
    })
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
          eq(activityLog.organizationId, input.organizationId as string),
          // F133: Stable JSON serialization for deterministic comparison.
          // Sorts keys to avoid false negatives from differing insertion order.
          sql`${activityLog.payload} = ${stableStringify(input.payload)}::jsonb`,
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
          eq(activityLog.organizationId, orgId as string),
          eq(activityLog.resourceType, resourceType),
          eq(activityLog.resourceId, resourceId),
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
    return rows.map(activityFromRow)
  },

  findByOrganization: async (orgId, filter, pagination) => {
    const conditions = [eq(activityLog.organizationId, orgId as string)]

    if (filter.resourceType) {
      conditions.push(eq(activityLog.resourceType, filter.resourceType))
    }
    if (filter.resourceId) {
      conditions.push(eq(activityLog.resourceId, filter.resourceId))
    }
    if (filter.propertyId) {
      conditions.push(eq(activityLog.propertyId, filter.propertyId as string))
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
