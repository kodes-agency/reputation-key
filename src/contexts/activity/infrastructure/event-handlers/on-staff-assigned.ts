import type { StaffAssigned } from '#/contexts/staff/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onStaffAssigned =
  (deps: Deps) =>
  async (event: StaffAssigned): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'assigned' as const,
      resourceType: 'staff_assignment' as const,
      resourceId: event.assignmentId,
      propertyId: event.propertyId,
      organizationId: event.organizationId,
      userId: event.userId,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'staff_assignment',
        from: null,
        to: null,
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
