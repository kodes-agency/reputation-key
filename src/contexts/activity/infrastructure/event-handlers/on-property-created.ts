import type { PropertyCreated } from '#/contexts/property/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onPropertyCreated =
  (deps: Deps) =>
  async (event: PropertyCreated): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'created',
      resourceType: 'property',
      resourceId: event.propertyId,
      propertyId: event.propertyId,
      organizationId: event.organizationId,
      userId: null,
      source: 'web',
      eventId: event.eventId,
      payload: {
        subject: 'property',
        from: null,
        to: null,
        detail: null,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
