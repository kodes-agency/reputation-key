import type { IntegrationGoogleAccountDisconnected } from '#/contexts/integration/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onGoogleAccountDisconnected =
  (deps: Deps) =>
  async (event: IntegrationGoogleAccountDisconnected): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'disconnected' as const,
      resourceType: 'integration' as const,
      resourceId: event.connectionId,
      propertyId: null,
      organizationId: event.organizationId,
      userId: null,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'integration',
        from: null,
        to: null,
        detail: null,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
