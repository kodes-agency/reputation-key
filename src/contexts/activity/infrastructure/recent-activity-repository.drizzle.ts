import { and, eq, desc, inArray } from 'drizzle-orm'
import { assertLiteral } from '#/shared/domain/assert'
import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { recentActivityEntries } from '#/shared/db/schema/activity.schema'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  recentActivityEntryId,
  userId as toUserId,
  propertyId as toPropertyId,
  organizationId as toOrgId,
} from '#/shared/domain/ids'
import type {
  RecentActivityRepository,
  FindRecentActivityDuplicateInput,
} from '../ports/recent-activity-repository.port'
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_RESOURCE_TYPES,
  ACTIVITY_SOURCES,
  type RecentActivityEntry,
} from '../domain/types'
import type { Role } from '#/shared/domain/roles'

const VALID_ROLES = new Set<string>(['Staff', 'PropertyManager', 'AccountAdmin'])

const activityFromRow = (
  row: typeof recentActivityEntries.$inferSelect,
): RecentActivityEntry => ({
  id: recentActivityEntryId(row.id),
  actorId: toUserId(row.actorId),
  actorName: row.actorName,
  actorAvatarUrl: row.actorAvatarUrl,
  actorRole: (VALID_ROLES.has(row.actorRole) ? row.actorRole : 'Staff') as Role,
  action: assertLiteral(
    row.action,
    ACTIVITY_ACTIONS,
    'activity.action',
  ) as RecentActivityEntry['action'],
  resourceType: assertLiteral(
    row.resourceType,
    ACTIVITY_RESOURCE_TYPES,
    'activity.resourceType',
  ) as RecentActivityEntry['resourceType'],
  resourceId: row.resourceId,
  propertyId: row.propertyId ? toPropertyId(row.propertyId) : null,
  organizationId: toOrgId(row.organizationId),
  // payload is JSONB — needs a per-action schema for full validation (future enhancement)
  payload: row.payload as RecentActivityEntry['payload'],
  source: assertLiteral(
    row.source,
    ACTIVITY_SOURCES,
    'activity.source',
  ) as RecentActivityEntry['source'],
  eventId: row.eventId ?? null,
  createdAt: row.createdAt,
})

export const createRecentActivityRepository = (
  db: Database,
  logger: LoggerPort,
): RecentActivityRepository => {
  const log = logger.child({ component: 'recent-activity-repository' })
  return {
    insert: async (entry) => {
      try {
        await db.insert(recentActivityEntries).values({
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
          eventId: entry.eventId,
          createdAt: entry.createdAt,
        })
      } catch (error) {
        // ACT-006: unique violation on (eventId, organizationId) — the job was
        // redelivered after a concurrent insert succeeded. Treat as idempotent
        // no-op so BullMQ doesn't retry a job whose effect already landed.
        const isPg23505 =
          error instanceof Error &&
          'code' in error &&
          (error as { code: string }).code === '23505'
        if (isPg23505) {
          log.info('Recent Activity entry already exists — idempotent no-op')
          return
        }
        throw error
      }
    },

    findDuplicate: async (input: FindRecentActivityDuplicateInput) => {
      const rows = await db
        .select({ id: recentActivityEntries.id })
        .from(recentActivityEntries)
        .where(
          and(
            eq(recentActivityEntries.eventId, input.eventId),
            eq(recentActivityEntries.organizationId, input.organizationId as string),
          ),
        )
        .limit(1)
      return rows.length > 0
    },

    findByResource: async (orgId: OrganizationId, resourceType, resourceId, limit) => {
      const rows = await db
        .select()
        .from(recentActivityEntries)
        .where(
          and(
            eq(recentActivityEntries.organizationId, orgId as string),
            eq(recentActivityEntries.resourceType, resourceType),
            eq(recentActivityEntries.resourceId, resourceId),
          ),
        )
        .orderBy(desc(recentActivityEntries.createdAt))
        .limit(limit)
      return rows.map(activityFromRow)
    },

    findByOrganization: async (orgId, filter, pagination) => {
      const conditions = [eq(recentActivityEntries.organizationId, orgId as string)]

      if (filter.resourceType) {
        conditions.push(eq(recentActivityEntries.resourceType, filter.resourceType))
      }
      if (filter.resourceId) {
        conditions.push(eq(recentActivityEntries.resourceId, filter.resourceId))
      }
      if (filter.propertyId) {
        conditions.push(eq(recentActivityEntries.propertyId, filter.propertyId as string))
      }
      // Push assigned-Property access into SQL before pagination. Entries with
      // no Property scope require Organization-wide authority and therefore do
      // not belong in an assigned-Property result.
      if (filter.propertyIds) {
        const ids = filter.propertyIds.map((p) => p as string)
        conditions.push(inArray(recentActivityEntries.propertyId, ids))
      }

      const rows = await db
        .select()
        .from(recentActivityEntries)
        .where(and(...conditions))
        .orderBy(desc(recentActivityEntries.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset)
      return rows.map(activityFromRow)
    },
  }
}
