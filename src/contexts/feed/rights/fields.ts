// Explicit field allowlists for the manual rights path. A column that is not
// named here never leaves the database, whatever the table grows later.
// `event_id` and the email queue stay out: they are delivery correlation and
// provider receipts, not facts the person can see.

export const NOTIFICATION_HISTORY_FIELDS = [
  'id',
  'userId',
  'propertyId',
  'type',
  'category',
  'priority',
  'status',
  'resourceType',
  'resourceId',
  'title',
  'body',
  'payload',
  'coalescedCount',
  'coalescedLatestAt',
  'readAt',
  'createdAt',
  'updatedAt',
] as const

export const NOTIFICATION_PREFERENCE_FIELDS = [
  'id',
  'userId',
  'propertyId',
  'category',
  'channel',
  'enabled',
  'cadence',
  'maxRating',
  'createdAt',
  'updatedAt',
] as const

export const NOTIFICATION_USER_SETTING_FIELDS = [
  'id',
  'userId',
  'locale',
  'timezone',
  'quietHoursStart',
  'quietHoursEnd',
  'urgentBypassEnabled',
  'createdAt',
  'updatedAt',
] as const

/** Who was told their access ended, and the fact that told them. */
export const FORMER_MEMBER_FIELDS = ['userId', 'eventId', 'createdAt'] as const

export type RightsValue =
  | string
  | number
  | boolean
  | null
  | readonly RightsValue[]
  | { readonly [key: string]: RightsValue }
export type RightsRow = Readonly<Record<string, RightsValue>>

/** What a store hands back: the row plus the tenant it belongs to. */
export type ScopedRightsRow = Readonly<{
  organizationId: string
  propertyId: string | null
  fields: RightsRow
}>
