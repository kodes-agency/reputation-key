import type { IntegrationGoogleAccountConnected } from '#/contexts/integration/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onGoogleAccountConnected =
  (deps: Deps) =>
  async (event: IntegrationGoogleAccountConnected): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
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
        // BQC-1.2 / ADR 0045 r.3-4: identifier-only; provider contact
        // data is resolved at view time from the connection ID.
        detail: null,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
