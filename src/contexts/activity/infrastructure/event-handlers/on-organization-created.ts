import type { IdentityOrganizationCreated } from '#/contexts/identity/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

// BQC-3.9: consume the identity.organization.created orphan (BQC-3.1) — the
// registration-time fact finally gets its Recent Activity consumer.
export const onOrganizationCreated =
  (deps: Deps) =>
  async (event: IdentityOrganizationCreated): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'created' as const,
      resourceType: 'organization' as const,
      resourceId: event.organizationId,
      propertyId: null,
      organizationId: event.organizationId,
      userId: event.ownerId,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'organization',
        from: null,
        to: null,
        detail: null,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
