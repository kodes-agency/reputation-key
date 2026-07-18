// Review context — cancelPublicationsForConnection tests (BQC-3.8).
//
// The disconnect/policy flow resolves the connection's reviews exactly like
// the source-content purge (google_connection_id equality within the org),
// then cancels every publication-active reply (requested/authorized/sending)
// through the command store: one batch transaction, one
// review.reply.publication_cancelled fact per reply. Rows whose publication
// moved on — or that the purge already deleted — are skipped by the store
// (count 0) without failing the run.

import { describe, it, expect, vi } from 'vitest'
import { cancelPublicationsForConnection } from './cancel-publications'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { Review, Reply } from '../../domain/types'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const CONN_ID = googleConnectionId('conn-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')
const NOW = new Date('2026-07-17T00:00:00Z')

function makeReview(id: string): Review {
  return {
    id: reviewId(id),
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    platform: 'google',
    externalId: `ext-${id}`,
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: CONN_ID,
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great!',
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: NOW,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: null,
    contentHash: null,
    sourceSeenGeneration: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeReply(
  id: string,
  reviewIdStr: string,
  publicationState: Reply['publicationState'],
): Reply {
  return {
    id: replyId(id),
    reviewId: reviewId(reviewIdStr),
    organizationId: ORG_ID,
    text: 'Thank you!',
    status: 'approved',
    source: 'internal',
    createdBy: USER_ID,
    approvedBy: USER_ID,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState,
    publicationAttempts: 1,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeDeps(opts: {
  reviewsByCall: ReadonlyArray<ReadonlyArray<Review>>
  activeReplies?: ReadonlyArray<Reply>
  cancelResult?: number
}) {
  const reviewsQueue = [...opts.reviewsByCall]
  const reviewRepo = {
    findByConnection: vi.fn().mockImplementation(async () => reviewsQueue.shift() ?? []),
  } as unknown as ReviewRepository
  const replyRepo = {
    findPublicationActiveByReviewIds: vi.fn(async () => opts.activeReplies ?? []),
  } as unknown as ReplyRepository
  const commandStore = {
    cancelPublications: vi.fn(async () => opts.cancelResult ?? 0),
  } as unknown as ReplyCommandStore
  return { reviewRepo, replyRepo, commandStore, clock: () => NOW }
}

describe('cancelPublicationsForConnection', () => {
  it('cancels every publication-active reply of the connection with one fact per reply', async () => {
    const reviews = [makeReview('rev-1'), makeReview('rev-2')]
    const active = [
      makeReply('reply-1', 'rev-1', 'authorized'),
      makeReply('reply-2', 'rev-2', 'sending'),
    ]
    const deps = makeDeps({
      reviewsByCall: [reviews],
      activeReplies: active,
      cancelResult: 2,
    })

    const result = await cancelPublicationsForConnection(deps)({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      cause: 'disconnect',
    })

    expect(result).toEqual({ reviewsScanned: 2, cancelled: 2, batches: 1 })
    expect(deps.reviewRepo.findByConnection).toHaveBeenCalledWith(
      ORG_ID,
      CONN_ID,
      null,
      500,
    )
    expect(deps.replyRepo.findPublicationActiveByReviewIds).toHaveBeenCalledWith(
      [reviewId('rev-1'), reviewId('rev-2')],
      ORG_ID,
    )

    const commands = vi.mocked(deps.commandStore.cancelPublications).mock.calls[0]![0]
    expect(commands).toHaveLength(2)
    for (const [i, command] of commands.entries()) {
      expect(command.reply).toBe(active[i])
      expect(command.event).toMatchObject({
        _tag: 'review.reply.publication_cancelled',
        replyId: active[i]!.id,
        reviewId: active[i]!.reviewId,
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        cause: 'disconnect',
        occurredAt: NOW,
      })
    }
  })

  it('a connection with no reviews (purge already deleted them) is a tolerated no-op', async () => {
    const deps = makeDeps({ reviewsByCall: [[]] })

    const result = await cancelPublicationsForConnection(deps)({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      cause: 'disconnect',
    })

    expect(result).toEqual({ reviewsScanned: 0, cancelled: 0, batches: 0 })
    expect(deps.replyRepo.findPublicationActiveByReviewIds).not.toHaveBeenCalled()
    expect(deps.commandStore.cancelPublications).not.toHaveBeenCalled()
  })

  it('reviews without active publications issue an empty cancel batch', async () => {
    const deps = makeDeps({
      reviewsByCall: [[makeReview('rev-1')]],
      activeReplies: [],
      cancelResult: 0,
    })

    const result = await cancelPublicationsForConnection(deps)({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      cause: 'disconnect',
    })

    expect(result).toEqual({ reviewsScanned: 1, cancelled: 0, batches: 1 })
    expect(deps.commandStore.cancelPublications).toHaveBeenCalledWith([])
  })

  it('paginates reviews by keyset cursor until the connection is exhausted', async () => {
    const first = [makeReview('rev-1'), makeReview('rev-2')]
    const second = [makeReview('rev-3')]
    const deps = makeDeps({
      reviewsByCall: [first, second],
      activeReplies: [],
      cancelResult: 0,
    })

    const result = await cancelPublicationsForConnection({
      ...deps,
      batchSize: 2,
    })({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      cause: 'policy',
    })

    expect(result.batches).toBe(2)
    expect(result.reviewsScanned).toBe(3)
    const calls = vi.mocked(deps.reviewRepo.findByConnection).mock.calls
    expect(calls[0]).toEqual([ORG_ID, CONN_ID, null, 2])
    expect(calls[1]).toEqual([ORG_ID, CONN_ID, { id: 'rev-2' }, 2])
    // The cause flows into every emitted fact.
    const commands = vi.mocked(deps.commandStore.cancelPublications).mock.calls[0]![0]
    expect(commands).toHaveLength(0)
  })

  it('stops at the batch budget (maxBatches) even when rows remain', async () => {
    const deps = makeDeps({
      reviewsByCall: [
        [makeReview('rev-1')],
        [makeReview('rev-2')],
        [makeReview('rev-3')],
      ],
      activeReplies: [],
      cancelResult: 0,
    })

    const result = await cancelPublicationsForConnection({
      ...deps,
      batchSize: 1,
      maxBatches: 2,
    })({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      cause: 'disconnect',
    })

    expect(result.batches).toBe(2)
    expect(deps.reviewRepo.findByConnection).toHaveBeenCalledTimes(2)
  })
})
