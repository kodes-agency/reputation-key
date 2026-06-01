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
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('ii-1')
const ASSIGNEE_ID = userId('user-2')
const USER_ID = userId('user-1')
const PROP_1 = propertyId('prop-1')
const PROP_OTHER = propertyId('prop-other')

const seedItem = (): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_1,
  sourceType: 'review' as SourceType,
  sourceId: reviewId('rev-1'),
  status: 'new' as InboxStatus,
  rating: 4,
  sourceDate: new Date('2026-04-10'),
  platform: 'google',
  snippet: 'Great!',
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  readAt: null,
  escalatedAt: null,
  addressedAt: null,
  archivedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
})

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
}

const setup = (staffApi: StaffPublicApi = defaultStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const deps = { repo, events, clock: () => FIXED_TIME, staffPublicApi: staffApi }
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
      role: 'PropertyManager' as Role,
      userId: USER_ID,
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
      role: 'AccountAdmin' as Role,
      userId: USER_ID,
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
        role: 'Staff' as Role,
        userId: USER_ID,
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
        role: 'PropertyManager' as Role,
        userId: USER_ID,
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
      role: 'PropertyManager' as Role,
      userId: USER_ID,
    })

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.item.assigned')
  })

  it('emits inbox.item.unassigned event when unassigning (assignedToUserId is null)', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push({ ...seedItem(), assignedTo: ASSIGNEE_ID })

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      assignedToUserId: null,
      role: 'PropertyManager' as Role,
      userId: USER_ID,
    })

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.item.unassigned')
  })

  it('allows PropertyManager to assign item for any property (inbox.manage bypasses property check)', async () => {
    // PropertyManager has inbox.manage, so can() passes and the property access check is skipped
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_OTHER],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    const updated = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      assignedToUserId: ASSIGNEE_ID,
      role: 'PropertyManager' as Role,
      userId: USER_ID,
    })

    expect(updated.assignedTo).toBe(ASSIGNEE_ID)
  })

  it('denies access for role without inbox.write permission', async () => {
    // Roles without inbox.write hit the auth gate before validateAssignment
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        assignedToUserId: ASSIGNEE_ID,
        role: 'Guest' as unknown as Role,
        userId: USER_ID,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows assignment when user has access to the property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem())

    const updated = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      assignedToUserId: ASSIGNEE_ID,
      role: 'PropertyManager' as Role,
      userId: USER_ID,
    })

    expect(updated.assignedTo).toBe(ASSIGNEE_ID)
  })
})
