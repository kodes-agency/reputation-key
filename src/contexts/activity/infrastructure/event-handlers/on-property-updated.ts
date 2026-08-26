import type { PropertyUpdated } from '#/contexts/property/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

// BQC-3.9: project the property.updated fact into Recent Activity.
export const onPropertyUpdated =
  (deps: Deps) =>
  async (event: PropertyUpdated): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'changed' as const,
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
        detail: event.name,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
