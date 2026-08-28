import type { IntegrationGoogleConnectionVisibilityChanged } from '#/contexts/integration/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

// BQC-3.9: consume the integration.google_connection.visibility_changed orphan
// (BQC-3.1) into Recent Activity. Content-free: the visibility value is a
// domain enum, never connection detail (ADR 0045).
export const onGoogleConnectionVisibilityChanged =
  (deps: Deps) =>
  async (event: IntegrationGoogleConnectionVisibilityChanged): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'changed' as const,
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
        to: event.visibility,
        detail: null,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
