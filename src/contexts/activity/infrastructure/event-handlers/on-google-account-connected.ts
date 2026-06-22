import type { IntegrationGoogleAccountConnected } from '#/contexts/integration/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onGoogleAccountConnected =
  (deps: Deps) =>
  async (event: IntegrationGoogleAccountConnected): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'connected' as const,
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
        detail: event.googleEmail,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
