// Feed notification surface — route facts that announce nothing.
//
// Every fact of a notification route's event type is consumed, but some are
// consumed to decide that nobody is told. An import writes three of them for
// a past review Google already shows a reply for: the item's arrival, which
// history never announces (ADR 0046, historical-onboarding-item.ts); its first
// Handling Cycle opened with the item, which "New review" already covers; and
// that cycle closed by the provider, which retires notices and history has
// none to retire. A bulk reopen writes one per item, announced once by its
// completion fact. The delivery-lag report measures how long a notice waits
// for its consumer; counting these, a large import's queue wait paged as late
// delivery while no notice was owed.
//
// Only that first-cycle provider close is silent. A manager's close, a close
// of a later cycle, and any close of an item that arrived live are real work
// for the settle route, so they stay counted. Mirrors the consumers' own rules
// — `notificationTypeFor` in handling-cycle-outbox-consumers.ts and the arrival
// route's history check — so a change to either belongs here too. Reads
// identifier-only payload fields (a reason, a source kind, a flag, a bulk id,
// an item id, a cycle number, an actor kind) and never selects them.

import { sql } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { historicalOnboardingItem } from './historical-onboarding-item'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

/**
 * True for an `outbox_events` row, aliased `event`, whose route announces
 * nothing. An arrival fact's aggregate is its Inbox item, and a Handling Cycle
 * fact names it in its payload; the casts are guarded so a malformed id links
 * to nothing instead of failing the read. A close is silent only for the first
 * cycle of a history item and only when no user wrote it: a missing actor
 * reads as a user, so the doubtful case stays counted.
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
  OR (event.event_type = 'inbox.handling_cycle.closed'
    AND event.payload->>'cycleNumber' = '1'
    AND COALESCE(event.payload->>'actorType', 'user') <> 'user'
    AND EXISTS (
      SELECT 1
      FROM ${inboxItems}
      WHERE ${inboxItems.id} = CASE
          WHEN event.payload->>'inboxItemId' ~* ${UUID_PATTERN}
          THEN (event.payload->>'inboxItemId')::uuid
        END
        AND ${inboxItems.organizationId} = event.organization_id
        AND ${historicalOnboardingItem}
    ))
)`
