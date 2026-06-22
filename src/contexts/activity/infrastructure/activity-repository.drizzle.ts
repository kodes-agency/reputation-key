import { and, eq, desc, inArray, or, isNull } from 'drizzle-orm'
import { assertLiteral } from '#/shared/domain/assert'
import { getLogger } from '#/shared/observability/logger'
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

const log = getLogger().child({ component: 'activity-repo' })

const VALID_ROLES = new Set<string>(['Staff', 'PropertyManager', 'AccountAdmin'])

const VALID_ACTIONS: readonly ActivityLog['action'][] = [
  'created',
  'changed',
  'deleted',
  'assigned',
  'unassigned',
  'published',
  'rejected',
  'approved',
  'submitted',
  'added',
  'escalated',
  'invited',
  'connected',
  'disconnected',
]
const VALID_RESOURCE_TYPES: readonly ActivityLog['resourceType'][] = [
  'inbox_item',
  'review',
  'reply',
  'note',
  'property',
  'member',
  'team',
  'staff_assignment',
  'integration',
]
const VALID_SOURCES: readonly string[] = ['web', 'import']

const activityFromRow = (row: typeof activityLog.$inferSelect): ActivityLog => ({
  id: activityLogId(row.id),
  actorId: toUserId(row.actorId),
  actorName: row.actorName,
  actorAvatarUrl: row.actorAvatarUrl,
  actorRole: (VALID_ROLES.has(row.actorRole) ? row.actorRole : 'Staff') as Role,
  action: assertLiteral(
    row.action,
    VALID_ACTIONS,
    'activity.action',
  ) as ActivityLog['action'],
  resourceType: assertLiteral(
    row.resourceType,
    VALID_RESOURCE_TYPES,
    'activity.resourceType',
  ) as ActivityLog['resourceType'],
  resourceId: row.resourceId,
  propertyId: row.propertyId ? toPropertyId(row.propertyId) : null,
  organizationId: toOrgId(row.organizationId),
  // payload is JSONB — needs a per-action schema for full validation (future enhancement)
  payload: row.payload as ActivityLog['payload'],
  source: assertLiteral(
    row.source,
    VALID_SOURCES,
    'activity.source',
  ) as ActivityLog['source'],
  eventId: row.eventId ?? null,
  createdAt: row.createdAt,
})

export const createActivityRepository = (db: Database): ActivityRepository => ({
  insert: async (entry) => {
    try {
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
        log.info(
          { eventId: entry.eventId, organizationId: entry.organizationId },
          'Activity log entry already exists — idempotent no-op',
        )
        return
      }
      throw error
    }
  },

  findDuplicate: async (input: FindDuplicateInput) => {
    const rows = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.eventId, input.eventId),
          eq(activityLog.organizationId, input.organizationId as string),
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
    // ACT-010: push property-access scoping into SQL instead of in-memory
    // filter-then-slice. System-level entries (propertyId IS NULL) are always
    // visible, matching the prior filterByPropertyAccess semantics.
    if (filter.propertyIds) {
      const ids = filter.propertyIds.map((p) => p as string)
      conditions.push(
        or(isNull(activityLog.propertyId), inArray(activityLog.propertyId, ids))!,
      )
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
