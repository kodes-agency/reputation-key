// Notification context — event handler for goal.completed
// Notifies the goal creator that their goal has been completed.

import type { GoalCompleted } from '#/contexts/goal/application/public-api'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { Queue } from 'bullmq'

type Deps = Readonly<{
  queue: Queue
}>

export const onGoalCompleted =
  (deps: Deps) =>
  async (event: GoalCompleted): Promise<void> => {
    const data: InsertNotificationJobData = {
      userId: event.createdBy,
      organizationId: event.organizationId,
      type: 'goal.completed' as const,
      resourceType: 'goal' as const,
      resourceId: event.goalId,
      eventId: crypto.randomUUID(),
      title: 'Goal completed! 🎉',
      body: 'Your goal has been completed',
    }

    await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
  }
