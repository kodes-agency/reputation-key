import { describe, it, expect } from 'vitest'
import { getInboxItemDetail } from './get-inbox-item-detail'
import {
  inboxItemId,
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type {
  InboxItem,
  InboxItemDetail,
  InboxStatus,
  SourceType,
} from '../../domain/types'
import type { ReplyLookupPort, ReplyView } from '../ports/reply-lookup.port'
import type { InboxRepository } from '../ports/inbox.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
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
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
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
    reviewContentStatus: 'available',
    feedbackComment: null,
    feedbackRatingValue: null,
  }
}

function makeReply(): ReplyView {
  return {
    id: replyId('reply-1'),
    reviewId: reviewId('rev-1'),
    organizationId: ORG_ID,
    text: 'Drafted reply',
    status: 'draft',
    source: 'internal',
    createdBy: USER_ID,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  }
}

const setup = (
  staffApi: StaffPublicApi = adminStaffApi,
  reply: ReplyView | null = null,
) => {
  let storedDetail: InboxItemDetail | null = null
  const replyCalls: string[] = []
  const repo: InboxRepository = {
    findById: async () => null,
    findBySource: async () => null,
    findFilteredPaginated: async () => ({ items: [], nextCursor: null }),
    create: async (item) => item,
    updateStatus: async () => storedDetail!.item,
    bulkUpdateStatus: async () => ({ updated: 0 }),
    updateAssignment: async () => storedDetail!.item,
    countByStatus: async () => 0,
    findByIds: async () => [],
    setEscalation: vi.fn(),
    resolveEscalation: vi.fn(),
    countEscalatedActive: vi.fn(async () => 0),
    countOpenSince: vi.fn(async () => 0),
    findDetailById: async (id, orgId) =>
      storedDetail &&
      storedDetail.item.id === id &&
      storedDetail.item.organizationId === orgId
        ? storedDetail
        : null,
  }
  const replyLookup: ReplyLookupPort = {
    getReplyByReviewId: async (id) => {
      replyCalls.push(id)
      return reply
    },
  }
  return {
    repo,
    staffApi,
    replyLookup,
    replyCalls,
    setDetail: (d: InboxItemDetail) => {
      storedDetail = d
    },
  }
}

const ctxFor = (role: Role): AuthContext =>
  ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

describe('getInboxItemDetail', () => {
  it('returns detail for a valid inbox item', async () => {
    const reply = makeReply()
    const { repo, staffApi, replyLookup, replyCalls, setDetail } = setup(
      adminStaffApi,
      reply,
    )
    setDetail(makeDetail(makeItem()))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result.item.id).toBe(ITEM_ID)
    expect(result.item.reviewerName).toBe('Test Reviewer')
    expect(result.reviewText).toBe('Test review')
    // AccountAdmin holds reply.manage → reply is attached for review items.
    expect(result.reply).toEqual(reply)
    expect(replyCalls).toHaveLength(1)
  })

  it('throws not_found when item does not exist', async () => {
    const { repo, staffApi, replyLookup } = setup()
    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })

    await expect(
      useCase({ inboxItemId: inboxItemId('nonexistent') }, ctxFor('AccountAdmin')),
    ).rejects.toThrow('Inbox item not found')
  })

  it('does not return item from another organization', async () => {
    const { repo, staffApi, replyLookup, setDetail } = setup()
    const item = makeItem({ organizationId: OTHER_ORG_ID })
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin')),
    ).rejects.toThrow('Inbox item not found')
  })

  it('denies access without inbox.read permission for inaccessible property', async () => {
    // Use a role not in the permission table to simulate lacking inbox.read
    const scopedApi = createScopedStaffApi([])
    const { repo, staffApi, replyLookup, setDetail } = setup(scopedApi)
    const item = makeItem()
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })
    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('Guest' as unknown as Role)),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    // PM holds inbox.read + inbox.manage, but per root CONTEXT.md L72 PM only
    // manages ASSIGNED properties. assertPropertyAccessible must enforce the
    // staff_assignment scope for PM, not bypass it.
    const scopedApi = createScopedStaffApi(['other-prop']) // PM lacks PROP_ID
    const { repo, staffApi, replyLookup, setDetail } = setup(scopedApi)
    const item = makeItem() // propertyId = PROP_ID ('prop-1')
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })
    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('PropertyManager')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows non-admin to access item for accessible property', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const { repo, staffApi, replyLookup, setDetail } = setup(scopedApi)
    const item = makeItem()
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('PropertyManager'))

    expect(result.item.id).toBe(ITEM_ID)
  })

  // ── Reply permission gate (#4) ─────────────────────────────────────
  // reply.manage is a field-level scope: Staff (who have inbox.read but NOT
  // reply.manage) must receive reply === null and the lookup must NOT be called
  // — preventing reply data from leaking to Staff in the detail payload.

  it('attaches the reply for a manager on a review item', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const reply = makeReply()
    const { repo, staffApi, replyLookup, replyCalls, setDetail } = setup(scopedApi, reply)
    setDetail(makeDetail(makeItem()))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('PropertyManager'))

    expect(result.reply).toEqual(reply)
    expect(replyCalls).toHaveLength(1)
  })

  it('does NOT attach reply for Staff and never calls the lookup', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const reply = makeReply()
    const { repo, staffApi, replyLookup, replyCalls, setDetail } = setup(scopedApi, reply)
    setDetail(makeDetail(makeItem()))

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('Staff'))

    expect(result.reply).toBeNull()
    expect(replyCalls).toHaveLength(0)
  })

  it('does not call the lookup for feedback items (no reply concept)', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const reply = makeReply()
    const { repo, staffApi, replyLookup, replyCalls, setDetail } = setup(scopedApi, reply)
    setDetail(
      makeDetail(
        makeItem({ sourceType: 'feedback', sourceId: 'fb-1' as InboxItem['sourceId'] }),
      ),
    )

    const useCase = getInboxItemDetail({ repo, staffPublicApi: staffApi, replyLookup })
    const result = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(result.reply).toBeNull()
    expect(replyCalls).toHaveLength(0)
  })
})
