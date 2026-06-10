// Notification context — event handler for inbox.inbox_note.added
// Notifies property managers when a note is added to an inbox item.
// The InboxNoteAdded event does not carry assigneeId (denormalized per Q7 decision).
// MVP: notify all managers assigned to the property via userLookup.

import type { InboxNoteAdded } from '#/contexts/inbox/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
}>

export const onInboxNoteAdded =
  (deps: Deps) =>
  async (event: InboxNoteAdded): Promise<void> => {
    const recipients = await deps.userLookup.findAssignedManagers(event.propertyId)

    const jobs: InsertNotificationJobData[] = recipients.map((userId) => ({
      userId,
      organizationId: event.organizationId,
      type: 'inbox_note.added' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      eventId: event.eventId,
      title: 'New note added',
      body: 'A note was added to an inbox item',
    }))

    await Promise.all(
      jobs.map((data) => deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)),
    )
  }
