import type { InboxItemStatusChanged } from '#/contexts/inbox/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'

type Deps = Readonly<{ queue: Queue; logger: LoggerPort }>

export const onInboxStatusChanged =
  (deps: Deps) =>
  async (event: InboxItemStatusChanged): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'changed' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      eventId: event.eventId,
      payload: {
        subject: 'status',
        from: event.oldStatus,
        to: event.newStatus,
        detail: null,
      },
    }
    deps.logger.info(
      { from: event.oldStatus, to: event.newStatus },
      'Enqueue project-recent-activity job',
    )
    await deps.queue.add('project-recent-activity', payload)
  }
