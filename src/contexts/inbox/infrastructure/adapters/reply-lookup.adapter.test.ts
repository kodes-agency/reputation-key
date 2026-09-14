// Reply lookup adapter — getEffectiveReplyByReviewId selection tests.
// The inbox detail must see mirror-only replies (google_sync) that the
// internal-only lookup used to hide — otherwise the panel renders a compose
// box over an existing Google-visible reply.

import { describe, it, expect, vi } from 'vitest'
import { createReplyLookupAdapter } from './reply-lookup.adapter'
import type {
  ReplyEntityView,
  ReplyLookupPort,
} from '../../application/ports/reply-lookup.port'
import type { ReplyLookupSource } from '../../application/ports/lookup-sources.port'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const REVIEW = reviewId('d4000000-0000-4000-8000-000000000010')

const NOW = new Date('2026-07-19T12:00:00Z')

function makeReply(overrides: Partial<ReplyEntityView> = {}): ReplyEntityView {
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
    templateId: overrides.templateId ?? null,
    templateVersion: overrides.templateVersion ?? null,
  }
}

const setup = (replies: ReadonlyArray<ReplyEntityView>) =>
  createReplyLookupAdapter({
    findByReviewId: async () => replies,
    getCurrentGoogleReplyByReviewId: async () => null,
    findMilestonesByReviewIds: async () => [],
    findStatesByReviewIds: async () => [],
    findReviewIdsByReplyStage: async () => [],
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

  it('serves a current external Google observation after its legacy mirror is removed', async () => {
    const observedAt = new Date('2026-07-19T11:00:00Z')
    const providerUpdatedAt = new Date('2026-07-14T09:30:00Z')
    const adapter = createReplyLookupAdapter({
      findByReviewId: async () => [],
      getCurrentGoogleReplyByReviewId: async () => ({
        id: 'observation-1',
        reviewId: REVIEW,
        organizationId: ORG,
        text: 'Thank you for your review.',
        observationRevision: 3,
        provenance: 'external_or_unknown',
        matchedReplyId: null,
        providerUpdatedAt,
        observedAt,
      }),
      findMilestonesByReviewIds: async () => [],
      findStatesByReviewIds: async () => [],
      findReviewIdsByReplyStage: async () => [],
    })

    const result = await adapter.getEffectiveReplyByReviewId(REVIEW, ORG)

    expect(result).toMatchObject({
      kind: 'google_observation',
      id: 'observation-1',
      source: 'google_sync',
      status: 'published',
      text: 'Thank you for your review.',
      publishedAt: providerUpdatedAt,
      updatedAt: observedAt,
    })
  })

  it('keeps the internal reply when the current Google observation confirms it', async () => {
    const internal = makeReply({ id: replyId('internal-1') })
    const adapter = createReplyLookupAdapter({
      findByReviewId: async () => [internal],
      getCurrentGoogleReplyByReviewId: async () => ({
        id: 'observation-1',
        reviewId: REVIEW,
        organizationId: ORG,
        text: internal.text,
        observationRevision: 2,
        provenance: 'repkey_confirmed',
        matchedReplyId: internal.id,
        providerUpdatedAt: NOW,
        observedAt: NOW,
      }),
      findMilestonesByReviewIds: async () => [],
      findStatesByReviewIds: async () => [],
      findReviewIdsByReplyStage: async () => [],
    })

    await expect(adapter.getEffectiveReplyByReviewId(REVIEW, ORG)).resolves.toEqual({
      kind: 'reply',
      ...internal,
    })
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

describe('getReplyStatesByReviewIds', () => {
  it('selects the effective reply from one content-free source batch', async () => {
    const secondReview = reviewId('d4000000-0000-4000-8000-000000000011')
    const findStatesByReviewIds = vi.fn(async () => [
      {
        reviewId: REVIEW,
        source: 'google_sync' as const,
        status: 'published' as const,
        publicationState: 'published' as const,
        publicationLastErrorClass: null,
        updatedAt: NOW,
      },
      {
        reviewId: REVIEW,
        source: 'internal' as const,
        status: 'pending_approval' as const,
        publicationState: null,
        publicationLastErrorClass: null,
        updatedAt: NOW,
      },
      {
        reviewId: secondReview,
        source: 'google_sync' as const,
        status: 'published' as const,
        publicationState: 'published' as const,
        publicationLastErrorClass: null,
        updatedAt: NOW,
      },
    ])
    const findByReviewId = vi.fn(async () => [])
    const adapter = createReplyLookupAdapter({
      findByReviewId,
      getCurrentGoogleReplyByReviewId: async () => null,
      findMilestonesByReviewIds: async () => [],
      findStatesByReviewIds,
      findReviewIdsByReplyStage: async () => [],
    })

    const result = await adapter.getReplyStatesByReviewIds([REVIEW, secondReview], ORG)

    expect(findStatesByReviewIds).toHaveBeenCalledOnce()
    expect(findStatesByReviewIds).toHaveBeenCalledWith([REVIEW, secondReview], ORG)
    expect(findByReviewId).not.toHaveBeenCalled()
    expect(result).toEqual(
      new Map([
        [
          REVIEW,
          {
            status: 'pending_approval',
            publicationState: null,
            publicationLastErrorClass: null,
            updatedAt: NOW,
          },
        ],
        [
          secondReview,
          {
            status: 'published',
            publicationState: 'published',
            publicationLastErrorClass: null,
            updatedAt: NOW,
          },
        ],
      ]),
    )
  })
})

describe('findReviewIdsByReplyStage', () => {
  it('partitions effective replies and gives internal state precedence', async () => {
    const waitingReview = reviewId('d4000000-0000-4000-8000-000000000011')
    const needsReplyReview = reviewId('d4000000-0000-4000-8000-000000000012')
    const findReviewIdsByReplyStage = vi.fn(async () => [
      { reviewId: REVIEW, source: 'google_sync' as const, stage: 'waiting' as const },
      {
        reviewId: REVIEW,
        source: 'internal' as const,
        stage: 'awaiting' as const,
      },
      {
        reviewId: waitingReview,
        source: 'google_sync' as const,
        stage: 'waiting' as const,
      },
      {
        reviewId: needsReplyReview,
        source: 'google_sync' as const,
        stage: 'waiting' as const,
      },
      {
        reviewId: needsReplyReview,
        source: 'internal' as const,
        stage: 'needs_reply' as const,
      },
    ])
    const adapter = createReplyLookupAdapter({
      findByReviewId: async () => [],
      getCurrentGoogleReplyByReviewId: async () => null,
      findMilestonesByReviewIds: async () => [],
      findStatesByReviewIds: async () => [],
      findReviewIdsByReplyStage,
    })

    const result = await adapter.findReviewIdsByReplyStage(ORG)

    expect(findReviewIdsByReplyStage).toHaveBeenCalledWith(ORG, undefined)
    expect(result).toEqual({ awaiting: [REVIEW], waiting: [waitingReview] })
  })
})
