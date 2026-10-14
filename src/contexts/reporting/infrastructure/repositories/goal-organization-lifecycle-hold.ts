// Goal maintenance and the Organization lifecycle (LIF-01).
//
// A closure request suspends nothing (the command store sets no Organization
// suspension), so a context that must stop effects from the request onward
// reads the Identity-owned authority row itself, as Feed's email paths do
// (notification-organization-email-stop.repository.ts). Goal's Closing phase
// pauses the active programs, but the database has no scheduled -> paused
// edge: a scheduled program is left as it is, and the hourly job would
// activate it inside the recovery window and then block the purge for good.
// So maintenance does not start work in an Organization the lifecycle holds.
//
// The hold is the facts the email stop reads: the Organization is past
// `active` (a closure requested, closing, purging or closed), or it is `active`
// again after a cancelled closure and still awaits its explicit reactivation.
// An Organization with no lifecycle row has no hold. Identifiers and a state
// only; no tenant content.

import { sql, type SQL } from 'drizzle-orm'
import { goalPrograms } from '#/shared/db/schema/goal.schema'

/** True for a Goal Program whose Organization the lifecycle holds. */
export const organizationLifecycleHoldsProgram: SQL = sql`EXISTS (
  SELECT 1
  FROM organization_lifecycle_authority AS lifecycle
  WHERE lifecycle.organization_id = ${goalPrograms.organizationId}
    AND (lifecycle.state <> 'active' OR lifecycle.reactivation_required)
)`
