// Notification context — event handler for inbox.inbox_item.created
// Routes new reviews to Property Responsible Managers and private feedback to
// Portal Responsible Managers, with AccountAdmin recovery only when unowned.
//
// The handler is a thin adapter: it unpacks the bus event and hands it to
// `fanoutInboxItemNotifications`, which owns recipient resolution, the
// AccountAdmin fallback, the sourceType -> notification-type branch (ADR 0022)
// and the content-free payload. The durable outbox consumer
// (../outbox-consumers.ts) and the reconcile-missing-notifications sweep call
// the same function, so all three paths notify the same people about the same
// facts — there is one definition of "who hears about a new review".
//
// resourceId is the inboxItemId — the honest deep-link target (vs the old
// review.created handler that stamped a reviewId under resourceType
// 'inbox_item').

import type { InboxItemCreated } from '#/contexts/inbox/application/public-api'
import { unbrand } from '#/shared/domain/ids'
import {
  fanoutInboxItemNotifications,
  type InboxFanoutDeps,
} from '../inbox-notification-fanout'

export type OnInboxItemCreatedDeps = InboxFanoutDeps

export const onInboxItemCreated =
  (deps: OnInboxItemCreatedDeps) =>
  async (event: InboxItemCreated): Promise<void> => {
    await fanoutInboxItemNotifications(deps, {
      inboxItemId: unbrand(event.inboxItemId),
      organizationId: unbrand(event.organizationId),
      propertyId: event.propertyId === null ? null : unbrand(event.propertyId),
      sourceType: event.sourceType,
      eventId: event.eventId,
      correlationId: event.correlationId,
      // The outbox row id IS the domain event id (outbox/commit.ts
      // `insertOutboxRow` sets `id: event.eventId`), so the durable consumer
      // derives the SAME per-recipient job id from the same event. With
      // OUTBOX_DISPATCHER_ENABLED=true in google-closed-beta both paths run,
      // and this makes that dual delivery collapse to one insert-notification
      // job instead of coalescing a second arrival onto the user's unread row.
      jobIdScope: event.eventId,
    })
  }
