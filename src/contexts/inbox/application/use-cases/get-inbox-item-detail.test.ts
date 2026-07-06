import { describe, it, expect } from 'vitest'
import { getInboxItemDetail } from './get-inbox-item-detail'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type {
  InboxItem,
  InboxItemDetail,
  InboxStatus,
  SourceType,
} from '../../domain/types'
import type { InboxRepository } from '../ports/inbox.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import { isInboxError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const ITEM_ID = inboxItemId('ii-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')

const adminStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const createScopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceType: 'review' as SourceType,
    sourceId: reviewId('rev-1'),
    status: 'new' as InboxStatus,
    rating: 4,
    sourceDate: FIXED_TIME,
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

function makeDetail(item: InboxItem): InboxItemDetail {
  return {
    item: { ...item, reviewerName: 'Test Reviewer' },
    reviewText: 'Test review',
    reviewerProfilePhotoUrl: null,
    feedbackComment: null,
    feedbackRatingValue: null,
  }
}

const setup = (staffApi: StaffPublicApi = adminStaffApi) => {
  let storedDetail: InboxItemDetail | null = null
  const repo: InboxRepository = {
    findById: async () => null,
    findBySource: async () => null,
    findFilteredPaginated: async () => ({ items: [], nextCursor: null }),
    create: async (item) => item,
    updateStatus: async () => storedDetail!.item,
    bulkUpdateStatus: async () => ({ updated: 0 }),
    updateAssignment: async () => storedDetail!.item,
    countByStatus: async () => 0,
    syncDenormalizedFields: async () => {},
    findByIds: async () => [],
    findDetailById: async (id, orgId) =>
      storedDetail &&
      storedDetail.item.id === id &&
      storedDetail.item.organizationId === orgId
        ? storedDetail
        : null,
  }
  return {
    repo,
    staffApi,
    setDetail: (d: InboxItemDetail) => {
      storedDetail = d
    },
  }
}

const adminInput = {
  userId: USER_ID,
  role: 'AccountAdmin' as const,
}

describe('getInboxItemDetail', () => {
  it('returns detail for a valid inbox item', async () => {
    const { repo, staffApi, setDetail } = setup()
    const item = makeItem()
    const detail = makeDetail(item)
    setDetail(detail)

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi })
    const result = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      ...adminInput,
    })

    expect(result.item.id).toBe(ITEM_ID)
    expect(result.item.reviewerName).toBe('Test Reviewer')
    expect(result.reviewText).toBe('Test review')
  })

  it('throws not_found when item does not exist', async () => {
    const { repo, staffApi } = setup()
    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi })

    await expect(
      useCase({
        inboxItemId: inboxItemId('nonexistent'),
        organizationId: ORG_ID,
        ...adminInput,
      }),
    ).rejects.toThrow('Inbox item not found')
  })

  it('does not return item from another organization', async () => {
    const { repo, staffApi, setDetail } = setup()
    const item = makeItem({ organizationId: OTHER_ORG_ID })
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi })

    await expect(
      useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID, ...adminInput }),
    ).rejects.toThrow('Inbox item not found')
  })

  it('denies access without inbox.read permission for inaccessible property', async () => {
    // Use a role not in the permission table to simulate lacking inbox.read
    const scopedApi = createScopedStaffApi([])
    const { repo, staffApi, setDetail } = setup(scopedApi)
    const item = makeItem()
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi })
    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        role: 'Guest' as unknown as Role,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    // PM holds inbox.read + inbox.manage, but per root CONTEXT.md L72 PM only
    // manages ASSIGNED properties. assertPropertyAccessible must enforce the
    // staff_assignment scope for PM, not bypass it.
    const scopedApi = createScopedStaffApi(['other-prop']) // PM lacks PROP_ID
    const { repo, staffApi, setDetail } = setup(scopedApi)
    const item = makeItem() // propertyId = PROP_ID ('prop-1')
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi })
    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        role: 'PropertyManager',
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows non-admin to access item for accessible property', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const { repo, staffApi, setDetail } = setup(scopedApi)
    const item = makeItem()
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi })
    const result = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'PropertyManager',
    })

    expect(result.item.id).toBe(ITEM_ID)
  })
})
