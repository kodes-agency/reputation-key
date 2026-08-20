import type { PropertyCreated } from '#/contexts/property/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onPropertyCreated =
  (deps: Deps) =>
  async (event: PropertyCreated): Promise<void> => {
    const payload: InsertActivityLogInput = {
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
        detail: event.name,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
