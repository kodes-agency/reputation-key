// Reply lookup adapter — getEffectiveReplyByReviewId selection tests.
// The inbox detail must see mirror-only replies (google_sync) that the
// internal-only lookup used to hide — otherwise the panel renders a compose
// box over an existing Google-visible reply.

import { describe, it, expect, vi } from 'vitest'
import { createReplyLookupAdapter } from './reply-lookup.adapter'
import type {
  ReplyLookupPort,
  ReplyView,
} from '../../application/ports/reply-lookup.port'
import type { ReplyLookupSource } from '../../application/ports/lookup-sources.port'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const REVIEW = reviewId('d4000000-0000-4000-8000-000000000010')

const NOW = new Date('2026-07-19T12:00:00Z')

function makeReply(overrides: Partial<ReplyView> = {}): ReplyView {
  return {
    id: replyId('reply-1'),
    reviewId: REVIEW,
    organizationId: ORG,
    text: 'reply text',
    status: 'published',
    source: 'internal',
    createdBy: userId('user-1'),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: NOW,
    publicationState: 'published',
    publicationAttempts: 1,
    publicationCycle: 1,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const setup = (replies: ReadonlyArray<ReplyView>) =>
  createReplyLookupAdapter({
    findByReviewId: async () => replies,
    findMilestonesByReviewIds: async () => [],
  })

describe('getEffectiveReplyByReviewId', () => {
  it('returns the internal reply when both internal and mirror exist', async () => {
    const internal = makeReply({ id: replyId('internal-1'), source: 'internal' })
    const mirror = makeReply({ id: replyId('mirror-1'), source: 'google_sync' })
    const adapter = setup([mirror, internal])

    const result = await adapter.getEffectiveReplyByReviewId(REVIEW, ORG)

    expect(result?.id).toBe(replyId('internal-1'))
    expect(result?.source).toBe('internal')
  })

  it('falls back to the google_sync mirror when no internal reply exists', async () => {
    const mirror = makeReply({ id: replyId('mirror-1'), source: 'google_sync' })
    const adapter = setup([mirror])

    const result = await adapter.getEffectiveReplyByReviewId(REVIEW, ORG)

    expect(result?.id).toBe(replyId('mirror-1'))
    expect(result?.source).toBe('google_sync')
    expect(result?.status).toBe('published')
  })

  it('returns null when the review has no replies at all', async () => {
    const adapter = setup([])

    await expect(adapter.getEffectiveReplyByReviewId(REVIEW, ORG)).resolves.toBeNull()
  })
})

describe('getReplyMilestonesByReviewIds', () => {
  it('delegates the whole batch to one content-free source read', async () => {
    const secondReview = reviewId('d4000000-0000-4000-8000-000000000011')
    const firstSubmittedAt = new Date('2026-07-18T10:00:00Z')
    const firstPublishedAt = new Date('2026-07-19T10:00:00Z')
    const findMilestonesByReviewIds = vi.fn(async () => [
      {
        reviewId: REVIEW,
        firstSubmittedAt,
        firstPublishedAt,
      },
    ])
    const findByReviewId = vi.fn(async () => [])
    const source = {
      findByReviewId,
      findMilestonesByReviewIds,
    } as unknown as ReplyLookupSource
    const adapter = createReplyLookupAdapter(source) as ReplyLookupPort

    const result = await adapter.getReplyMilestonesByReviewIds(
      [REVIEW, secondReview],
      ORG,
    )

    expect(findMilestonesByReviewIds).toHaveBeenCalledOnce()
    expect(findMilestonesByReviewIds).toHaveBeenCalledWith([REVIEW, secondReview], ORG)
    expect(findByReviewId).not.toHaveBeenCalled()
    expect(result).toEqual(
      new Map([
        [
          REVIEW,
          {
            firstSubmittedAt,
            firstPublishedAt,
          },
        ],
      ]),
    )
  })
})
