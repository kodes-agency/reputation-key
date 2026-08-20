// Notification context — event handler for review.reply.submitted
// Maps to 'reply.pending_approval' notification for AccountAdmins.

import type { ReviewReplySubmitted } from '#/contexts/review/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'
import { buildInboxItemPayload } from './payload-facts'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  inboxItemLookup: InboxItemLookupPort
  clock: () => Date
  logger: LoggerPort
}>

export const onReplySubmitted =
  (deps: Deps) =>
  async (event: ReviewReplySubmitted): Promise<void> => {
    const recipients = await deps.userLookup.findByRole(
      event.organizationId,
      'AccountAdmin',
    )

    if (recipients.length === 0) {
      deps.logger.warn(
        { correlationId: event.correlationId ?? undefined },
        'onReplySubmitted: no recipients found, skipping',
      )
      return
    }

    // Resolve the review to its inbox item (ADR 0022); skip if it's gone.
    const inboxItemId = await deps.inboxItemLookup.findInboxItemByReviewId(
      event.reviewId,
      event.organizationId,
    )
    if (!inboxItemId) return

    // One payload for every recipient: the facts are about the item, not about
    // who is being told. `actorId` is the submitter, so an approver reads "A
    // property manager drafted a reply" — the role, never the person.
    const payload = await buildInboxItemPayload(deps, {
      inboxItemId,
      orgId: event.organizationId,
      actorId: event.userId,
    })

    const jobs: InsertNotificationJobData[] = recipients.map((userId) => ({
      userId,
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      type: 'reply.pending_approval' as const,
      resourceType: 'inbox_item' as const,
      resourceId: inboxItemId,
      eventId: event.eventId,
      payload,
    }))

    await Promise.all(
      jobs.map((data) => deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)),
    )
  }
