import type { InboxItemAssigned } from '#/contexts/inbox/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemAssigned =
  (deps: Deps) =>
  async (event: InboxItemAssigned): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'assigned' as const,
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
        to: event.assignedTo,
        detail: null,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
