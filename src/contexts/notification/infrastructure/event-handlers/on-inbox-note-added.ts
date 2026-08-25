// Notification context — event handler for inbox.inbox_note.added
// Notifies the current assignee when a note is added to claimed work. For an
// unassigned item, routes by source responsibility (Property for reviews,
// Portal for private feedback) with AccountAdmin recovery.
//
// The note TEXT is never carried into the notification (ADR 0046 r.8): the row
// says a note exists and who — by role — left it, and the deep link opens the
// thread.

import type { InboxNoteAdded } from '#/contexts/inbox/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'
import { buildInboxItemPayload } from './payload-facts'
import type { ResponsibleManagerLookupPort } from '../../application/ports/responsible-manager-lookup.port'
import {
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
} from '../../application/responsible-recipients'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: InboxItemLookupPort
  clock: () => Date
  logger: LoggerPort
}>

export const onInboxNoteAdded =
  (deps: Deps) =>
  async (event: InboxNoteAdded): Promise<void> => {
    if (!event.propertyId) {
      deps.logger.debug('onInboxNoteAdded: no propertyId, skipping', {
        correlationId: event.correlationId ?? undefined,
      })
      return
    }
    const propertyId = event.propertyId
    const facts = await deps.inboxItemLookup.findInboxItemFacts(
      event.inboxItemId,
      event.organizationId,
    )
    const recipients = facts?.assignedTo
      ? [facts.assignedTo]
      : facts
        ? await resolveInboxResponsibleRecipients(deps, event.organizationId, facts)
        : await deps.userLookup.findByRole(event.organizationId, 'AccountAdmin')
    const audience = facts?.assignedTo
      ? ({ kind: 'inbox_assignee', inboxItemId: event.inboxItemId } as const)
      : facts
        ? inboxNotificationAudience(facts)
        : ({ kind: 'account_admin' } as const)

    // R2-M1: Filter out the note author to avoid self-notification
    const filtered = recipients.filter((uid) => uid !== event.userId)

    if (filtered.length === 0) {
      deps.logger.warn(
        { correlationId: event.correlationId ?? undefined },
        'onInboxNoteAdded: no recipients after filtering, skipping',
      )
      return
    }

    const payload = await buildInboxItemPayload(deps, {
      inboxItemId: event.inboxItemId,
      orgId: event.organizationId,
      actorId: event.userId,
    })

    const jobs: InsertNotificationJobData[] = filtered.map((userId) => ({
      userId,
      organizationId: event.organizationId,
      propertyId,
      type: 'inbox_note.added' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      eventId: event.eventId,
      payload,
      audience,
    }))

    await Promise.all(
      jobs.map((data) => deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)),
    )
  }
