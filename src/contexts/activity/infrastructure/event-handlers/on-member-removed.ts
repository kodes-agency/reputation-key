import type { IdentityMemberRemoved } from '#/contexts/identity/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onMemberRemoved =
  (deps: Deps) =>
  async (event: IdentityMemberRemoved): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'deleted' as const,
      resourceType: 'member' as const,
      resourceId: event.userId,
      propertyId: null,
      organizationId: event.organizationId,
      userId: event.removedBy,
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
