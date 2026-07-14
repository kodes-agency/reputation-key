import { describe, it, expect } from 'vitest'
import { getInboxItems } from './get-inbox-items'
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
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { isInboxError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const PROP_ID = propertyId('prop-1')
const OTHER_PROP_ID = propertyId('prop-2')
const USER_ID = userId('user-1')

// Mock: AccountAdmin gets null (all access)
const adminStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

// Mock: Staff gets specific property IDs (scoped)
const createScopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

function seedItem(overrides: Omit<Partial<InboxItem>, 'id'> & { id: string }): InboxItem {
  const { id, ...restOverrides } = overrides
  const base = {
    id: inboxItemId(id),
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceType: 'review' as SourceType,
    sourceId: reviewId(`rev-${id}`),
    status: 'open' as InboxStatus,
    rating: 4,
    sourceDate: new Date('2026-04-10'),
    platform: 'google',
    snippet: 'Great!',
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null as Date | null,
    firstReplyPublishedAt: null as Date | null,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...(restOverrides as Partial<InboxItem>),
  } satisfies InboxItem
  return base
}

const setup = (staffApi: StaffPublicApi = adminStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const deps = { repo, staffPublicApi: staffApi }
  const useCase = getInboxItems(deps)
  return { useCase, repo }
}

const adminCtx = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'AccountAdmin' as const,
} as AuthContext

const pmCtx = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'PropertyManager' as const,
} as AuthContext

const staffCtx = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Staff' as const,
} as AuthContext

describe('getInboxItems', () => {
  it('returns paginated items for an organization', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1' }))
    repo.items.push(seedItem({ id: 'ii-2' }))

    const result = await useCase({ filters: {} }, adminCtx)

    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).toBeDefined()
  })

  it('filters by status', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', status: 'open' }))
    repo.items.push(seedItem({ id: 'ii-2', status: 'closed' }))

    const result = await useCase({ filters: { status: 'open' } }, adminCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].status).toBe('open')
  })

  it('filters by sourceType', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', sourceType: 'review' }))
    repo.items.push(
      seedItem({ id: 'ii-2', sourceType: 'feedback', sourceId: feedbackId('fb-ii-2') }),
    )

    const result = await useCase({ filters: { sourceType: 'feedback' } }, adminCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].sourceType).toBe('feedback')
  })

  it('filters by propertyId', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', propertyId: PROP_ID }))
    repo.items.push(seedItem({ id: 'ii-2', propertyId: OTHER_PROP_ID }))

    const result = await useCase({ filters: { propertyId: PROP_ID } }, adminCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].propertyId).toBe(PROP_ID)
  })

  it('does not return items from other organizations', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', organizationId: ORG_ID }))
    repo.items.push(seedItem({ id: 'ii-2', organizationId: OTHER_ORG_ID }))

    const result = await useCase({ filters: {} }, adminCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe(inboxItemId('ii-1'))
  })

  it('respects limit for pagination', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', sourceDate: new Date('2026-04-12') }))
    repo.items.push(seedItem({ id: 'ii-2', sourceDate: new Date('2026-04-11') }))
    repo.items.push(seedItem({ id: 'ii-3', sourceDate: new Date('2026-04-10') }))

    const result = await useCase({ filters: {}, limit: 2 }, adminCtx)

    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).toBeDefined()
  })

  it('uses cursor for pagination', async () => {
    const { useCase, repo } = setup()
    const item1 = seedItem({ id: 'ii-1', sourceDate: new Date('2026-04-12') })
    const item2 = seedItem({ id: 'ii-2', sourceDate: new Date('2026-04-11') })
    const item3 = seedItem({ id: 'ii-3', sourceDate: new Date('2026-04-10') })
    repo.items.push(item1, item2, item3)

    // First page
    const page1 = await useCase({ filters: {}, limit: 1 }, adminCtx)

    expect(page1.items).toHaveLength(1)
    expect(page1.nextCursor).toBeDefined()

    // Second page using cursor
    const page2 = await useCase(
      { filters: {}, cursor: page1.nextCursor!, limit: 1 },
      adminCtx,
    )

    expect(page2.items).toHaveLength(1)
    expect(page2.items[0].id).not.toBe(page1.items[0].id)
  })

  // ── Property scoping tests (F-14 fix) ──────────────────────────────

  it('AccountAdmin sees all properties (org-wide role bypass)', async () => {
    const { useCase, repo } = setup(adminStaffApi)
    repo.items.push(seedItem({ id: 'ii-1', propertyId: PROP_ID }))
    repo.items.push(seedItem({ id: 'ii-2', propertyId: OTHER_PROP_ID }))

    const result = await useCase({ filters: {} }, adminCtx)

    expect(result.items).toHaveLength(2)
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    // PM holds inbox.manage, but per root CONTEXT.md L72 PM only manages
    // ASSIGNED properties — the read path must scope PM via staff_assignment.
    const scopedApi = createScopedStaffApi(['prop-1'])
    const { useCase, repo } = setup(scopedApi)
    repo.items.push(seedItem({ id: 'ii-1', propertyId: PROP_ID }))
    repo.items.push(seedItem({ id: 'ii-2', propertyId: OTHER_PROP_ID }))

    const result = await useCase({ filters: {} }, pmCtx)

    // Only the assigned property's item is visible
    expect(result.items).toHaveLength(1)
    expect(result.items[0].propertyId).toBe(PROP_ID)
  })

  it('allows PropertyManager to filter by an assigned property', async () => {
    const scopedApi = createScopedStaffApi(['prop-1'])
    const { useCase, repo } = setup(scopedApi)
    repo.items.push(seedItem({ id: 'ii-1', propertyId: PROP_ID }))

    const result = await useCase({ filters: { propertyId: PROP_ID } }, pmCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].propertyId).toBe(PROP_ID)
  })

  it('denies PropertyManager when filtering by an unassigned property', async () => {
    const scopedApi = createScopedStaffApi(['prop-1'])
    const { useCase, repo } = setup(scopedApi)
    repo.items.push(seedItem({ id: 'ii-1', propertyId: PROP_ID }))

    await expect(
      useCase({ filters: { propertyId: OTHER_PROP_ID } }, pmCtx),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('Staff is property-scoped to accessible properties only', async () => {
    const scopedApi = createScopedStaffApi(['prop-1'])
    const { useCase, repo } = setup(scopedApi)
    repo.items.push(seedItem({ id: 'ii-1', propertyId: PROP_ID }))
    repo.items.push(seedItem({ id: 'ii-2', propertyId: OTHER_PROP_ID }))

    const result = await useCase({ filters: {} }, staffCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].propertyId).toBe(PROP_ID)
  })

  it('Staff with no accessible properties sees nothing', async () => {
    const scopedApi = createScopedStaffApi([])
    const { useCase, repo } = setup(scopedApi)
    repo.items.push(seedItem({ id: 'ii-1' }))

    const result = await useCase({ filters: {} }, staffCtx)

    expect(result.items).toHaveLength(0)
  })

  it('Staff denied when filtering by inaccessible property', async () => {
    const scopedApi = createScopedStaffApi(['prop-1'])
    const { useCase, repo } = setup(scopedApi)
    repo.items.push(seedItem({ id: 'ii-1' }))

    await expect(
      useCase({ filters: { propertyId: OTHER_PROP_ID } }, staffCtx),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('Staff can filter by accessible property', async () => {
    const scopedApi = createScopedStaffApi(['prop-1'])
    const { useCase, repo } = setup(scopedApi)
    repo.items.push(seedItem({ id: 'ii-1', propertyId: PROP_ID }))

    const result = await useCase({ filters: { propertyId: PROP_ID } }, staffCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].propertyId).toBe(PROP_ID)
  })
})
