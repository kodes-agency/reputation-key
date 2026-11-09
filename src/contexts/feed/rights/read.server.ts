import { and, asc, eq, isNotNull, sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationPreferences,
  notificationUserSettings,
  notifications,
} from '#/shared/db/schema/notification.schema'
import {
  FORMER_MEMBER_FIELDS,
  NOTIFICATION_HISTORY_FIELDS,
  NOTIFICATION_PREFERENCE_FIELDS,
  NOTIFICATION_USER_SETTING_FIELDS,
  type RightsRow,
  type RightsValue,
  type ScopedRightsRow,
} from './fields'

export type NotificationRightsScope = Readonly<{
  organizationId: string
  propertyId?: string
}>

const ACCESS_REMOVED_TYPE = 'account.organization_access_removed'

function toValue(value: unknown): RightsValue {
  if (value instanceof Date) return value.toISOString()
  return (value ?? null) as RightsValue
}

function pick(source: Readonly<Record<string, unknown>>, fields: readonly string[]) {
  return Object.fromEntries(
    fields.map((field) => [field, toValue(source[field])]),
  ) as RightsRow
}

function scoped(
  source: Readonly<Record<string, unknown>> & {
    organizationId: string
    propertyId?: string | null
  },
  fields: readonly string[],
): ScopedRightsRow {
  return {
    organizationId: source.organizationId,
    propertyId: source.propertyId ?? null,
    fields: pick(source, fields),
  }
}

function propertyPredicate(
  column: Parameters<typeof eq>[0],
  scope: NotificationRightsScope,
): SQL | undefined {
  return scope.propertyId ? eq(column, scope.propertyId) : undefined
}

/** The person's notification history: the Bell feed rows, newest last. */
export async function getNotificationHistory(
  db: Database,
  scope: NotificationRightsScope,
): Promise<readonly ScopedRightsRow[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, scope.organizationId),
        propertyPredicate(notifications.propertyId, scope),
      ),
    )
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
  return rows.map((row) => scoped(row, NOTIFICATION_HISTORY_FIELDS))
}

/** Per-Property category and channel choices. */
export async function getNotificationPreferences(
  db: Database,
  scope: NotificationRightsScope,
): Promise<readonly ScopedRightsRow[]> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, scope.organizationId),
        isNotNull(notificationPreferences.propertyId),
        propertyPredicate(notificationPreferences.propertyId, scope),
      ),
    )
    .orderBy(asc(notificationPreferences.createdAt), asc(notificationPreferences.id))
  return rows.map((row) => scoped(row, NOTIFICATION_PREFERENCE_FIELDS))
}

/** Locale, timezone and quiet hours: the person's, one row per Organization. */
export async function getNotificationUserSettings(
  db: Database,
  scope: NotificationRightsScope,
): Promise<readonly ScopedRightsRow[]> {
  if (scope.propertyId) return []
  const rows = await db
    .select()
    .from(notificationUserSettings)
    .where(eq(notificationUserSettings.organizationId, scope.organizationId))
    .orderBy(asc(notificationUserSettings.createdAt), asc(notificationUserSettings.id))
  return rows.map((row) => scoped(row, NOTIFICATION_USER_SETTING_FIELDS))
}

/**
 * People told their access ended, newest removal per person. They hold no role
 * any more, so this is the only place a final warning can find them.
 */
export async function getFormerMemberRemovals(
  db: Database,
  scope: Pick<NotificationRightsScope, 'organizationId'>,
): Promise<readonly ScopedRightsRow[]> {
  const rows = await db
    .selectDistinctOn([notifications.userId], {
      organizationId: notifications.organizationId,
      userId: notifications.userId,
      eventId: notifications.eventId,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, scope.organizationId),
        eq(notifications.type, ACCESS_REMOVED_TYPE),
      ),
    )
    .orderBy(asc(notifications.userId), sql`${notifications.createdAt} DESC`)
  return rows.map((row) => scoped(row, FORMER_MEMBER_FIELDS))
}
