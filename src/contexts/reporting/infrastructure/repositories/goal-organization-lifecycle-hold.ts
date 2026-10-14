// Goal and the Organization lifecycle (LIF-01).
//
// A closure request suspends nothing (the command store sets no Organization
// suspension), so a context that must stop effects from the request onward
// reads the Identity-owned authority row itself, as Feed's email paths do
// (notification-organization-email-stop.repository.ts). Goal's Closing phase
// pauses the active programs, but the database has no scheduled -> paused
// edge: a scheduled program is left as it is, and the hourly job would
// activate it inside the recovery window and then block the purge for good.
// So Goal puts no program into `active` in an Organization the lifecycle
// holds: maintenance neither lists nor activates one, and a manager can
// neither create a goal nor start or resume one (the use cases ask
// `isOrganizationHeld` and refuse with `organization_closing`).
//
// The hold is the facts the email stop reads: the Organization is past
// `active` (a closure requested, closing, purging or closed), or it is `active`
// again after a cancelled closure and still awaits its explicit reactivation.
// An Organization with no lifecycle row has no hold. Identifiers and a state
// only; no tenant content.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { goalPrograms } from '#/shared/db/schema/goal.schema'

/** True when the lifecycle row of the Organization (a column or an id) holds it. */
const lifecycleHolds = (
  organizationId: typeof goalPrograms.organizationId | string,
): SQL =>
  sql`EXISTS (
  SELECT 1
  FROM organization_lifecycle_authority AS lifecycle
  WHERE lifecycle.organization_id = ${organizationId}
    AND (lifecycle.state <> 'active' OR lifecycle.reactivation_required)
)`

/** True for a Goal Program whose Organization the lifecycle holds. */
export const organizationLifecycleHoldsProgram: SQL = lifecycleHolds(
  goalPrograms.organizationId,
)

/** True when the lifecycle holds the Organization. */
export async function isOrganizationHeldByLifecycle(
  db: Database,
  organizationId: string,
): Promise<boolean> {
  const result = await db.execute(sql`SELECT ${lifecycleHolds(organizationId)} AS held`)
  return (result.rows[0] as { held?: unknown } | undefined)?.held === true
}
