// Notification context — on-goal-completed event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onGoalCompleted } from './on-goal-completed'
import type { GoalCompleted } from '#/contexts/goal/application/public-api'
import type { Queue } from 'bullmq'
import { organizationId, propertyId, goalId, userId } from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const GOAL_ID = goalId('goal-1')
const CREATOR_ID = userId('creator-1')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: GoalCompleted = {
  _tag: 'goal.completed',
  goalId: GOAL_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  portalId: null,
  portalGroupId: null,
  goalType: 'one_shot' as const,
  aggregationFunction: 'avg',
  metricKey: 'property.review',
  targetValue: 4.5,
  completedValue: 4.6,
  completedAt: NOW,
  parentGoalId: null,
  createdBy: CREATOR_ID,
}

function createFakeDeps() {
  const jobs: Array<{ name: string; data: unknown }> = []
  const addMock = vi.fn(async (name: string, data: unknown) => {
    jobs.push({ name, data })
  })
  const queue = { add: addMock } as unknown as Queue
  return { queue, addMock, jobs }
}

describe('onGoalCompleted (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a single notification for the goal creator', async () => {
    await onGoalCompleted(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs).toHaveLength(1)
    expect(deps.jobs[0]!.name).toBe(INSERT_NOTIFICATION_JOB_NAME)
    expect(deps.jobs[0]!.data).toEqual({
      userId: CREATOR_ID,
      organizationId: ORG_ID,
      type: 'goal.completed',
      resourceType: 'goal',
      resourceId: GOAL_ID,
      eventId: expect.any(String),
      title: 'Goal completed! 🎉',
      body: 'Your goal has been completed',
    })
  })

  it('generates a unique eventId via crypto.randomUUID', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const data = deps.jobs[0]!.data as { eventId: string }
    // Should be a valid UUID format
    expect(data.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('sends notification to the goal creator (createdBy)', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const data = deps.jobs[0]!.data as { userId: string }
    expect(data.userId).toBe(CREATOR_ID)
  })

  it('sets resourceType to goal', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const data = deps.jobs[0]!.data as { resourceType: string }
    expect(data.resourceType).toBe('goal')
  })

  it('uses the event goalId as resourceId', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const data = deps.jobs[0]!.data as { resourceId: string }
    expect(data.resourceId).toBe(GOAL_ID)
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onGoalCompleted(deps)(mockEvent)).rejects.toThrow('Queue unavailable')
  })
})
