// Response Targets that must not count (migration 0069): the one definition of
// "this cycle's target is not excluded", for every reader that counts, reminds
// or measures waiting time.
//
// A row of `inbox_response_target_exclusions` leaves one Handling Cycle's target
// out of analytics, the per-Property overdue figures, reminders and waiting time
// (the operator command that writes it is in src/shared/ops). Each reader adds
// this predicate to the statement that reads the target, so none can drift from
// the others. The ledger is scoped by Organization: the predicate compares the
// row's `organization_id` with the target's own, never across tenants.

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { inboxResponseTargetExclusions } from './schema/inbox-response-target-exclusions.schema'

/** The three columns that name a target's cycle, as the caller's statement spells them. */
export type ResponseTargetKey = Readonly<{
  inboxItemId: SQLWrapper
  cycleNumber: SQLWrapper
  organizationId: SQLWrapper
}>

/** The key columns of a target table the statement aliases (`FROM ... target`). */
export function aliasedResponseTargetKey(alias: string): ResponseTargetKey {
  // `alias` is a constant of the calling statement, never input.
  return {
    inboxItemId: sql.raw(`${alias}.inbox_item_id`),
    cycleNumber: sql.raw(`${alias}.cycle_number`),
    organizationId: sql.raw(`${alias}.organization_id`),
  }
}

/**
 * The ledger side is aliased (`exclusion`). The caller's key must be qualified:
 * drizzle leaves column names unqualified in a single-table select, and an
 * unqualified `inbox_item_id` would bind to the ledger itself and make the
 * predicate true for every row. Use it in a joined select, or alias the target
 * table and pass `aliasedResponseTargetKey`.
 */
function exclusionRowExists(target: ResponseTargetKey): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${inboxResponseTargetExclusions} AS exclusion
    WHERE exclusion.inbox_item_id = ${target.inboxItemId}
      AND exclusion.cycle_number = ${target.cycleNumber}
      AND exclusion.organization_id = ${target.organizationId}
  )`
}

/** True when the cycle of this target has no exclusion row. */
export function notExcludedFromResponseTargetReporting(target: ResponseTargetKey): SQL {
  return sql`NOT ${exclusionRowExists(target)}`
}

/** True when the cycle of this target has an exclusion row: a column for a select list. */
export function excludedFromResponseTargetReporting(
  target: ResponseTargetKey,
): SQL<boolean> {
  return exclusionRowExists(target).mapWith(Boolean)
}
