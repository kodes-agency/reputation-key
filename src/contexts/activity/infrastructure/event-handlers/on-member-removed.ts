import type { IdentityMemberRemoved } from '#/contexts/identity/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onMemberRemoved =
  (deps: Deps) =>
  async (event: IdentityMemberRemoved): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'deleted' as const,
      resourceType: 'member' as const,
      resourceId: event.userId,
      propertyId: null,
      organizationId: event.organizationId,
      userId: event.removedBy,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'member',
        from: null,
        to: null,
        detail: null,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
