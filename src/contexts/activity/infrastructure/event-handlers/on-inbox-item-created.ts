import type { InboxItemCreated } from '#/contexts/inbox/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemCreated =
  (deps: Deps) =>
  async (event: InboxItemCreated): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'created' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      eventId: event.eventId,
      payload: {
        subject: 'inbox_item',
        from: null,
        to: null,
        detail: event.sourceType,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
