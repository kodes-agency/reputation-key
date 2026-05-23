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

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const ITEM_ID = inboxItemId('ii-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')

const adminStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
    findByReferralCode: async () => null,
}

const createScopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
    findByReferralCode: async () => null,
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
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

function makeDetail(item: InboxItem): InboxItemDetail {
  return {
    item,
    reviewerName: 'Test Reviewer',
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
    expect(result.reviewerName).toBe('Test Reviewer')
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

  it('throws forbidden when non-admin accesses item for inaccessible property', async () => {
    const scopedApi = createScopedStaffApi(['other-prop'])
    const { repo, staffApi, setDetail } = setup(scopedApi)
    const item = makeItem()
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi })

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        role: 'PropertyManager',
      }),
    ).rejects.toThrow('No access to this property')
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
