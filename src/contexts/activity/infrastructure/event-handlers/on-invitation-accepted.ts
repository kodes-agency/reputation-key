import type { IdentityInvitationAccepted } from '#/contexts/identity/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInvitationAccepted =
  (deps: Deps) =>
  async (event: IdentityInvitationAccepted): Promise<void> => {
    const payload: ProjectRecentActivityInput = {
      action: 'added' as const,
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
        to: null,
        detail: null,
      },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
