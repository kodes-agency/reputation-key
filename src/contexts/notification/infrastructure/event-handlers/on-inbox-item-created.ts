// Notification context — event handler for inbox.inbox_item.created
// Notifies assigned managers about new reviews AND feedback. Branches on
// sourceType (ADR 0022): review → 'review.created', feedback → 'feedback.created'.
// resourceId is the inboxItemId — the honest deep-link target (vs the old
// review.created handler that stamped a reviewId under resourceType 'inbox_item').
//
// The event carries ids only, so the star rating and property name that make
// this row actionable ("New 2-star review at Riverside Hotel") come from the
// inbox-item facts lookup, not from the event bus.

import type { Queue } from 'bullmq'
import type { InboxItemCreated } from '#/contexts/inbox/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { buildInboxItemPayload } from './payload-facts'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

export type OnInboxItemCreatedDeps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  inboxItemLookup: InboxItemLookupPort
  clock: () => Date
  logger: LoggerPort
}>

export const onInboxItemCreated =
  (deps: OnInboxItemCreatedDeps) =>
  async (event: InboxItemCreated): Promise<void> => {
    if (event.sourceType !== 'review' && event.sourceType !== 'feedback') {
      deps.logger.debug('onInboxItemCreated: skipping unknown source', {
        sourceType: event.sourceType,
      })
      return
    }

    if (!event.propertyId) {
      deps.logger.debug('onInboxItemCreated: no propertyId, skipping', {
        correlationId: event.correlationId ?? undefined,
      })
      return
    }

    const assigned = await deps.userLookup.findAssignedManagers(
      event.organizationId,
      event.propertyId,
    )
    // A property with nobody assigned must not swallow a new review: every
    // review for it produced ZERO notifications. AccountAdmins are always
    // able to act on the whole org, so they are the correct fallback
    // audience; only an org with no AccountAdmin at all is a genuine drop.
    const recipients =
      assigned.length > 0
        ? assigned
        : await deps.userLookup.findByRole(event.organizationId, 'AccountAdmin')

    if (recipients.length === 0) {
      deps.logger.warn(
        { correlationId: event.correlationId ?? undefined },
        'onInboxItemCreated: no recipients found',
      )
      return
    }

    const type = event.sourceType === 'review' ? 'review.created' : 'feedback.created'
    // No actor: nobody on the team created this, a guest did — and a guest is
    // never named in a notification (ADR 0046 r.8).
    const payload = await buildInboxItemPayload(deps, {
      inboxItemId: event.inboxItemId,
      orgId: event.organizationId,
    })

    await Promise.all(
      recipients.map((userId) =>
        deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, {
          userId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          type,
          resourceType: 'inbox_item',
          resourceId: event.inboxItemId,
          eventId: event.eventId,
          payload,
        }),
      ),
    )
  }
