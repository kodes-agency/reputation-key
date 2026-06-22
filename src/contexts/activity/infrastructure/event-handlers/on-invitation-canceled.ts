import type { IdentityInvitationCanceled } from '#/contexts/identity/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInvitationCanceled =
  (deps: Deps) =>
  async (event: IdentityInvitationCanceled): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'deleted' as const,
      resourceType: 'member' as const,
      resourceId: event.invitationId,
      propertyId: null,
      organizationId: event.organizationId,
      userId: null,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'member',
        from: null,
        to: null,
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
