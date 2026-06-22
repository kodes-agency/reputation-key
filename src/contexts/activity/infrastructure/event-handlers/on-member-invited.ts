import type { IdentityMemberInvited } from '#/contexts/identity/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onMemberInvited =
  (deps: Deps) =>
  async (event: IdentityMemberInvited): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'invited' as const,
      resourceType: 'member' as const,
      resourceId: event.invitationId,
      propertyId: null,
      organizationId: event.organizationId,
      userId: event.userId,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'member',
        from: null,
        to: event.role,
        detail: event.email,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
