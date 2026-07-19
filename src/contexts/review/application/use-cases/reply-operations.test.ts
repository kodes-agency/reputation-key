// Review context — reply lifecycle use case tests

import { describe, it, expect, vi } from 'vitest'
import {
  draftReply,
  submitReply,
  approveReply,
  rejectReply,
  deleteReply,
  getReply,
  retryPublish,
  markReplyPublished,
  editPublishedReply,
} from './reply-operations'
import type { ReplyDeps } from './reply-operations'
import type { ReplyRepository, ConditionalReplyUpdate } from '../ports/reply.repository'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyQueuePort } from '../ports/reply-queue.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import type { Reply, Review } from '../../domain/types'
import { isReviewError } from '../../domain/errors'
import { MAX_REPLY_LENGTH } from '../../domain/rules'
import {
  buildIdempotencyKey,
  nextPublicationState,
} from '../../domain/reply-publication-workflow'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import {
  reviewId,
  replyId,
  organizationId,
  userId as toUserId,
  propertyId,
} from '#/shared/domain/ids'
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-isolated')
const REVIEW_ID = reviewId('rev-1')
const REPLY_ID = replyId('reply-1')
const USER_ID = toUserId('user-1')
const ADMIN_ID = toUserId('admin-1')
const PROP_ID = propertyId('prop-1')
const NOW = new Date('2025-06-01T12:00:00Z')

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'loc-1',
    googleConnectionId: null,
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
    ...overrides,
  }
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: REPLY_ID,
    reviewId: REVIEW_ID,
    organizationId: ORG_ID,
    text: 'Thank you!',
    source: 'internal',
    status: 'draft',
    createdBy: USER_ID,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const makeStaffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const replyRepoWith = (reply: Reply | null): ReplyRepository => ({
  ...makeDeps().replyRepo,
  findInternalByReviewId: vi.fn(async () => reply),
})

/**
 * In-process fake of ReplyCommandStore (application zone must not import
 * infra). Mirrors the production contract: guarded conditionalUpdate first,
 * then post-commit bus emit; a lost race (conditionalUpdate → null) emits
 * nothing. `getReplyRepo` resolves lazily so per-test replyRepo overrides
 * take effect.
 */
function makeReplyCommandStoreFake(
  getReplyRepo: () => ReplyRepository,
  events: EventBus,
): ReplyCommandStore {
  const transition = async (
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    const saved = await getReplyRepo().conditionalUpdate(
      reply.id,
      reply.organizationId,
      [reply.status],
      updates,
      now,
    )
    if (saved && event) await events.emit(event)
    return saved
  }
  return {
    submitReply: transition,
    rejectReply: transition,
    // BQC-3.8: authorize mirrors the production write — guarded status update
    // + the new publication-cycle fields — with the same domain pre-check.
    markPublicationAuthorized: async (reply, updates, event, now) => {
      if (!nextPublicationState(reply.publicationState, 'authorize')) return null
      return transition(
        reply,
        {
          ...updates,
          publicationState: 'authorized',
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: null,
        },
        event,
        now,
      )
    },
    markPublished: (reply, updates, event, now) =>
      transition(
        reply,
        { ...updates, publicationState: 'published', reconcileDueAt: null },
        event,
        now,
      ),
    // Job/sweep-facing methods are not exercised by the reply ops tests.
    markPublicationSending: vi.fn(),
    markPublicationTerminal: vi.fn(),
    markPublicationAmbiguous: vi.fn(),
    markPublicationRetryQueued: vi.fn(),
    cancelPublications: vi.fn(),
    // Edit-and-republish mirrors the production write: guarded published-only
    // transition with the edit fields + the updated fact.
    editPublishedReply: async (reply, command) => {
      if (reply.status !== 'published') return null
      return transition(
        reply,
        {
          text: command.text,
          status: 'approved',
          publicationState: 'authorized',
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: null,
        },
        command.event,
        command.now,
      )
    },
    mirrorSyncedReply: vi.fn(async () => {
      throw new Error('mirrorSyncedReply is not used by reply-operations')
    }),
    purgeExpiredReview: vi.fn(async () => {
      throw new Error('purgeExpiredReview is not used by reply-operations')
    }),
  }
}

type TestReplyDeps = ReplyDeps & { events: EventBus }

function makeDeps(overrides: Partial<ReplyDeps> = {}): TestReplyDeps {
  const events = {
    emit: vi.fn(async () => {}),
    on: vi.fn(),
  } as unknown as EventBus
  const deps = {
    replyRepo: {
      upsert: vi.fn(async (r: Reply) => r),
      // Default conditionalUpdate applies the delta onto a base reply and returns it,
      // mirroring the real atomic guard's success path. TOCTOU tests override this to
      // return null (lost race).
      conditionalUpdate: vi.fn(
        async (
          id: string,
          _org: unknown,
          _statuses: unknown,
          updates: Record<string, unknown>,
        ) => ({
          ...makeReply(),
          id,
          ...updates,
        }),
      ) as unknown as ReplyRepository['conditionalUpdate'],
      findById: vi.fn(async () => null),
      findInternalByReviewId: vi.fn(async () => null),
      deleteById: vi.fn(async () => {}),
    } as unknown as ReplyRepository,
    reviewRepo: {
      findById: vi.fn(async () => makeReview()),
    } as unknown as ReviewRepository,
    queue: {
      addPublishJob: vi.fn(async () => {}),
    } as unknown as ReplyQueuePort,
    googleReviewApi: {
      fetchReviews: vi.fn(async () => []),
      replyToReview: vi.fn(async () => {}),
    } as unknown as GoogleReviewApiPort,
    commandStore: undefined as unknown as ReplyCommandStore,
    clock: () => NOW,
    idGen: () => REPLY_ID,
    staffPublicApi: makeStaffApi(null),
    ...overrides,
  }
  deps.commandStore = makeReplyCommandStoreFake(() => deps.replyRepo, events)
  return { ...deps, events }
}

const MANAGER_CTX = {
  role: 'PropertyManager' as const,
  userId: USER_ID,
  organizationId: ORG_ID,
}
const ADMIN_CTX = {
  role: 'AccountAdmin' as const,
  userId: ADMIN_ID,
  organizationId: ORG_ID,
}
const STAFF_CTX = { role: 'Staff' as const, userId: USER_ID, organizationId: ORG_ID }

// ── draftReply ──────────────────────────────────────────────────────────

describe('draftReply', () => {
  it('creates a new draft reply', async () => {
    const deps = makeDeps()
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Thank you!' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('draft')
    expect(result.text).toBe('Thank you!')
    expect(result.source).toBe('internal')
    expect(result.aiGenerated).toBe(false)
    expect(deps.replyRepo.upsert).toHaveBeenCalledTimes(1)
  })

  it('updates existing draft', async () => {
    const existing = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => existing),
      } as unknown as ReplyRepository,
    })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Updated reply' },
      MANAGER_CTX,
    )
    expect(result.text).toBe('Updated reply')
    expect(result.status).toBe('draft')
  })

  it('allows re-drafting a rejected reply', async () => {
    const rejected = makeReply({ status: 'rejected', rejectionReason: 'Bad tone' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => rejected),
      } as unknown as ReplyRepository,
    })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Improved reply' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('draft')
    expect(result.rejectionReason).toBeNull()
    expect(result.rejectedBy).toBeNull()
  })

  it('rejects empty text', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: '' }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('rejects text exceeding max length', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'x'.repeat(4097) }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('blocks staff role', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Hi' }, STAFF_CTX),
    ).rejects.toThrow()
  })

  it('allows AccountAdmin role', async () => {
    const deps = makeDeps()
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Admin reply' },
      ADMIN_CTX,
    )
    expect(result.status).toBe('draft')
  })

  it('rejects edit on pending_approval reply', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('validates the re-draft transition via transitionReply (not an inline guard)', async () => {
    // A published reply cannot transition to draft — transitionReply must reject it.
    const published = makeReply({ status: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('uses conditionalUpdate (not upsert) when editing an existing draft', async () => {
    const draft = makeReply({ status: 'draft' })
    const conditionalUpdate = vi.fn(async (id: string) => ({
      ...draft,
      id,
    })) as unknown as ReplyRepository['conditionalUpdate']
    const upsert = vi.fn(async (r: Reply) => r)
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        upsert,
        conditionalUpdate,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Edited text' },
      MANAGER_CTX,
    )
    expect(conditionalUpdate).toHaveBeenCalledWith(
      REPLY_ID,
      ORG_ID,
      ['draft'],
      expect.objectContaining({ status: 'draft', text: 'Edited text' }),
      NOW,
    )
    expect(upsert).not.toHaveBeenCalled()
    expect(result.status).toBe('draft')
  })

  it('uses conditionalUpdate for rejected → draft re-draft with correct expected status', async () => {
    const rejected = makeReply({ status: 'rejected', rejectionReason: 'Bad tone' })
    const conditionalUpdate = vi.fn(
      async (id: string, _o: unknown, _s: unknown, u: Record<string, unknown>) => ({
        ...rejected,
        id,
        ...u,
      }),
    ) as unknown as ReplyRepository['conditionalUpdate']
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        conditionalUpdate,
        findInternalByReviewId: vi.fn(async () => rejected),
      } as unknown as ReplyRepository,
    })
    await draftReply(deps)({ reviewId: REVIEW_ID, text: 'Improved' }, MANAGER_CTX)
    expect(conditionalUpdate).toHaveBeenCalledWith(
      REPLY_ID,
      ORG_ID,
      ['rejected'],
      expect.objectContaining({
        status: 'draft',
        text: 'Improved',
        rejectedBy: null,
        rejectionReason: null,
      }),
      NOW,
    )
  })

  it('treats a lost race on re-draft (conditionalUpdate returns null) as invalid_transition', async () => {
    const rejected = makeReply({ status: 'rejected' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => rejected),
        conditionalUpdate: vi.fn(
          async () => null,
        ) as unknown as ReplyRepository['conditionalUpdate'],
      } as unknown as ReplyRepository,
    })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Try again' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('tags new reply with the caller organizationId (never a leaked org)', async () => {
    const upsert = vi.fn(async (r: Reply) => r)
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        upsert,
      } as unknown as ReplyRepository,
    })

    await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Tenant-scoped reply' },
      { ...MANAGER_CTX, organizationId: OTHER_ORG_ID },
    )

    expect(upsert).toHaveBeenCalledTimes(1)
    const createdReply = upsert.mock.calls[0]![0] as Reply
    expect(createdReply.organizationId).toBe(OTHER_ORG_ID)
  })
})

// ── submitReply ─────────────────────────────────────────────────────────

describe('submitReply', () => {
  it('transitions draft → pending_approval', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('pending_approval')
  })

  it('sets submittedAt when submitting', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.submittedAt).toBe(NOW)
  })

  it('rejects if no reply exists', async () => {
    const deps = makeDeps()
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('rejects submit from published status', async () => {
    const published = makeReply({ status: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('emits reviewReplySubmitted event with correct data', async () => {
    const draft = makeReply({ status: 'draft' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('review.reply.submitted')
    expect(emittedEvent.replyId).toBe(REPLY_ID)
    expect(emittedEvent.reviewId).toBe(REVIEW_ID)
    expect(emittedEvent.propertyId).toBe(PROP_ID)
    expect(emittedEvent.organizationId).toBe(ORG_ID)
    expect(emittedEvent.userId).toBe(USER_ID)
    expect(emittedEvent.occurredAt).toBe(NOW)
  })

  it('treats a lost race (conditionalUpdate returns null) as invalid_transition', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
        conditionalUpdate: vi.fn(
          async () => null,
        ) as unknown as ReplyRepository['conditionalUpdate'],
      } as unknown as ReplyRepository,
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.events.emit).not.toHaveBeenCalled()
  })
})

// ── approveReply ────────────────────────────────────────────────────────

describe('approveReply', () => {
  it('transitions pending_approval → approved and enqueues publish job', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
    expect(result.approvedBy).toBe(USER_ID)
    expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: REPLY_ID,
        organizationId: ORG_ID,
        // BQC-3.2: named initiator for user-triggered delayed work.
        policy: { initiator: { kind: 'user', id: USER_ID } },
      },
      {
        // BQC-3.3: saga idempotency key dedupes enqueue for the same approval
        // cycle (sourceVersion = the approved reply's updatedAt).
        idempotencyKey: buildIdempotencyKey(REPLY_ID, NOW.getTime()),
      },
    )
  })

  it('sets approvedAt when approving', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.approvedAt).toBe(NOW)
  })

  it('rejects approve from draft status', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('emits reviewReplyApproved event with correct data', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('review.reply.approved')
    expect(emittedEvent.replyId).toBe(REPLY_ID)
    expect(emittedEvent.reviewId).toBe(REVIEW_ID)
    expect(emittedEvent.propertyId).toBe(PROP_ID)
    expect(emittedEvent.organizationId).toBe(ORG_ID)
    expect(emittedEvent.userId).toBe(USER_ID)
    expect(emittedEvent.occurredAt).toBe(NOW)
  })
})

// ── editPublishedReply ─────────────────────────────────────────────────

describe('editPublishedReply', () => {
  const published = () =>
    makeReply({
      status: 'published',
      text: 'Old public reply',
      publicationState: 'published',
      publicationAttempts: 1,
      publishedAt: NOW,
    })

  it('edits text, re-enters the publication machine, emits review.reply.updated, and enqueues the republish', async () => {
    const reply = published()
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => reply),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })

    const result = await editPublishedReply(deps)(
      { reviewId: REVIEW_ID, text: 'Improved public reply' },
      MANAGER_CTX,
    )

    expect(result.status).toBe('approved')
    expect(result.text).toBe('Improved public reply')
    expect(result.publicationState).toBe('authorized')
    expect(result.publicationAttempts).toBe(0)
    expect(result.publicationLastErrorClass).toBeNull()
    expect(result.reconcileDueAt).toBeNull()

    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('review.reply.updated')
    expect(emittedEvent.replyId).toBe(REPLY_ID)
    expect(emittedEvent.reviewId).toBe(REVIEW_ID)
    expect(emittedEvent.propertyId).toBe(PROP_ID)
    expect(emittedEvent.organizationId).toBe(ORG_ID)
    expect(emittedEvent.userId).toBe(USER_ID)

    expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: REPLY_ID,
        organizationId: ORG_ID,
        policy: { initiator: { kind: 'user', id: USER_ID } },
      },
      { idempotencyKey: buildIdempotencyKey(REPLY_ID, NOW.getTime()) },
    )
  })

  it('no-ops when the trimmed text is unchanged (no write, no fact, no enqueue)', async () => {
    const reply = published()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => reply),
      } as unknown as ReplyRepository,
    })

    const result = await editPublishedReply(deps)(
      { reviewId: REVIEW_ID, text: '  Old public reply  ' },
      MANAGER_CTX,
    )

    expect(result).toBe(reply)
    expect(deps.events.emit).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('rejects editing a non-published reply', async () => {
    const reply = makeReply({ status: 'approved', publicationState: 'authorized' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => reply),
      } as unknown as ReplyRepository,
    })

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text: 'New' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('rejects empty and over-length text', async () => {
    const reply = published()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => reply),
      } as unknown as ReplyRepository,
    })

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text: '   ' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply' })
    await expect(
      editPublishedReply(deps)(
        { reviewId: REVIEW_ID, text: 'x'.repeat(MAX_REPLY_LENGTH + 1) },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'invalid_reply' })
  })

  it('rejects when the reply does not exist', async () => {
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => null),
      } as unknown as ReplyRepository,
    })

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text: 'New' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'reply_not_found' })
  })

  it('treats a lost race (store returns null) as invalid_transition', async () => {
    const reply = published()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => reply),
        conditionalUpdate: vi.fn(
          async () => null,
        ) as unknown as ReplyRepository['conditionalUpdate'],
      } as unknown as ReplyRepository,
    })

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text: 'New text' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })
})

// ── rejectReply ─────────────────────────────────────────────────────────

describe('rejectReply', () => {
  it('transitions pending_approval → rejected with reason', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    const result = await rejectReply(deps)(
      { reviewId: REVIEW_ID, reason: 'Tone too aggressive' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('rejected')
    expect(result.rejectedBy).toBe(USER_ID)
    expect(result.rejectionReason).toBe('Tone too aggressive')
  })

  it('rejects without reason', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    const result = await rejectReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.rejectionReason).toBeNull()
  })

  it('emits reviewReplyRejected event with correct data', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await rejectReply(deps)(
      { reviewId: REVIEW_ID, reason: 'Tone too aggressive' },
      MANAGER_CTX,
    )
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('review.reply.rejected')
    expect(emittedEvent.replyId).toBe(REPLY_ID)
    expect(emittedEvent.reviewId).toBe(REVIEW_ID)
    expect(emittedEvent.propertyId).toBe(PROP_ID)
    expect(emittedEvent.organizationId).toBe(ORG_ID)
    expect(emittedEvent.userId).toBe(USER_ID)
    expect(emittedEvent.reason).toBe('Tone too aggressive')
    expect(emittedEvent.occurredAt).toBe(NOW)
  })
})

// ── deleteReply ─────────────────────────────────────────────────────────

describe('deleteReply', () => {
  it('deletes a draft reply', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    await deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(deps.replyRepo.deleteById).toHaveBeenCalledWith(REPLY_ID, ORG_ID)
  })

  it('rejects deleting non-draft reply', async () => {
    const published = makeReply({ status: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })
    await expect(
      deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })
})

// ── getReply ────────────────────────────────────────────────────────────

describe('getReply', () => {
  it('returns existing reply', async () => {
    const reply = makeReply()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => reply),
      } as unknown as ReplyRepository,
    })
    const result = await getReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result).toEqual(reply)
  })

  it('returns null when no reply exists', async () => {
    const deps = makeDeps()
    const result = await getReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result).toBeNull()
  })

  it('blocks staff role', async () => {
    const deps = makeDeps()
    await expect(getReply(deps)({ reviewId: REVIEW_ID }, STAFF_CTX)).rejects.toThrow()
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('passes the caller organizationId to the repo (never a leaked org)', async () => {
    const findInternalByReviewId = vi.fn(async () => null)
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId,
      } as unknown as ReplyRepository,
    })

    await getReply(deps)(
      { reviewId: REVIEW_ID },
      { ...MANAGER_CTX, organizationId: OTHER_ORG_ID },
    )

    expect(findInternalByReviewId).toHaveBeenCalledWith(REVIEW_ID, OTHER_ORG_ID)
  })
})

// ── markReplyPublished ──────────────────────────────────────────────────

describe('markReplyPublished', () => {
  it('transitions approved → published and emits event with correct propertyId', async () => {
    const approved = makeReply({ status: 'approved' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    const result = await markReplyPublished(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
    expect(result.status).toBe('published')
    expect(result.publishedAt).toBe(NOW)
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent.propertyId).toBe(PROP_ID)
  })

  it('emits userId: null (system actor) — publish runs from the BullMQ job, not a user', async () => {
    const approved = makeReply({ status: 'approved', createdBy: USER_ID })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await markReplyPublished(deps)({ replyId: REPLY_ID, organizationId: ORG_ID })
    expect(vi.mocked(deps.events.emit).mock.calls[0][0]).toMatchObject({
      _tag: 'review.reply.published',
      userId: null,
      authorId: USER_ID,
    })
  })

  it('rejects if reply not in approved status', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    await expect(
      markReplyPublished(deps)({ replyId: REPLY_ID, organizationId: ORG_ID }),
    ).rejects.toThrow()
  })

  it('rejects if review not found', async () => {
    const approved = makeReply({ status: 'approved' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => null),
      } as unknown as ReviewRepository,
    })
    await expect(
      markReplyPublished(deps)({ replyId: REPLY_ID, organizationId: ORG_ID }),
    ).rejects.toThrow()
  })
})

// ── retryPublish ────────────────────────────────────────────────────────

describe('retryPublish', () => {
  it('transitions publish_failed → approved, re-authorizes the publication cycle, and re-enqueues job', async () => {
    const failed = makeReply({ status: 'publish_failed', publicationState: 'terminal' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => failed),
      } as unknown as ReplyRepository,
    })
    const result = await retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
    expect(result.publicationState).toBe('authorized')
    expect(deps.queue.addPublishJob).toHaveBeenCalledTimes(1)
    // Non-ambiguous rows behave exactly as today — no provider re-read.
    expect(deps.googleReviewApi.fetchReviews).not.toHaveBeenCalled()
  })

  it('rejects retry for non-failed reply', async () => {
    const published = makeReply({ status: 'published', publicationState: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })
    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  // BQC-3.8 §6: reconcile-before-retry — an ambiguous publication may have
  // landed on Google; re-read provider state before any new send.
  it('ambiguous + provider shows the reply → heals to published, NO re-enqueue, NO duplicate send', async () => {
    const ambiguous = makeReply({
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: NOW,
    })
    const healed = {
      ...ambiguous,
      status: 'published' as const,
      publicationState: 'published' as const,
      publishedAt: NOW,
    }
    const reviewWithConnection = makeReview({
      googleConnectionId: 'conn-1' as never,
      externalLocationId: 'accounts/111/locations/222',
      externalId: 'ext-1',
    })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => ambiguous),
        // reconcile reads the reply, then retryPublish re-reads the healed row.
        findById: vi.fn().mockResolvedValueOnce(ambiguous).mockResolvedValue(healed),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => reviewWithConnection),
      } as unknown as ReviewRepository,
    })
    vi.mocked(deps.googleReviewApi.fetchReviews).mockResolvedValue([
      { externalId: 'ext-1', replyText: 'Thank you!' } as never,
    ])

    const result = await retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)

    expect(result.status).toBe('published')
    expect(deps.googleReviewApi.fetchReviews).toHaveBeenCalledWith(
      ORG_ID,
      'conn-1',
      'accounts/111/locations/222',
    )
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    // The heal commits the published fact (once — no duplicate send).
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deps.events.emit).mock.calls[0][0]).toMatchObject({
      _tag: 'review.reply.published',
    })
  })

  it('ambiguous + provider does NOT show the reply → proceeds with re-approve + enqueue', async () => {
    const ambiguous = makeReply({
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: NOW,
    })
    const reviewWithConnection = makeReview({
      googleConnectionId: 'conn-1' as never,
      externalLocationId: 'accounts/111/locations/222',
      externalId: 'ext-1',
    })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => ambiguous),
        findById: vi.fn(async () => ambiguous),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => reviewWithConnection),
      } as unknown as ReviewRepository,
    })
    vi.mocked(deps.googleReviewApi.fetchReviews).mockResolvedValue([
      { externalId: 'ext-1', replyText: null } as never,
    ])

    const result = await retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)

    expect(result.status).toBe('approved')
    expect(result.publicationState).toBe('authorized')
    expect(deps.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })
})

// ── TOCTOU guard — conditionalUpdate atomicity ─────────────────────────
// Every transition use case must use conditionalUpdate (not upsert) so that a
// concurrent status change invalidates the write. A null return = lost race →
// invalid_transition, and no event/job side-effects must fire.

describe('reply ops — TOCTOU guard (conditionalUpdate returns null → invalid_transition)', () => {
  const nullConditional = vi.fn(
    async () => null,
  ) as unknown as ReplyRepository['conditionalUpdate']

  it('approveReply: lost race throws invalid_transition, no job enqueued, no event', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('rejectReply: lost race throws invalid_transition, no event', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      rejectReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('markReplyPublished: lost race throws invalid_transition, no event', async () => {
    const approved = makeReply({ status: 'approved', publicationState: 'sending' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      markReplyPublished(deps)({ replyId: REPLY_ID, organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('retryPublish: lost race throws invalid_transition, no job enqueued', async () => {
    const failed = makeReply({ status: 'publish_failed', publicationState: 'terminal' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => failed),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('submitReply: lost race throws invalid_transition, no event', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.events.emit).not.toHaveBeenCalled()
  })
})

// ── property-assignment scoping (D6-001) ─────────────────────────────────
// A PropertyManager may only mutate replies on reviews whose property they
// are assigned to. AccountAdmin (staffApi → null) bypasses the check.

describe('reply ops — property-assignment scoping (D6-001)', () => {
  const expectForbidden = (e: unknown) =>
    isReviewError(e) && (e as { code: string }).code === 'forbidden'

  it('draftReply rejects PM without assignment and does not persist', async () => {
    const deps = makeDeps({ staffPublicApi: makeStaffApi([]) })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Hi' }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)
    expect(deps.replyRepo.upsert).not.toHaveBeenCalled()
  })

  it('draftReply allows PM assigned to the property', async () => {
    const deps = makeDeps({ staffPublicApi: makeStaffApi([PROP_ID]) })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Hi' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('draft')
  })

  it('submitReply rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    await expect(
      submitReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    const result = await submitReply(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('pending_approval')
  })

  it('approveReply rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
    })
    await expect(
      approveReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
    })
    const result = await approveReply(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
  })

  it('rejectReply rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
    })
    await expect(
      rejectReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
    })
    const result = await rejectReply(assigned)(
      { reviewId: REVIEW_ID, reason: 'Tone' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('rejected')
  })

  it('deleteReply rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    await expect(
      deleteReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    await deleteReply(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(assigned.replyRepo.deleteById).toHaveBeenCalledWith(REPLY_ID, ORG_ID)
  })

  it('retryPublish rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'publish_failed' })),
    })
    await expect(
      retryPublish(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'publish_failed' })),
    })
    const result = await retryPublish(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
    expect(assigned.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })

  it('AccountAdmin bypasses the assignment check (staffApi → null)', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    }) // default staffApi returns null = org-wide access
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, ADMIN_CTX)
    expect(result.status).toBe('pending_approval')
  })
  it('getReply rejects PM without assignment — no cross-property read (M1)', async () => {
    // A PropertyManager assigned to no properties could previously read ANY property's
    // draft reply. getReply now enforces the same property-access guard as the mutations.
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    await expect(
      getReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)
    // The reply is never fetched when access is missing.
    expect(unassigned.replyRepo.findInternalByReviewId).not.toHaveBeenCalled()
  })

  it('getReply allows PM assigned to the property', async () => {
    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    const result = await getReply(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result?.status).toBe('draft')
  })
})
