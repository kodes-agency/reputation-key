// Notification context — on-goal-completed event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onGoalCompleted } from './on-goal-completed'
import { createEventHandlerDeps, type FakeEventHandlerDeps } from './test-fixtures'
import type { GoalCompleted } from '#/contexts/goal/application/public-api'
import { organizationId, propertyId, goalId, userId } from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { UserId, OrganizationId } from '#/shared/domain/ids'

// Shape of the InsertNotificationJobData payload enqueued by onGoalCompleted.
// The fake queue records `data: unknown`; this named cast documents the
// expected shape at the assertion boundary (per repo cast convention).
type GoalCompletedJobData = {
  userId: UserId
  organizationId: OrganizationId
  type: 'goal.completed'
  resourceType: 'goal'
  resourceId: string
  eventId: string
  title: string
  body: string
}

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const GOAL_ID = goalId('goal-1')
const CREATOR_ID = userId('creator-1')
const MANAGER_1 = userId('mgr-1')
const MANAGER_2 = userId('mgr-2')
const STAFF_1 = userId('staff-1')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: GoalCompleted = {
  _tag: 'goal.completed',
  eventId: 'evt-goal-completed-1',
  correlationId: null,
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

describe('onGoalCompleted (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
    deps.userLookup.findAssignedManagers.mockResolvedValue([
      MANAGER_1,
      MANAGER_2,
      STAFF_1,
    ])
  })

  it('queries recipients by org and property (managers + staff, not creator)', async () => {
    await onGoalCompleted(deps)(mockEvent)

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(ORG_ID, PROP_ID)
  })

  it('enqueues one notification job per assigned manager/staff', async () => {
    await onGoalCompleted(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(3)
    expect(deps.jobs).toHaveLength(3)
    for (const job of deps.jobs) {
      expect(job.name).toBe(INSERT_NOTIFICATION_JOB_NAME)
    }
  })

  it('sends notifications to assigned managers/staff, NOT the goal creator', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const recipientIds = deps.jobs.map((j) => {
      const data = j.data as GoalCompletedJobData
      return data.userId
    })
    expect(recipientIds).toEqual([MANAGER_1, MANAGER_2, STAFF_1])
    expect(recipientIds).not.toContain(CREATOR_ID)
  })

  it('each job carries the goal.completed payload', async () => {
    await onGoalCompleted(deps)(mockEvent)

    expect(deps.jobs[0]!.data).toEqual({
      userId: MANAGER_1,
      organizationId: ORG_ID,
      type: 'goal.completed',
      resourceType: 'goal',
      resourceId: GOAL_ID,
      eventId: 'evt-goal-completed-1',
      title: 'Goal completed! 🎉',
      body: 'A goal on your property has been completed',
    })
  })

  it('propagates eventId from the domain event', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const data = deps.jobs[0]!.data as GoalCompletedJobData
    expect(data.eventId).toBe('evt-goal-completed-1')
  })

  it('sets resourceType to goal', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const data = deps.jobs[0]!.data as GoalCompletedJobData
    expect(data.resourceType).toBe('goal')
  })

  it('uses the event goalId as resourceId', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const data = deps.jobs[0]!.data as GoalCompletedJobData
    expect(data.resourceId).toBe(GOAL_ID)
  })

  it('uses retry with exponential backoff (matches badge-awarded contract)', async () => {
    await onGoalCompleted(deps)(mockEvent)

    for (const job of deps.jobs) {
      expect(job.opts).toEqual({
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      })
    }
  })

  it('skips silently when no recipients found', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onGoalCompleted(deps)(mockEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: PROP_ID, eventId: 'evt-goal-completed-1' }),
      'onGoalCompleted: no recipients found, skipping',
    )
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onGoalCompleted(deps)(mockEvent)).rejects.toThrow('Queue unavailable')
  })
})
