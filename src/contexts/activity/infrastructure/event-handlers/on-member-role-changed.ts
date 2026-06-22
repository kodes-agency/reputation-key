import type { IdentityMemberRoleChanged } from '#/contexts/identity/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onMemberRoleChanged =
  (deps: Deps) =>
  async (event: IdentityMemberRoleChanged): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'changed' as const,
      resourceType: 'member' as const,
      resourceId: event.memberUserId,
      propertyId: null,
      organizationId: event.organizationId,
      userId: event.userId,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'member',
        from: event.previousRole,
        to: event.newRole,
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
