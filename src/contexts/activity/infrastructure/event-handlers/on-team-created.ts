import type { TeamCreated } from '#/contexts/team/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onTeamCreated =
  (deps: Deps) =>
  async (event: TeamCreated): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'created' as const,
      resourceType: 'team' as const,
      resourceId: event.teamId,
      propertyId: event.propertyId,
      organizationId: event.organizationId,
      userId: null,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'team',
        from: null,
        to: null,
        detail: event.name,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
