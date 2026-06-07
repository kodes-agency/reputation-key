import { describe, it, expect } from 'vitest'
import { bulkUpdateInboxStatus } from './bulk-update-inbox-status'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { NewCounterPort } from '../ports/new-counter.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')

function seedItem(
  id: string,
  status: InboxStatus,
  propId: string = 'prop-1',
  sourceType: SourceType = 'review',
): InboxItem {
  return {
    id: inboxItemId(id),
    organizationId: ORG_ID,
    propertyId: propertyId(propId),
    sourceType,
    sourceId: sourceType === 'review' ? reviewId(`rev-${id}`) : feedbackId(`fb-${id}`),
    status,
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
  }
}

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const setup = (staffApi: StaffPublicApi = defaultStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const decrements: Array<string> = []
  const newCounter: NewCounterPort = {
    getCount: async () => 0,
    setCount: async () => {},
    increment: async () => {},
    decrement: async (orgId) => {
      decrements.push(orgId as string)
    },
    invalidate: async () => {},
  }
  const deps = {
    repo,
    events,
    newCounter,
    clock: () => FIXED_TIME,
    staffPublicApi: staffApi,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
    } as never,
  }
  const useCase = bulkUpdateInboxStatus(deps)
  return { useCase, repo, events, decrements }
}

describe('bulkUpdateInboxStatus', () => {
  it('updates multiple items with valid transitions', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'new'))
    repo.items.push(seedItem('ii-2', 'new'))

    const result = await useCase({
      inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    expect(result.updated).toBe(2)
    expect(repo.items[0].status).toBe('read')
    expect(repo.items[1].status).toBe('read')
  })

  it('skips items with invalid transitions', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'new'))
    repo.items.push(seedItem('ii-2', 'archived'))

    const result = await useCase({
      inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    // ii-1: new→read (valid), ii-2: archived→read (invalid — archived is terminal)
    expect(result.updated).toBe(1)
    expect(repo.items[0].status).toBe('read')
    expect(repo.items[1].status).toBe('archived')
  })

  it('returns 0 when all transitions are invalid', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'addressed'))

    const result = await useCase({
      inboxItemIds: [inboxItemId('ii-1')],
      organizationId: ORG_ID,
      newStatus: 'new', // addressed → new is invalid
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    expect(result.updated).toBe(0)
  })

  it('emits bulk status changed events for each updated item with shared bulkId', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedItem('ii-1', 'new'))
    repo.items.push(seedItem('ii-2', 'new'))

    await useCase({
      inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    const emitted = events.capturedByTag('inbox.inbox_item.bulk_status_changed')
    expect(emitted).toHaveLength(2)
    const bulkIds = emitted.map((e) => e.bulkId)
    expect(bulkIds[0]).toBeTruthy()
    expect(new Set(bulkIds).size).toBe(1) // all events share the same bulkId
  })

  it('decrements new counter for new→read transitions', async () => {
    const { useCase, repo, decrements } = setup()
    repo.items.push(seedItem('ii-1', 'new'))
    repo.items.push(seedItem('ii-2', 'new'))

    await useCase({
      inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    expect(decrements).toHaveLength(2)
  })

  it('skips reviews when bulk marking as addressed (review guard)', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem('ii-1', 'new', 'prop-1', 'review'))
    repo.items.push(seedItem('ii-2', 'new', 'prop-1', 'feedback'))

    const result = await useCase({
      inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
      organizationId: ORG_ID,
      newStatus: 'addressed',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    // ii-1 (review) skipped by guard, ii-2 (feedback) updated
    expect(result.updated).toBe(1)
    expect(repo.items[0].status).toBe('new')
    expect(repo.items[1].status).toBe('addressed')
  })

  it('denies access to all items without inbox.manage when Staff has no property assignments', async () => {
    // Staff does NOT have inbox.manage, so the property access check fires
    // When accessible properties are empty, all items are skipped (returns 0 updated)
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'new', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'new', 'prop-2'))

    const result = await useCase({
      inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'Staff' as Role,
    })

    // All items filtered out because Staff has no accessible properties
    expect(result.updated).toBe(0)
    expect(repo.items[0].status).toBe('new')
    expect(repo.items[1].status).toBe('new')
  })

  it('filters out items from inaccessible properties for Staff (no inbox.manage)', async () => {
    // Staff does NOT have inbox.manage, so the property access check fires
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'new', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'new', 'prop-2'))

    const result = await useCase({
      inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'Staff' as Role,
    })

    expect(result.updated).toBe(1)
    expect(repo.items[0].status).toBe('read')
    expect(repo.items[1].status).toBe('new')
  })

  it('processes all items for AccountAdmin', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => {
        throw new Error('Should not be called for AccountAdmin')
      },
      getAssignedPortals: async () => [],
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedItem('ii-1', 'new', 'prop-1'))
    repo.items.push(seedItem('ii-2', 'new', 'prop-2'))

    const result = await useCase({
      inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    expect(result.updated).toBe(2)
    expect(repo.items[0].status).toBe('read')
    expect(repo.items[1].status).toBe('read')
  })
})
