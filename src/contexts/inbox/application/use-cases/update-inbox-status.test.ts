import { describe, it, expect } from 'vitest'
import { updateInboxStatus } from './update-inbox-status'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { isInboxError } from '../../domain/errors'
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
const ITEM_ID = inboxItemId('ii-1')
const USER_ID = userId('user-1')

function seedNew(overrides?: Partial<InboxItem>): InboxItem {
  return {
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
    ...overrides,
  }
}

const staffApiAllAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const setup = (staffApi: StaffPublicApi = staffApiAllAccess) => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const decrements: Array<{ orgId: string }> = []
  const newCounter: NewCounterPort = {
    getCount: async () => 0,
    setCount: async () => {},
    increment: async () => {},
    decrement: async (orgId) => {
      decrements.push({ orgId: orgId as string })
    },
    decrementBy: async () => {},
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
  const useCase = updateInboxStatus(deps)
  return { useCase, repo, events, decrements }
}

describe('updateInboxStatus', () => {
  it('transitions new → read successfully', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedNew())

    const updated = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    expect(updated.status).toBe('read')
    expect(updated.readAt).toBe(FIXED_TIME)
  })

  it('throws invalid_transition for invalid transition', async () => {
    const { useCase, repo } = setup()
    // Same-status is always invalid
    repo.items.push(seedNew({ status: 'new' }))

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'new',
        userId: USER_ID,
        role: 'AccountAdmin' as Role,
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'invalid_transition',
    )
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'read',
        userId: USER_ID,
        role: 'AccountAdmin' as Role,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('decrements new counter when transitioning new → read', async () => {
    const { useCase, repo, decrements } = setup()
    repo.items.push(seedNew())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    expect(decrements).toHaveLength(1)
    expect(decrements[0].orgId).toBe(ORG_ID as string)
  })

  it('decrements new counter for all new → * transitions', async () => {
    const { useCase, repo, decrements } = setup()
    repo.items.push(seedNew())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'escalated',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    expect(decrements).toHaveLength(1)
  })

  it('emits inbox.status.changed event', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedNew())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.status_changed')
  })

  it('denies access without inbox.write permission for inaccessible property', async () => {
    // Use a role not in the permission table to simulate lacking inbox.write
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedNew())

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'read',
        userId: USER_ID,
        role: 'Guest' as unknown as Role,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows update when user has access to the property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedNew())

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'read',
        userId: USER_ID,
        role: 'PropertyManager' as Role,
      }),
    ).resolves.toBeDefined()
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    // PM holds inbox.manage, but per root CONTEXT.md L72 PM only manages
    // ASSIGNED properties. assertPropertyAccessible must therefore enforce
    // the staff_assignment scope for PM, not bypass it.
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-assigned')],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    // Item is on a property PM is NOT assigned to
    repo.items.push(seedNew({ propertyId: propertyId('prop-other') }))

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'read',
        userId: USER_ID,
        role: 'PropertyManager' as Role,
      }),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'forbidden' })

    // Sanity: the item is untouched
    expect(repo.items[0]!.status).toBe('new')
  })

  it('allows PropertyManager to update status for an assigned property', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedNew())

    const updated = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'PropertyManager' as Role,
    })

    expect(updated.status).toBe('read')
  })

  it('rejects manual "addressed" on a review item (reviews auto-transition via reply.published)', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedNew({ sourceType: 'review' as SourceType }))

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'addressed',
        userId: USER_ID,
        role: 'AccountAdmin' as Role,
      }),
    ).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'invalid_transition',
    })

    expect(repo.items[0]!.status).toBe('new')
  })

  it('allows manual "addressed" on a feedback item', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      seedNew({ sourceType: 'feedback' as SourceType, sourceId: feedbackId('fb-1') }),
    )

    const updated = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'addressed',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    expect(updated.status).toBe('addressed')
  })

  it('skips property check for AccountAdmin role', async () => {
    const staffApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => {
        throw new Error('Should not be called')
      },
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const { useCase, repo } = setup(staffApi)
    repo.items.push(seedNew())

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'read',
        userId: USER_ID,
        role: 'AccountAdmin' as Role,
      }),
    ).resolves.toBeDefined()
  })

  it('emits inbox.item.escalated event alongside inbox.status.changed when escalating', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedNew())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'escalated',
      userId: USER_ID,
      role: 'AccountAdmin' as Role,
    })

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(2)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.status_changed')
    expect(emitted[1]._tag).toBe('inbox.inbox_item.escalated')
  })
})
