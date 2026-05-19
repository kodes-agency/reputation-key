import { describe, it, expect } from 'vitest'
import { getInboxItemDetail } from './get-inbox-item-detail'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  InboxItem,
  InboxItemDetail,
  InboxStatus,
  SourceType,
} from '../../domain/types'
import type { InboxRepository } from '../ports/inbox.repository'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const ITEM_ID = inboxItemId('ii-1')
const PROP_ID = propertyId('prop-1')

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

const setup = () => {
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
    findDetailById: async (id, orgId) =>
      storedDetail &&
      storedDetail.item.id === id &&
      storedDetail.item.organizationId === orgId
        ? storedDetail
        : null,
  }
  return {
    repo,
    setDetail: (d: InboxItemDetail) => {
      storedDetail = d
    },
  }
}

describe('getInboxItemDetail', () => {
  it('returns detail for a valid inbox item', async () => {
    const { repo, setDetail } = setup()
    const item = makeItem()
    const detail = makeDetail(item)
    setDetail(detail)

    const useCase = getInboxItemDetail({ repo })
    const result = await useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID })

    expect(result.item.id).toBe(ITEM_ID)
    expect(result.reviewerName).toBe('Test Reviewer')
    expect(result.reviewText).toBe('Test review')
  })

  it('throws not_found when item does not exist', async () => {
    const { repo } = setup()
    const useCase = getInboxItemDetail({ repo })

    await expect(
      useCase({ inboxItemId: inboxItemId('nonexistent'), organizationId: ORG_ID }),
    ).rejects.toThrow('Inbox item not found')
  })

  it('does not return item from another organization', async () => {
    const { repo, setDetail } = setup()
    const item = makeItem({ organizationId: OTHER_ORG_ID })
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo })

    await expect(
      useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID }),
    ).rejects.toThrow('Inbox item not found')
  })
})
