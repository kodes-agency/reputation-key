// People's Organization and Property erasure: the Staff-owned tenant tables,
// deleted in foreign-key-safe order, and the check that no Staff fact is still
// unpublished. The rights executor runs it behind its journal entry.

import { sql, type SQL } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

/**
 * One Staff-owned table plus the predicate that binds its rows to the tenant.
 * The list is static and explicit: a Staff table that is not named here is
 * never read and never scrubbed by this contributor.
 */
type StaffLifecycleTable = Readonly<{
  table: string
  scope: (organizationId: string) => SQL
}>

const byOrganization =
  (table: string) =>
  (organizationId: string): SQL =>
    sql`${sql.identifier(table)}.organization_id = ${organizationId}`

/**
 * Staff-owned tenant tables in FK-safe DELETE order.
 *
 * Order matters because every people foreign key is `ON DELETE RESTRICT` — the
 * schema deliberately refuses to cascade a person away. Children first:
 * responsibilities and memberships reference participations, participations and
 * login links reference participants.
 *
 * Deliberately absent:
 *   * `property_access_grant` — the property-access
 *     authority is Identity's (ADR 0039, context acceptance matrix row 1).
 *     Staff never reads or writes an authorization record.
 *   * `user`, `member`, `session` — a Staff Participant may be a human who is
 *     also a member of ANOTHER Organization. Program bullet 5 keeps user
 *     identities that belong elsewhere, so Staff drops its participation rows
 *     and leaves every identity row to Identity.
 */
const STAFF_TENANT_TABLES: readonly StaffLifecycleTable[] = Object.freeze([
  { table: 'staff_onboardings', scope: byOrganization('staff_onboardings') },
  { table: 'staff_property_settings', scope: byOrganization('staff_property_settings') },
  // Effective-dated responsibility for a Portal; references staff_participations.
  { table: 'portal_responsibilities', scope: byOrganization('portal_responsibilities') },
  // Event-time Portal Group membership (ADR 0040). It is people data, not
  // Portal configuration, which is why Staff — not Portal — scrubs the rows.
  // The TABLE itself is a retained compatibility surface and is never dropped.
  {
    table: 'portal_group_memberships',
    scope: byOrganization('portal_group_memberships'),
  },
  { table: 'staff_participations', scope: byOrganization('staff_participations') },
  { table: 'staff_user_links', scope: byOrganization('staff_user_links') },
  { table: 'staff_participants', scope: byOrganization('staff_participants') },
] as const)

const readCount = async (tx: Tx, query: SQL): Promise<number> => {
  const result = await tx.execute(query)
  const rows = result.rows as readonly Record<string, unknown>[]
  const value = rows[0]?.count
  const count = typeof value === 'string' ? Number(value) : value
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Staff lifecycle row count is unavailable')
  }
  return count
}

/**
 * Staff-sourced facts that are still unpublished are work in flight: a consumer
 * has not seen them yet, and purging the aggregate they name would publish a
 * fact about rows that no longer exist. Recovery-fenced rows are excluded
 * because they are deliberately never published and would otherwise block the
 * boundary forever.
 */
export const assertStaffOutboxSettled = async (
  tx: Tx,
  organizationId: string,
  propertyId?: string,
): Promise<void> => {
  const property = propertyId ? sql` AND property_id = ${propertyId}` : sql``
  const pending = await readCount(
    tx,
    sql`SELECT count(*)::int AS count
        FROM outbox_events
        WHERE organization_id = ${organizationId}${property}
          AND source_context = 'staff'
          AND published_at IS NULL
          AND recovery_fenced_at IS NULL`,
  )
  if (pending > 0) {
    throw new Error('Staff purge readiness blocked: unpublished_staff_outbox_events')
  }
}

/** The purge's deletes, bound to one Organization; returns the rows removed. */
export const deleteStaffTenantRows = async (
  tx: Tx,
  organizationId: string,
): Promise<number> => {
  let scrubbed = 0
  for (const { table, scope } of STAFF_TENANT_TABLES) {
    scrubbed += await readCount(
      tx,
      sql`WITH deleted AS (
            DELETE FROM ${sql.identifier(table)}
            WHERE ${scope(organizationId)}
            RETURNING 1
          )
          SELECT count(*)::int AS count FROM deleted`,
    )
  }
  return scrubbed
}

/**
 * The Staff tables that belong to one Property, in the same FK-safe order. The
 * people themselves (`staff_participants`, `staff_user_links`) belong to the
 * Organization and stay; the participant scope erases a person.
 */
const STAFF_PROPERTY_TABLES: readonly string[] = Object.freeze([
  'staff_onboardings',
  'staff_property_settings',
  'portal_responsibilities',
  'portal_group_memberships',
  'staff_participations',
])

/** One Property's Staff rows, bound to its Organization; returns the rows removed. */
export const deleteStaffPropertyRows = async (
  tx: Tx,
  organizationId: string,
  propertyId: string,
): Promise<number> => {
  let deleted = 0
  for (const table of STAFF_PROPERTY_TABLES) {
    deleted += await readCount(
      tx,
      sql`WITH deleted AS (
            DELETE FROM ${sql.identifier(table)}
            WHERE organization_id = ${organizationId}
              AND property_id = ${propertyId}::uuid
            RETURNING 1
          )
          SELECT count(*)::int AS count FROM deleted`,
    )
  }
  return deleted
}

/** The static, reviewable table plan. Exported for the contract tests. */
export const STAFF_LIFECYCLE_TABLES: readonly string[] = Object.freeze(
  STAFF_TENANT_TABLES.map(({ table }) => table),
)

export const STAFF_PROPERTY_LIFECYCLE_TABLES = STAFF_PROPERTY_TABLES
