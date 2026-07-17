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
        // BQC-1.2 / ADR 0045 r.3-4: content-free — no googleEmail; the
        // connection ID identifies the resource, detail resolves at view time.
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
