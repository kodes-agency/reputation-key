// Feed notification surface — route facts that announce nothing.
//
// Every fact of a notification route's event type is consumed, but some are
// consumed to decide that nobody is told. An import writes two of them for
// every past review: the item's arrival, which history never announces
// (ADR 0046, historical-onboarding-item.ts), and its first Handling Cycle
// opened with the item, which "New review" already covers. A bulk reopen
// writes one per item, announced once by its completion fact. The delivery-lag
// report measures how long a notice waits for its consumer; counting these, a
// large import's queue wait paged as late delivery while no notice was owed.
//
// Mirrors the consumers' own rules — `notificationTypeFor` in
// handling-cycle-outbox-consumers.ts and the arrival route's history check —
// so a change to either belongs here too. Reads identifier-only payload
// fields (a reason, a source kind, a flag, a bulk id) and never selects them.

import { sql } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { historicalOnboardingItem } from './historical-onboarding-item'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

/**
 * True for an `outbox_events` row, aliased `event`, whose route announces
 * nothing. An arrival fact's aggregate is its Inbox item; the cast is guarded
 * so a malformed id links to nothing instead of failing the read.
 */
export const silentRouteFact = sql<boolean>`(
  (event.event_type = 'inbox.inbox_item.created' AND EXISTS (
    SELECT 1
    FROM ${inboxItems}
    WHERE ${inboxItems.id} = CASE
        WHEN event.source_aggregate_id ~* ${UUID_PATTERN}
        THEN event.source_aggregate_id::uuid
      END
      AND ${inboxItems.organizationId} = event.organization_id
      AND ${historicalOnboardingItem}
  ))
  OR (event.event_type = 'inbox.handling_cycle.opened' AND NOT (
    COALESCE(event.payload->>'openReason', '') = 'material_revision_changed'
    AND COALESCE(event.payload->>'sourceType', '') = 'review'
    AND event.payload->>'openedWithItem' IS DISTINCT FROM 'true'
  ))
  OR (event.event_type = 'inbox.handling_cycle.reopened'
    AND COALESCE(event.payload->>'bulkId', '') <> '')
)`
