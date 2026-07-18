import type { PropertyDeleted } from '#/contexts/property/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

// BQC-3.9: consume the property.deleted orphan (BQC-3.1) — audit fact → audit log.
export const onPropertyDeleted =
  (deps: Deps) =>
  async (event: PropertyDeleted): Promise<void> => {
    const payload: InsertActivityLogInput = {
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
    await deps.queue.add('insert-activity-log', payload)
  }
