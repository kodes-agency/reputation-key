import type { IdentityOrganizationCreated } from '#/contexts/identity/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

// BQC-3.9: consume the identity.organization.created orphan (BQC-3.1) — the
// registration-time audit fact finally gets its audit consumer.
export const onOrganizationCreated =
  (deps: Deps) =>
  async (event: IdentityOrganizationCreated): Promise<void> => {
    const payload: InsertActivityLogInput = {
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
        detail: event.organizationName,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
