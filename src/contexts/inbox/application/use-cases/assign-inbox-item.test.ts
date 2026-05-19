import { describe, it, expect } from 'vitest'
import { assignInboxItem } from './assign-inbox-item'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { isInboxError } from '../../domain/errors'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('ii-1')
const ASSIGNEE_ID = userId('user-2')

const seedItem = (): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: propertyId('prop-1'),
  sourceType: 'review' as SourceType,
  sourceId: reviewId('rev-1'),
  status: 'new' as InboxStatus,
  rating: 4,
  sourceDate: new Date('2026-04-10'),
  platform: 'google',
  snippet: 'Great!',
  assignedTo: null,
  readAt: null,
  escalatedAt: null,
  addressedAt: null,
  archivedAt: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
})

const setup = () => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const deps = { repo, events, clock: () => FIXED_TIME }
  const useCase = assignInboxItem(deps)
  return { useCase, repo, events }
}

describe('assignInboxItem', () => {
  it('allows PropertyManager to assign an item', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem())

    const updated = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      assignedToUserId: ASSIGNEE_ID,
      role: 'PropertyManager',
    })

    expect(updated.assignedTo).toBe(ASSIGNEE_ID)
  })

  it('allows AccountAdmin to assign an item', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem())

    const updated = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      assignedToUserId: ASSIGNEE_ID,
      role: 'AccountAdmin',
    })

    expect(updated.assignedTo).toBe(ASSIGNEE_ID)
  })

  it('rejects Staff role with assignment_not_allowed', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem())

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        assignedToUserId: ASSIGNEE_ID,
        role: 'Staff',
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'assignment_not_allowed',
    )
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        assignedToUserId: ASSIGNEE_ID,
        role: 'PropertyManager',
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('emits inbox.item.assigned event when assigning to a user', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedItem())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      assignedToUserId: ASSIGNEE_ID,
      role: 'PropertyManager',
    })

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.item.assigned')
  })

  it('does not emit event when unassigning (assignedToUserId is null)', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedItem())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      assignedToUserId: null,
      role: 'PropertyManager',
    })

    expect(events.capturedEvents).toHaveLength(0)
  })
})
