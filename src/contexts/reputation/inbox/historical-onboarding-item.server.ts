// Feed notification surface — the one definition of an Inbox item that arrived
// as Google history.
//
// History does not fan out (ADR 0046): an item whose first Handling Cycle holds
// a Google Review observed as `historical_onboarding`, a past review an import
// brought in, is never announced as new. The fan-out's lookup and the
// missing-notification gauge both read this predicate, so the item the fan-out
// skips is exactly the item the gauge never counts as a gap. Two copies could
// drift, and the gauge would page after every import.
//
// Keyed on the first cycle's Response Target because its eligibility is
// immutable at the database boundary and commits in the same transaction as
// the item and its `inbox.inbox_item.created` fact: every reader gets the same
// answer from the moment the item exists.

import { sql } from 'drizzle-orm'
import {
  inboxHandlingCycleResponseTargets,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'

/**
 * True for an `inbox_items` row that arrived as Google history. Correlated on
 * `inbox_items.id`, so the enclosing query must read `inbox_items`; tenant
 * scope is the enclosing query's (cycle 1 is the item's first Handling Cycle).
 */
export const historicalOnboardingItem = sql<boolean>`EXISTS (
  SELECT 1
  FROM ${inboxHandlingCycleResponseTargets}
  WHERE ${inboxHandlingCycleResponseTargets.inboxItemId} = ${inboxItems.id}
    AND ${inboxHandlingCycleResponseTargets.cycleNumber} = 1
    AND ${inboxHandlingCycleResponseTargets.targetKind} = 'google_review_response'
    AND ${inboxHandlingCycleResponseTargets.performanceEligibility} = 'historical_onboarding'
)`
