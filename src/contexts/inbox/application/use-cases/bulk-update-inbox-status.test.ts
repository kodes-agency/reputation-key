import { describe, it, expect } from 'vitest'
import { bulkUpdateInboxStatus } from './bulk-update-inbox-status'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { UnreadCounterPort } from '../ports/unread-counter.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')

function seedItem(id: string, status: InboxStatus, propId: string = 'prop-1'): InboxItem {
  return {
    id: inboxItemId(id),
    organizationId: ORG_ID,
    propertyId: propertyId(propId),
    sourceType: 'review' as SourceType,
    sourceId: reviewId(`rev-${id}`),
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
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  }
}

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  findByReferralCode: async () => null,
}

const setup = (staffApi: StaffPublicApi = defaultStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const decrements: Array<string> = []
  const unreadCounter: UnreadCounterPort = {
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
    unreadCounter,
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

  it('emits events for each updated item', async () => {
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

    const emitted = events.capturedByTag('inbox.status.changed')
    expect(emitted).toHaveLength(2)
  })

  it('decrements unread counter for new→read transitions', async () => {
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

  it('filters out items from inaccessible properties for Staff (no inbox.manage)', async () => {
    // Staff does NOT have inbox.manage, so the property access check fires
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      findByReferralCode: async () => null,
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
      findByReferralCode: async () => null,
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
