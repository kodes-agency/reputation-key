// ADR 0046 r.3/r.4 — organization-level scope for recipient-centric delivery.
//
// Two facts the delivery jobs need that no per-property resolver can give them:
//
//  1. The ORGANIZATION fallback timezone. `notification_user_settings.timezone`
//     is the primary source, but it is only populated once a user visits
//     /settings/notifications. Before that, "one digest per user in their
//     timezone" needs an org-level answer, and UTC is a bad one for a single-
//     property hotel group in Denver. There is no `organization.timezone`
//     column (`shared/db/schema/auth.ts:81-96` — Better Auth owns that table
//     and adding to it means `pnpm auth:migrate`, not drizzle-kit), so the
//     representative zone is derived: the most common timezone among the org's
//     active properties, tie-broken by the oldest property.
//
//  2. Property display NAMES, for grouping one user's digest by property. This
//     is content-boundary safe: ADR 0046 r.8 explicitly allows property names.
//
// Both come from one query, because the digest resolves them together per org.

import type { Pool } from 'pg'

export type NotificationOrganizationScope = Readonly<{
  /** Representative IANA zone, or null when the org has no active property. */
  timezone: string | null
  /** propertyId → display name, for digest grouping headers. */
  propertyNames: ReadonlyMap<string, string>
}>

export type NotificationOrganizationScopeResolver = (
  organizationId: string,
) => Promise<NotificationOrganizationScope>

type PropertyRow = Readonly<{
  property_id: string
  name: string
  timezone: string
}>

/**
 * Modal timezone, ties broken by the row order the query imposes (oldest
 * property first). Deterministic: the same org always yields the same zone, so
 * a digest cannot drift between sweeps.
 */
export function representativeTimezone(
  rows: ReadonlyArray<Readonly<{ timezone: string }>>,
): string | null {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.timezone, (counts.get(row.timezone) ?? 0) + 1)
  }
  let winner: string | null = null
  let best = 0
  for (const [timezone, count] of counts) {
    if (count > best) {
      winner = timezone
      best = count
    }
  }
  return winner
}

export function createNotificationOrganizationScopeResolver(
  pool: Pool,
): NotificationOrganizationScopeResolver {
  return async (organizationId) => {
    const result = await pool.query<PropertyRow>(
      `SELECT id::text AS property_id, name, timezone
         FROM properties
        WHERE organization_id = $1
          AND deleted_at IS NULL
          AND lifecycle_state = 'active'
        ORDER BY created_at ASC
        LIMIT 500`,
      [organizationId],
    )
    const propertyNames = new Map<string, string>()
    for (const row of result.rows) propertyNames.set(row.property_id, row.name)
    return { timezone: representativeTimezone(result.rows), propertyNames }
  }
}
