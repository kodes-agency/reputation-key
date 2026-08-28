import type { PropertyDeleted } from '#/contexts/property/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

// BQC-3.9: project the property.deleted fact into Recent Activity.
export const onPropertyDeleted =
  (deps: Deps) =>
  async (event: PropertyDeleted): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'deleted' as const,
      resourceType: 'property' as const,
      resourceId: event.propertyId,
      propertyId: event.propertyId,
      organizationId: event.organizationId,
      userId: null,
      source: 'web' as const,
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
