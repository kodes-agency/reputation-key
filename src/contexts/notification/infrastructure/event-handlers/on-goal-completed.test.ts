// Notification context — on-goal-completed event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onGoalCompleted } from './on-goal-completed'
import { createEventHandlerDeps, type FakeEventHandlerDeps } from './test-fixtures'
import type { GoalCompleted } from '#/contexts/goal/application/public-api'
import {
  organizationId,
  propertyId,
  portalGroupId,
  portalId,
  goalId,
  userId,
} from '#/shared/domain/ids'
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
  payload: Record<string, unknown>
}

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const GOAL_ID = goalId('goal-1')
const CREATOR_ID = userId('creator-1')
const MANAGER_1 = userId('mgr-1')
const MANAGER_2 = userId('mgr-2')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: GoalCompleted = {
  _tag: 'goal.completed',
  eventId: 'evt-goal-completed-1',
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  portalId: null,
  portalGroupId: null,
  goalId: GOAL_ID,
  goalType: 'one_shot' as const,
  aggregationFunction: 'avg',
  metricKey: 'property.review',
  targetValue: 4.5,
  completedValue: 4.6,
  completedAt: NOW,
  parentGoalId: null,
  createdBy: CREATOR_ID,
  occurredAt: NOW,
  correlationId: null,
}

describe('onGoalCompleted (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([MANAGER_1, MANAGER_2])
  })

  it('queries current Property Responsible Managers for a Property goal', async () => {
    await onGoalCompleted(deps)(mockEvent)

    expect(deps.responsibleManagers.findForProperty).toHaveBeenCalledWith(ORG_ID, PROP_ID)
  })

  it('enqueues one notification job per responsible manager', async () => {
    await onGoalCompleted(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(2)
    expect(deps.jobs).toHaveLength(2)
    for (const job of deps.jobs) {
      expect(job.name).toBe(INSERT_NOTIFICATION_JOB_NAME)
    }
  })

  it('never uses Staff attribution or goal creator as a recipient source', async () => {
    await onGoalCompleted(deps)(mockEvent)

    const recipientIds = deps.jobs.map((j) => {
      const data = j.data as GoalCompletedJobData
      return data.userId
    })
    expect(recipientIds).toEqual([MANAGER_1, MANAGER_2])
    expect(recipientIds).not.toContain(CREATOR_ID)
  })

  it('each job carries the goal facts, not hand-written copy', async () => {
    await onGoalCompleted(deps)(mockEvent)

    expect(deps.jobs[0]!.data).toEqual({
      userId: MANAGER_1,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      type: 'goal.completed',
      resourceType: 'goal',
      resourceId: GOAL_ID,
      eventId: 'evt-goal-completed-1',
      payload: { goalName: 'Weekend response time', propertyName: 'Riverside Hotel' },
      audience: {
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: PROP_ID },
      },
    })
  })

  it('resolves the goal name through the recognition lookup', async () => {
    await onGoalCompleted(deps)(mockEvent)

    expect(deps.recognitionLookup.findGoalFacts).toHaveBeenCalledWith(GOAL_ID, ORG_ID)
  })

  it('still notifies when the goal name cannot be resolved', async () => {
    deps.recognitionLookup.findGoalFacts.mockResolvedValue(null)

    await onGoalCompleted(deps)(mockEvent)

    expect(deps.jobs).toHaveLength(2)
    expect((deps.jobs[0]!.data as GoalCompletedJobData).payload).toEqual({})
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
    deps.responsibleManagers.findForProperty.mockResolvedValue([])
    deps.userLookup.findByRole.mockResolvedValue([])

    await onGoalCompleted(deps)(mockEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: undefined }),
      'onGoalCompleted: no recipients found, skipping',
    )
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onGoalCompleted(deps)(mockEvent)).rejects.toThrow('Queue unavailable')
  })

  it('uses Portal responsibility for a Portal goal', async () => {
    const portal = portalId('portal-1')
    deps.responsibleManagers.findForPortal.mockResolvedValue([MANAGER_1])

    await onGoalCompleted(deps)({ ...mockEvent, portalId: portal })

    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG_ID, portal)
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
    expect((deps.jobs[0]!.data as Record<string, unknown>).audience).toEqual({
      kind: 'responsible_scope',
      scope: { kind: 'portal', portalId: portal },
    })
  })

  it('uses deduplicated Portal Group responsibility for a Portal Group goal', async () => {
    const group = portalGroupId('group-1')
    deps.responsibleManagers.findForPortalGroup.mockResolvedValue([MANAGER_1])

    await onGoalCompleted(deps)({ ...mockEvent, portalGroupId: group })

    expect(deps.responsibleManagers.findForPortalGroup).toHaveBeenCalledWith(
      ORG_ID,
      group,
    )
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
    expect((deps.jobs[0]!.data as Record<string, unknown>).audience).toEqual({
      kind: 'responsible_scope',
      scope: { kind: 'portal_group', portalGroupId: group },
    })
  })
})
