import type { Pool } from 'pg'

export type NotificationPropertyScope = Readonly<{
  organizationId: string
  propertyId: string
  timezone: string
}>

export type NotificationPropertyScopeResolver = (
  organizationId: string,
  propertyId: string,
) => Promise<NotificationPropertyScope | null>

export function createNotificationPropertyScopeResolver(
  pool: Pool,
): NotificationPropertyScopeResolver {
  return async (organizationId, propertyId) => {
    const result = await pool.query<Readonly<{ timezone: string }>>(
      `SELECT timezone
         FROM properties
        WHERE organization_id = $1
          AND id = $2::uuid
          AND deleted_at IS NULL
          AND lifecycle_state = 'active'
        LIMIT 1`,
      [organizationId, propertyId],
    )
    const row = result.rows[0]
    return row ? { organizationId, propertyId, timezone: row.timezone } : null
  }
}
