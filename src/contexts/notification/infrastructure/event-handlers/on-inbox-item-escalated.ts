// Notification context — event handler for inbox.inbox_item.escalated
// Notifies account admins when an inbox item is escalated.
//
// This handler used to paste the raw inbox-item UUID into the body ("Inbox item
// 61ed98fc-… has been escalated and requires attention"), which told the reader
// nothing they could act on — the id is already carried silently by the deep
// link. It now emits facts, and the template says how bad the rating is, which
// property it belongs to, and how long it has gone unanswered.

import type { Queue } from 'bullmq'
import type { InboxItemEscalated } from '#/contexts/inbox/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import { buildInboxItemPayload } from './payload-facts'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  inboxItemLookup: InboxItemLookupPort
  clock: () => Date
  logger: LoggerPort
}>

export const onInboxItemEscalated =
  (deps: Deps) =>
  async (event: InboxItemEscalated): Promise<void> => {
    const recipients = await deps.userLookup.findByRole(
      event.organizationId,
      'AccountAdmin' as const,
    )

    if (recipients.length === 0) {
      deps.logger.warn(
        { correlationId: event.correlationId ?? undefined },
        'onInboxItemEscalated: no recipients found, skipping',
      )
      return
    }

    // No actorRole: the escalation template speaks about the ITEM ("this was
    // escalated because it has gone unanswered"), and naming a role would
    // wrongly imply a colleague chose to escalate rather than an SLA firing.
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
          type: 'inbox.escalated' as const,
          resourceType: 'inbox_item' as const,
          resourceId: event.inboxItemId,
          eventId: event.eventId,
          payload,
          audience: { kind: 'account_admin' as const },
        }),
      ),
    )
  }
