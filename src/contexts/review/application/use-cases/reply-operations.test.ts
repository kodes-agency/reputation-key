// Review context — reply lifecycle use case tests

import { describe, it, expect, vi } from 'vitest'
import {
  draftReply,
  submitReply,
  approveReply,
  rejectReply,
  deleteReply,
  retryPublish,
  editPublishedReply,
} from './reply-operations'
import type { ReplyDeps } from './reply-operations'
import type { ReplyRepository, ConditionalReplyUpdate } from '../ports/reply.repository'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyQueuePort } from '../ports/reply-queue.port'
import {
  createRecordedOutbox,
  type RecordedOutbox,
} from '#/shared/testing/recorded-outbox'
import type { DomainEvent } from '#/shared/events/events'
import type { Reply, Review } from '../../domain/types'
import { isReviewError } from '../../domain/errors'
import { MAX_REPLY_LENGTH } from '../../domain/rules'
import {
  buildIdempotencyKey,
  nextPublicationState,
  PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
} from '../../domain/reply-publication-workflow'
import type { ReplyDispatchEvidence } from '../ports/reply-publication-dispatch-evidence.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
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
const REVIEW_ID = reviewId('51000000-0000-4000-8000-000000000010')
const REPLY_ID = replyId('51000000-0000-4000-8000-000000000020')
const USER_ID = toUserId('user-1')
const ADMIN_ID = toUserId('admin-1')
const PROP_ID = propertyId('51000000-0000-4000-8000-000000000001')
const NOW = new Date('2025-06-01T12:00:00Z')
const ATTEMPT_STARTED_AT = new Date('2025-06-01T10:00:00Z')
const WONT_SEND_AGAIN =
  "RepKey won't send this reply again because Google may already have it. Use Check Google again instead."

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
    translatedText: null,
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
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
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
    stateRevision: 1,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationCycle: 0,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    templateId: overrides.templateId ?? null,
    templateVersion: overrides.templateVersion ?? null,
  }
}

const makeStaffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const replyRepoWith = (reply: Reply | null): ReplyRepository => ({
  ...makeDeps().replyRepo,
  findInternalByReviewId: vi.fn(async () => reply),
})

/**
 * The fake command store's guarded write. The production store owns its SQL
 * guard; here one overridable seam stands in for it, so a test can make any
 * store command lose its race by returning null.
 */
type FakeGuardedWrite = (
  id: Reply['id'],
  organizationId: Reply['organizationId'],
  expectedStatuses: ReadonlyArray<Reply['status']>,
  updates: ConditionalReplyUpdate,
  now?: Date,
) => Promise<Reply | null>
type FakeReplyRepository = ReplyRepository & { conditionalUpdate: FakeGuardedWrite }

/**
 * In-memory fake of ReplyCommandStore (application zone must not import
 * infra). Mirrors the production contract: guarded conditionalUpdate first,
 * then the outbox fact; a lost race (conditionalUpdate → null) records
 * nothing. `getReplyRepo` resolves lazily so per-test replyRepo overrides
 * take effect.
 */
function makeReplyCommandStoreFake(
  getReplyRepo: () => FakeReplyRepository,
  outbox: RecordedOutbox,
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
    if (saved && event) await outbox.record(event)
    return saved
  }
  return {
    submitReply: transition,
    rejectReply: transition,
    // BQC-3.8: authorize mirrors the production write — guarded status update
    // + the new publication-cycle fields — with the same domain pre-check.
    markPublicationAuthorized: async (reply, updates, facts, now) => {
      if (!nextPublicationState(reply.publicationState, 'authorize')) return null
      const saved = await transition(
        reply,
        {
          ...updates,
          publicationState: 'authorized',
          publicationCycle: facts.publicationIntent.publicationCycle,
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: new Date(
            (now ?? NOW).getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
          ),
        },
        facts.lifecycleEvent,
        now,
      )
      if (saved) await outbox.record(facts.publicationIntent)
      return saved
    },
    markPublished: (reply, updates, event, now) =>
      transition(
        reply,
        { ...updates, publicationState: 'published', reconcileDueAt: null },
        event,
        now,
      ),
    // D4: mirrors the production settle — guarded write to publish_failed /
    // terminal / retryable, the fact only when the row was not already failed.
    // The CAS keeps the attempt's cycle, so the settled row carries it forward.
    settleNeverDispatchedAttempt: vi.fn(async (reply: Reply, event, now: Date) => {
      const settled = {
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
        reconcileDueAt: null,
      } as const
      const saved = await transition(
        reply,
        settled,
        reply.status === 'publish_failed' ? null : event,
        now,
      )
      return saved === null ? null : { ...reply, ...settled }
    }),
    // Job/sweep-facing methods are not exercised by the reply ops tests.
    markPublicationSending: vi.fn(),
    markProviderOutcomePendingObservation: vi.fn(),
    deferPendingPublicationObservation: vi.fn(),
    deferUncertainSend: vi.fn(),
    rescheduleAmbiguousReconciliation: vi.fn(),
    markPublicationTerminal: vi.fn(),
    markPublicationAmbiguous: vi.fn(),
    markPublicationRetryQueued: vi.fn(),
    cancelPublications: vi.fn(),
    // Edit-and-republish mirrors the production write: guarded published-only
    // transition with the edit fields + the updated fact.
    editPublishedReply: async (reply, command) => {
      if (reply.status !== 'published') return null
      const saved = await transition(
        reply,
        {
          text: command.text,
          status: 'approved',
          publicationState: 'authorized',
          publicationCycle: command.publicationIntent.publicationCycle,
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: new Date(
            (command.now ?? NOW).getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
          ),
        },
        command.lifecycleEvent,
        command.now,
      )
      if (saved) await outbox.record(command.publicationIntent)
      return saved
    },
    mirrorSyncedReply: vi.fn(async () => {
      throw new Error('mirrorSyncedReply is not used by reply-operations')
    }),
    purgeExpiredReview: vi.fn(async () => {
      throw new Error('purgeExpiredReview is not used by reply-operations')
    }),
  }
}

type TestReplyDeps = Omit<ReplyDeps, 'replyRepo'> & {
  replyRepo: FakeReplyRepository
  outbox: RecordedOutbox
}

function makeDeps(overrides: Partial<ReplyDeps> = {}): TestReplyDeps {
  const outbox = createRecordedOutbox()
  const deps = {
    replyRepo: {
      createDraft: vi.fn(async (r: Reply) => r),
      // The draft save as the repository applies it: the manager's content on
      // a human-authored draft with its rejection cleared.
      saveDraft: vi.fn(async (reply: Reply, content: { text: string }) => ({
        ...reply,
        ...content,
        status: 'draft' as const,
        rejectedBy: null,
        rejectionReason: null,
        aiGenerated: false,
      })),
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
      ) as unknown as FakeGuardedWrite,
      findById: vi.fn(async () => null),
      findInternalByReviewId: vi.fn(async () => null),
      findCurrentPublicationAttemptStartedAt: vi.fn(async () => ATTEMPT_STARTED_AT),
      deleteDraft: vi.fn(async () => true),
    } as unknown as FakeReplyRepository,
    reviewRepo: {
      findById: vi.fn(async () => makeReview()),
    } as unknown as ReviewRepository,
    queue: {
      addPublishJob: vi.fn(async () => {}),
    } as unknown as ReplyQueuePort,
    googleReplyObservationStore: {
      allocateReadGeneration: vi.fn(async () => 1),
      findCurrentHead: vi.fn(async () => null),
      record: vi.fn(async (input: { observedText: string | null }) => ({
        observationRevision: 1,
        change: input.observedText === null ? ('deleted' as const) : ('added' as const),
        resolution:
          input.observedText === null
            ? ('absent' as const)
            : ('confirmed_on_google' as const),
        matchedReplyId: input.observedText === null ? null : REPLY_ID,
        matchedPublicationCycle: input.observedText === null ? null : 1,
        duplicate: false,
      })),
    },
    commandStore: undefined as unknown as ReplyCommandStore,
    aiSuggestedDraftStore: {
      accept: vi.fn(async () => {
        throw new Error('accept is not configured for this test')
      }),
      assertCurrentBinding: vi.fn(async () => 'current' as const),
    },
    // Fail closed by default: only a test that names never_dispatched unlocks.
    dispatchEvidence: {
      findDispatchEvidence: vi.fn(
        async (): Promise<ReplyDispatchEvidence> => 'possibly_dispatched',
      ),
    },
    propertyPublicationScope: {
      getPublicationScope: vi.fn(async () => ({
        lifecycle: 'active' as const,
        sourceEpoch: 0,
      })),
    },
    clock: () => NOW,
    idGen: () => REPLY_ID,
    staffPublicApi: makeStaffApi(null),
    ...overrides,
  }
  deps.commandStore = makeReplyCommandStoreFake(
    () => deps.replyRepo as FakeReplyRepository,
    outbox,
  )
  return { ...deps, replyRepo: deps.replyRepo as FakeReplyRepository, outbox }
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
const MEMBER_CTX = { role: 'Member' as const, userId: USER_ID, organizationId: ORG_ID }

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
    expect(deps.replyRepo.createDraft).toHaveBeenCalledTimes(1)
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

  it('clears AI attribution when the manager edits without provenance', async () => {
    const existing = makeReply({ status: 'draft', aiGenerated: true })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => existing),
      } as unknown as ReplyRepository,
    })

    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Manager-edited reply' },
      MANAGER_CTX,
    )

    // The draft save is the repository's human-authored write: the use case
    // hands it the AI-assisted reply and the manager's text, nothing else.
    expect(result.aiGenerated).toBe(false)
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      existing,
      { text: 'Manager-edited reply' },
      NOW,
    )
  })

  it('accepts an AI suggestion only through the atomic provenance store', async () => {
    const acceptedReply = makeReply({
      text: 'Suggested reply',
      aiGenerated: true,
      stateRevision: 2,
    })
    const accept = vi.fn(async () => ({
      status: 'accepted' as const,
      reply: acceptedReply,
    }))
    const deps = makeDeps({
      aiSuggestedDraftStore: {
        accept,
        assertCurrentBinding: vi.fn(async () => 'current' as const),
      },
    })

    const result = await draftReply(deps)(
      {
        reviewId: REVIEW_ID,
        text: 'Suggested reply',
        provenanceToken: 'signed-token',
      },
      MANAGER_CTX,
    )

    expect(result).toBe(acceptedReply)
    expect(accept).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      reviewId: REVIEW_ID,
      actorUserId: USER_ID,
      text: 'Suggested reply',
      provenanceToken: 'signed-token',
      now: NOW,
    })
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid', 'ai_suggestion_invalid'],
    ['expired', 'ai_suggestion_expired'],
    ['stale', 'ai_suggestion_stale'],
  ] as const)('rejects %s AI provenance without persisting', async (reason, code) => {
    const deps = makeDeps({
      aiSuggestedDraftStore: {
        accept: vi.fn(async () => ({ status: 'rejected' as const, reason })),
        assertCurrentBinding: vi.fn(async () => 'current' as const),
      },
    })

    await expect(
      draftReply(deps)(
        {
          reviewId: REVIEW_ID,
          text: 'Suggested reply',
          provenanceToken: 'signed-token',
        },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ _tag: 'ReviewError', code })
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
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
    ).rejects.toMatchObject({ code: 'invalid_reply', _tag: 'ReviewError' })
  })

  it('rejects text exceeding max length', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'x'.repeat(4097) }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', _tag: 'ReviewError' })
  })

  it('blocks staff role', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Hi' }, MEMBER_CTX),
    ).rejects.toMatchObject({ code: 'unauthorized', _tag: 'ReviewError' })
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
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('refuses to re-draft a published reply', async () => {
    const published = makeReply({ status: 'published', publicationState: 'published' })
    const deps = makeDeps({ replyRepo: replyRepoWith(published) })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
  })

  // `approved → draft` is the cancellation's move. A draft save that took it
  // rewrote the text of a reply a manager had confirmed, while its publication
  // was authorized, on the wire, or accepted by Google and not yet confirmed.
  it.each(['authorized', 'sending', 'pending_observation'] as const)(
    'refuses to rewrite a confirmed reply whose publication is %s',
    async (publicationState) => {
      const confirmed = makeReply({
        status: 'approved',
        approvedBy: ADMIN_ID,
        approvedAt: NOW,
        publicationState,
        publicationCycle: 1,
      })
      const deps = makeDeps({ replyRepo: replyRepoWith(confirmed) })

      await expect(
        draftReply(deps)({ reviewId: REVIEW_ID, text: 'Stale tab' }, MANAGER_CTX),
      ).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_transition',
        message: 'Only a draft or a rejected reply can be edited',
      })
      expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
      expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
    },
  )

  it('refuses to rewrite a failed reply and one whose draft still carries an open publication', async () => {
    for (const reply of [
      makeReply({ status: 'publish_failed', publicationState: 'ambiguous' }),
      makeReply({ status: 'publish_failed', publicationState: 'terminal' }),
      makeReply({ status: 'draft', publicationState: 'authorized', publicationCycle: 1 }),
    ]) {
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await expect(
        draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
      expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
    }
  })

  it('rewrites a draft whose publication was cancelled', async () => {
    const cancelled = makeReply({
      status: 'draft',
      publicationState: 'cancelled',
      publicationCycle: 1,
    })
    const deps = makeDeps({ replyRepo: replyRepoWith(cancelled) })

    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Second thoughts' },
      MANAGER_CTX,
    )

    expect(result).toMatchObject({ status: 'draft', text: 'Second thoughts' })
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      cancelled,
      { text: 'Second thoughts' },
      NOW,
    )
  })

  it('saves an existing draft through the guarded draft write, never an insert', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({ replyRepo: replyRepoWith(draft) })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Edited text', replyLanguageTag: 'en-GB' },
      MANAGER_CTX,
    )
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      draft,
      { text: 'Edited text', replyLanguageTag: 'en-GB' },
      NOW,
    )
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
    expect(result.status).toBe('draft')
  })

  it('re-drafts a rejected reply from the snapshot it read', async () => {
    const rejected = makeReply({ status: 'rejected', rejectionReason: 'Bad tone' })
    const deps = makeDeps({ replyRepo: replyRepoWith(rejected) })
    await draftReply(deps)({ reviewId: REVIEW_ID, text: 'Improved' }, MANAGER_CTX)
    expect(deps.replyRepo.saveDraft).toHaveBeenCalledWith(
      rejected,
      { text: 'Improved' },
      NOW,
    )
  })

  it('treats a lost race on re-draft (the draft write returns null) as invalid_transition', async () => {
    const rejected = makeReply({ status: 'rejected' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => rejected),
        saveDraft: vi.fn(async () => null),
      } as unknown as ReplyRepository,
    })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Try again' }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: 'Reply status changed concurrently',
    })
  })

  it('does not overwrite a reply that appeared between its read and its insert', async () => {
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        createDraft: vi.fn(async () => null),
      } as unknown as ReplyRepository,
    })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'First draft' }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: 'Reply status changed concurrently',
    })
    expect(deps.replyRepo.saveDraft).not.toHaveBeenCalled()
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('tags new reply with the caller organizationId (never a leaked org)', async () => {
    const createDraft = vi.fn(async (r: Reply) => r)
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        createDraft,
      } as unknown as ReplyRepository,
    })

    await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Tenant-scoped reply' },
      { ...MANAGER_CTX, organizationId: OTHER_ORG_ID },
    )

    expect(createDraft).toHaveBeenCalledTimes(1)
    const createdReply = createDraft.mock.calls[0]![0] as Reply
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
    ).rejects.toMatchObject({ code: 'reply_not_found', _tag: 'ReviewError' })
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
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('refuses a reply that is not a draft, or whose draft still carries an open publication', async () => {
    for (const reply of [
      makeReply({ status: 'pending_approval' }),
      makeReply({ status: 'rejected' }),
      makeReply({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 1,
      }),
      makeReply({ status: 'draft', publicationState: 'sending', publicationCycle: 1 }),
    ]) {
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await expect(
        submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        code: 'invalid_transition',
        _tag: 'ReviewError',
        message: 'Only a draft can be submitted for approval',
      })
      expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    }
  })

  it('records the reviewReplySubmitted fact with correct data', async () => {
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
    expect(deps.outbox.byTag('review.reply.submitted')).toHaveLength(1)
    const fact = deps.outbox.byTag('review.reply.submitted')[0]!
    expect(fact.replyId).toBe(REPLY_ID)
    expect(fact.reviewId).toBe(REVIEW_ID)
    expect(fact.propertyId).toBe(PROP_ID)
    expect(fact.organizationId).toBe(ORG_ID)
    expect(fact.userId).toBe(USER_ID)
    expect(fact.occurredAt).toBe(NOW)
  })

  it('refuses a draft with an unfilled template slot before transition', async () => {
    const draft = makeReply({ status: 'draft', text: 'Thank you, {guest_name}.' })
    const deps = makeDeps({
      replyRepo: replyRepoWith(draft),
    })

    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_reply',
      message: 'Fill every template placeholder before publishing: {guest_name}.',
    })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('treats a lost race (conditionalUpdate returns null) as invalid_transition', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
        conditionalUpdate: vi.fn(async () => null) as unknown as FakeGuardedWrite,
      } as unknown as ReplyRepository,
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.outbox.facts).toHaveLength(0)
  })
})

// ── approveReply ────────────────────────────────────────────────────────

describe('approveReply', () => {
  it('commits one authorization intent before enqueue and produces neither for a member', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    vi.mocked(deps.queue.addPublishJob).mockImplementation(async () => {
      expect(deps.outbox.byTag('review.reply.publication_requested')).toHaveLength(1)
    })

    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)

    expect(result).toMatchObject({
      status: 'approved',
      approvedBy: USER_ID,
      publicationCycle: 1,
    })
    const intents = deps.outbox.byTag('review.reply.publication_requested')
    expect(intents).toHaveLength(1)
    const intent = intents[0]!
    expect(intent).toMatchObject({
      replyId: REPLY_ID,
      reviewId: REVIEW_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      publicationCycle: 1,
    })
    expect(deps.queue.addPublishJob).toHaveBeenCalledOnce()
    expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: intent.replyId,
        organizationId: intent.organizationId,
        publicationCycle: intent.publicationCycle,
        propertyId: intent.propertyId,
        sourceEpoch: intent.sourceEpoch,
        materialReviewRevision: intent.materialReviewRevision,
        baseObservationRevision: intent.baseObservationRevision,
        initiator: { kind: 'user', id: USER_ID },
      },
      { idempotencyKey: buildIdempotencyKey(intent.replyId, intent.publicationCycle) },
    )

    const memberDeps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    await expect(
      approveReply(memberDeps)({ reviewId: REVIEW_ID }, MEMBER_CTX),
    ).rejects.toMatchObject({ code: 'unauthorized', _tag: 'ReviewError' })
    expect(memberDeps.outbox.byTag('review.reply.publication_requested')).toHaveLength(0)
    expect(memberDeps.queue.addPublishJob).not.toHaveBeenCalled()
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
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  // Approval is the move out of pending_approval. A failed reply is sent again
  // by retryPublish, which first proves an uncertain attempt never left RepKey.
  it.each([
    ['may already be on Google', { publicationState: 'ambiguous' as const }],
    [
      'ended its checks without an answer',
      {
        publicationState: 'terminal' as const,
        publicationLastErrorClass: 'ambiguous' as const,
      },
    ],
    [
      'failed and was not sent',
      {
        publicationState: 'terminal' as const,
        publicationLastErrorClass: 'retryable' as const,
      },
    ],
  ])('refuses to approve a failed reply that %s', async (_name, publication) => {
    const failed = makeReply({
      status: 'publish_failed',
      approvedBy: ADMIN_ID,
      approvedAt: NOW,
      publicationCycle: 1,
      publicationAttempts: 1,
      ...publication,
    })
    const deps = makeDeps({ replyRepo: replyRepoWith(failed) })

    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_transition',
      message: 'Only a reply that is waiting for approval can be confirmed and published',
    })
    expect(deps.propertyPublicationScope.getPublicationScope).not.toHaveBeenCalled()
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('refuses to approve a reply that is already being published or is published', async () => {
    for (const reply of [
      makeReply({ status: 'approved', publicationState: 'sending', publicationCycle: 1 }),
      makeReply({ status: 'published', publicationState: 'published' }),
      makeReply({ status: 'rejected' }),
    ]) {
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await expect(
        approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
      expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    }
  })

  it('approves a resubmitted reply whose earlier publication was cancelled', async () => {
    const resubmitted = makeReply({
      status: 'pending_approval',
      publicationState: 'cancelled',
      publicationCycle: 1,
    })
    const deps = makeDeps({ replyRepo: replyRepoWith(resubmitted) })

    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)

    expect(result).toMatchObject({
      status: 'approved',
      publicationState: 'authorized',
      publicationCycle: 2,
      approvedBy: USER_ID,
    })
    expect(deps.outbox.byTag('review.reply.approved')).toHaveLength(1)
  })

  it('refuses approval while a template slot remains without reserving publication work', async () => {
    const pending = makeReply({
      status: 'pending_approval',
      text: 'Dear {guest_name}, thank you.',
    })
    const deps = makeDeps({
      replyRepo: replyRepoWith(pending),
    })

    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_reply',
      message: 'Fill every template placeholder before publishing: {guest_name}.',
    })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('records the reviewReplyApproved fact with correct data', async () => {
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
    expect(deps.outbox.byTag('review.reply.approved')).toHaveLength(1)
    const fact = deps.outbox.byTag('review.reply.approved')[0]!
    expect(fact.replyId).toBe(REPLY_ID)
    expect(fact.reviewId).toBe(REVIEW_ID)
    expect(fact.propertyId).toBe(PROP_ID)
    expect(fact.organizationId).toBe(ORG_ID)
    expect(fact.userId).toBe(USER_ID)
    expect(fact.occurredAt).toBe(NOW)
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

  it('edits text, re-enters the publication machine, records review.reply.updated, and enqueues the republish', async () => {
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
    expect(result.publicationCycle).toBe(1)
    expect(result.publicationAttempts).toBe(0)
    expect(result.publicationLastErrorClass).toBeNull()
    expect(result.reconcileDueAt).toEqual(
      new Date(NOW.getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS),
    )

    const fact = deps.outbox.byTag('review.reply.updated')[0]!
    expect(fact.replyId).toBe(REPLY_ID)
    expect(fact.reviewId).toBe(REVIEW_ID)
    expect(fact.propertyId).toBe(PROP_ID)
    expect(fact.organizationId).toBe(ORG_ID)
    expect(fact.userId).toBe(USER_ID)

    expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: REPLY_ID,
        organizationId: ORG_ID,
        publicationCycle: 1,
        propertyId: PROP_ID,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
        initiator: { kind: 'user', id: USER_ID },
      },
      { idempotencyKey: buildIdempotencyKey(REPLY_ID, 1) },
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
    expect(deps.outbox.facts).toHaveLength(0)
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('refuses an edit containing an unfilled slot before reply or provider work', async () => {
    const deps = makeDeps()

    await expect(
      editPublishedReply(deps)(
        { reviewId: REVIEW_ID, text: 'Thank you, {staff_name}.' },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_reply',
      message: 'Fill every template placeholder before publishing: {staff_name}.',
    })
    expect(deps.replyRepo.findInternalByReviewId).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
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
        conditionalUpdate: vi.fn(async () => null) as unknown as FakeGuardedWrite,
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

  it('refuses a reply that is not waiting for approval', async () => {
    for (const reply of [
      makeReply({ status: 'draft' }),
      makeReply({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 1,
      }),
      makeReply({ status: 'publish_failed', publicationState: 'terminal' }),
    ]) {
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await expect(
        rejectReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        code: 'invalid_transition',
        _tag: 'ReviewError',
        message: 'Only a reply that is waiting for approval can be rejected',
      })
      expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    }
  })

  it('records the reviewReplyRejected fact with correct data', async () => {
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
    expect(deps.outbox.byTag('review.reply.rejected')).toHaveLength(1)
    const fact = deps.outbox.byTag('review.reply.rejected')[0]!
    expect(fact.replyId).toBe(REPLY_ID)
    expect(fact.reviewId).toBe(REVIEW_ID)
    expect(fact.propertyId).toBe(PROP_ID)
    expect(fact.organizationId).toBe(ORG_ID)
    expect(fact.userId).toBe(USER_ID)
    expect(fact.reason).toBe('Tone too aggressive')
    expect(fact.occurredAt).toBe(NOW)
  })
})

// ── deleteReply ─────────────────────────────────────────────────────────

describe('deleteReply', () => {
  it.each(['draft', 'rejected'] as const)(
    'deletes a %s reply that was never confirmed',
    async (status) => {
      const reply = makeReply({ status })
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
      expect(deps.replyRepo.deleteDraft).toHaveBeenCalledWith(reply)
    },
  )

  it('rejects deleting non-draft reply', async () => {
    const published = makeReply({ status: 'published', publicationState: 'published' })
    const deps = makeDeps({ replyRepo: replyRepoWith(published) })
    await expect(
      deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: 'Can only delete draft or rejected replies',
    })
    expect(deps.replyRepo.deleteDraft).not.toHaveBeenCalled()
  })

  // A cancelled publication returns the reply to draft, where Delete is
  // offered. Its authorization (and any attempt) rows reference it ON DELETE
  // RESTRICT: the delete used to reach the database and fail as a 500.
  it.each(['draft', 'rejected'] as const)(
    'refuses, in words, a %s reply that was confirmed for publishing before',
    async (status) => {
      const cancelled = makeReply({
        status,
        publicationState: 'cancelled',
        publicationCycle: 1,
      })
      const deps = makeDeps({ replyRepo: replyRepoWith(cancelled) })

      await expect(
        deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_transition',
        message:
          'This reply was confirmed for publishing before, so RepKey keeps it with its publication record. Edit it and submit it again, or leave it as a draft.',
      })
      expect(deps.replyRepo.deleteDraft).not.toHaveBeenCalled()
    },
  )

  it('treats a reply that changed before the delete as invalid_transition', async () => {
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => makeReply({ status: 'draft' })),
        deleteDraft: vi.fn(async () => false),
      } as unknown as ReplyRepository,
    })
    await expect(
      deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: 'Reply status changed concurrently',
    })
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
    expect(result.publicationCycle).toBe(1)
    expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: REPLY_ID,
        organizationId: ORG_ID,
        publicationCycle: 1,
        propertyId: PROP_ID,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
        initiator: { kind: 'user', id: USER_ID },
      },
      { idempotencyKey: buildIdempotencyKey(REPLY_ID, 1) },
    )
  })

  it('treats provider-confirmed publication as an idempotent retry when reconciliation wins the race', async () => {
    const published = makeReply({ status: 'published', publicationState: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })

    await expect(retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)).resolves.toBe(
      published,
    )
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('fails closed when published status lacks settled publication state', async () => {
    const inconsistent = makeReply({
      status: 'published',
      publicationState: 'ambiguous',
      publicationCycle: 1,
      publicationAttempts: 1,
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: NOW,
    })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => inconsistent),
        findById: vi.fn(async () => inconsistent),
      } as unknown as ReplyRepository,
    })

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: WONT_SEND_AGAIN,
    })
    expect(deps.dispatchEvidence.findDispatchEvidence).not.toHaveBeenCalled()
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('rejects retry for an ineligible non-failed reply', async () => {
    const draft = makeReply({ status: 'draft', publicationState: null })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  // Retry used to run the approval write for a reply still waiting for
  // approval: published with no approver and no review.reply.approved fact.
  it('refuses a reply that is still waiting for approval, authorizing nothing', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({ replyRepo: replyRepoWith(pending) })

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_transition',
      message: 'Only a reply that failed to publish can be sent again',
    })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('refuses a reply whose publication is still in flight', async () => {
    for (const publicationState of [
      'authorized',
      'sending',
      'pending_observation',
    ] as const) {
      const inFlight = makeReply({
        status: 'approved',
        publicationState,
        publicationCycle: 1,
      })
      const deps = makeDeps({ replyRepo: replyRepoWith(inFlight) })
      await expect(
        retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
      expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    }
  })

  // D4: an uncertain attempt may be sent again ONLY on positive evidence that
  // no request for it left RepKey. Retry never reads Google: absence on a read
  // is not that evidence, and checking is checkReplyPublication's job.
  const ambiguousAttempt = (overrides: Partial<Reply> = {}) =>
    makeReply({
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationCycle: 1,
      publicationAttempts: 2,
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: NOW,
      ...overrides,
    })

  const depsForUncertain = (reply: Reply, evidence: ReplyDispatchEvidence) => {
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => reply),
      } as unknown as ReplyRepository,
    })
    vi.mocked(deps.dispatchEvidence.findDispatchEvidence).mockResolvedValue(evidence)
    return deps
  }

  it.each([
    ['a legacy ambiguous row', ambiguousAttempt()],
    [
      'terminal ambiguity',
      ambiguousAttempt({ publicationState: 'terminal', reconcileDueAt: null }),
    ],
  ])(
    'settles %s that never reached Google, then authorizes a new cycle and enqueues once',
    async (_name, reply) => {
      const deps = depsForUncertain(reply, 'never_dispatched')

      const result = await retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)

      expect(deps.dispatchEvidence.findDispatchEvidence).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        replyId: REPLY_ID,
        publicationCycle: 1,
        attemptNumber: 2,
        attemptStartedAt: ATTEMPT_STARTED_AT,
        now: NOW,
      })
      expect(deps.commandStore.settleNeverDispatchedAttempt).toHaveBeenCalledWith(
        reply,
        expect.objectContaining({
          _tag: 'review.reply.publish_failed',
          replyId: REPLY_ID,
        }),
        NOW,
      )
      expect(result).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 2,
      })
      expect(deps.queue.addPublishJob).toHaveBeenCalledOnce()
      expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
        expect.objectContaining({ replyId: REPLY_ID, publicationCycle: 2 }),
        { idempotencyKey: buildIdempotencyKey(REPLY_ID, 2) },
      )
      // Already publish_failed: no second failure fact, one publication intent.
      expect(deps.outbox.facts.map((fact) => fact._tag)).toEqual([
        'review.reply.publication_requested',
      ])
    },
  )

  it.each<ReplyDispatchEvidence>(['possibly_dispatched', 'too_recent'])(
    'refuses to send an ambiguous reply again when the evidence is %s',
    async (evidence) => {
      const deps = depsForUncertain(ambiguousAttempt(), evidence)

      await expect(
        retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_transition',
        message: WONT_SEND_AGAIN,
      })
      expect(deps.commandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
      expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
      expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    },
  )

  it('refuses when no dated attempt row exists to judge', async () => {
    const deps = depsForUncertain(ambiguousAttempt(), 'never_dispatched')
    vi.mocked(deps.replyRepo.findCurrentPublicationAttemptStartedAt).mockResolvedValue(
      null,
    )

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: WONT_SEND_AGAIN })
    expect(deps.dispatchEvidence.findDispatchEvidence).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('returns the published reply when a confirmation wins the settle race', async () => {
    const reply = ambiguousAttempt()
    const published = {
      ...reply,
      status: 'published' as const,
      publicationState: 'published' as const,
    }
    const deps = depsForUncertain(reply, 'never_dispatched')
    vi.mocked(deps.replyRepo.conditionalUpdate).mockResolvedValue(null)
    vi.mocked(deps.replyRepo.findById).mockResolvedValue(published)

    await expect(retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)).resolves.toBe(
      published,
    )
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('refuses when the settle race is lost to anything but a confirmation', async () => {
    const reply = ambiguousAttempt()
    const deps = depsForUncertain(reply, 'never_dispatched')
    vi.mocked(deps.replyRepo.conditionalUpdate).mockResolvedValue(null)
    vi.mocked(deps.replyRepo.findById).mockResolvedValue(reply)

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: WONT_SEND_AGAIN })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })
})

// ── TOCTOU guard — conditionalUpdate atomicity ─────────────────────────
// Every transition use case commits through a guarded store write, so that a
// concurrent status change invalidates the write. A null return = lost race →
// invalid_transition, and no fact/job side-effects must fire.

describe('reply ops — TOCTOU guard (conditionalUpdate returns null → invalid_transition)', () => {
  const nullConditional = vi.fn(async () => null) as unknown as FakeGuardedWrite

  it('approveReply: lost race throws invalid_transition, no job enqueued or fact', async () => {
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
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('rejectReply: lost race throws invalid_transition, no fact', async () => {
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
    expect(deps.outbox.facts).toHaveLength(0)
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

  it('submitReply: lost race throws invalid_transition, no fact', async () => {
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
    expect(deps.outbox.facts).toHaveLength(0)
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
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
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
    expect(assigned.replyRepo.deleteDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: REPLY_ID, organizationId: ORG_ID }),
    )
  })

  it('retryPublish rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(
        makeReply({ status: 'publish_failed', publicationState: 'terminal' }),
      ),
    })
    await expect(
      retryPublish(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(
        makeReply({ status: 'publish_failed', publicationState: 'terminal' }),
      ),
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
})

// ── Google's reply comment rule (bytes, not characters) ────────────────

describe('reply ops — refuse text Google cannot be sent', () => {
  // 2049 Cyrillic letters are 2049 UTF-16 units but 4098 UTF-8 bytes: under
  // the old character cap they were approved and then failed compile in the
  // worker, where nobody saw why (route-catalogue.ts reviews.reply body).
  const TOO_LONG_CYRILLIC = 'Б'.repeat(2_049)
  const TOO_LONG =
    'This reply is too long for Google. Shorten it to 4,096 bytes or fewer.'
  const BAD_CHARACTER =
    "This reply contains a character Google doesn't accept. Remove any unusual control characters and try again."
  const MULTI_LINE = 'Hi Jane,\n\nThank you for staying with us.\tSee you soon!\r\n'

  it('draftReply refuses 2049 Cyrillic letters before any read or write', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: TOO_LONG_CYRILLIC }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', message: TOO_LONG })
    expect(deps.reviewRepo.findById).not.toHaveBeenCalled()
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
  })

  it('draftReply refuses a control character and a lone surrogate', async () => {
    const deps = makeDeps()
    for (const text of ['Thanks\u001B', 'Thanks \uD83D']) {
      await expect(
        draftReply(deps)({ reviewId: REVIEW_ID, text }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_reply', message: BAD_CHARACTER })
    }
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
  })

  it('draftReply saves 2048 Cyrillic letters and multi-line text', async () => {
    const deps = makeDeps()
    for (const text of ['Б'.repeat(2_048), MULTI_LINE]) {
      const saved = await draftReply(deps)({ reviewId: REVIEW_ID, text }, MANAGER_CTX)
      expect(saved.text).toBe(text)
    }
  })

  it('submitReply refuses a stored draft Google cannot take, with no transition', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'draft', text: TOO_LONG_CYRILLIC })),
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', message: TOO_LONG })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('approveReply refuses a stored reply Google cannot take, reserving no publication', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({ status: 'pending_approval', text: TOO_LONG_CYRILLIC }),
      ),
    })
    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', message: TOO_LONG })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('submitReply and approveReply accept multi-line text', async () => {
    const draftDeps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'draft', text: MULTI_LINE })),
    })
    const submitted = await submitReply(draftDeps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(submitted.status).toBe('pending_approval')

    const pendingDeps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({ status: 'pending_approval', text: MULTI_LINE }),
      ),
    })
    const approved = await approveReply(pendingDeps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(approved.status).toBe('approved')
    expect(pendingDeps.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })

  it('editPublishedReply refuses 2049 Cyrillic letters before reply or provider work', async () => {
    const deps = makeDeps()
    await expect(
      editPublishedReply(deps)(
        { reviewId: REVIEW_ID, text: TOO_LONG_CYRILLIC },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'invalid_reply', message: TOO_LONG })
    expect(deps.replyRepo.findInternalByReviewId).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('editPublishedReply republishes multi-line text', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({
          status: 'published',
          text: 'Old public reply',
          publicationState: 'published',
          publicationAttempts: 1,
          publishedAt: NOW,
        }),
      ),
    })
    const result = await editPublishedReply(deps)(
      { reviewId: REVIEW_ID, text: 'Hi Jane,\n\nThank you.' },
      MANAGER_CTX,
    )
    expect(result.text).toBe('Hi Jane,\n\nThank you.')
    expect(deps.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })
})

// ── Property publication scope ─────────────────────────────────────────
//
// Google is asked to publish only for an active Property at the source epoch
// the Review was observed at; the provider authorizer refuses anything else,
// and the worker reports that refusal as "Google rejected the reply". The
// commands refuse up front, in words, and reserve no publication cycle.

describe('Property publication scope', () => {
  const REMOVED =
    "This property has been removed, so RepKey won't send its replies to Google. Restore it from the Removed list to publish this reply."
  const NOT_RECHECKED =
    "RepKey hasn't checked this review on Google since its property was restored or reconnected. Try again after the next sync."

  const CLOSING =
    "Your organization is being closed, so RepKey won't send replies to Google."
  const DELETING =
    "This property is being deleted, so RepKey won't send its replies to Google."

  const archived = {
    getPublicationScope: vi.fn(async () => ({
      lifecycle: 'archived' as const,
      sourceEpoch: 1,
    })),
  }
  const restored = {
    getPublicationScope: vi.fn(async () => ({
      lifecycle: 'active' as const,
      sourceEpoch: 2,
    })),
  }

  const expectNoPublicationCycle = (deps: TestReplyDeps) => {
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  }

  it('refuses to approve a reply for a removed Property and reserves no cycle', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
      propertyPublicationScope: archived,
    })

    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: REMOVED })
    expect(archived.getPublicationScope).toHaveBeenCalledWith(ORG_ID, PROP_ID)
    expectNoPublicationCycle(deps)
  })

  // Only an archived Property is on the Removed list; the other states say
  // what is actually happening to it, with no remedy the manager lacks.
  it.each([
    ['suspended while its Organization closes', { lifecycle: 'suspended' }, CLOSING],
    ['on its way to deletion', { lifecycle: 'removing' }, DELETING],
    ['no longer present', null, DELETING],
  ] as const)(
    'refuses to approve for a Property %s, in its own words',
    async (_label, state, message) => {
      const deps = makeDeps({
        replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
        propertyPublicationScope: {
          getPublicationScope: vi.fn(async () =>
            state === null ? null : { ...state, sourceEpoch: 0 },
          ),
        },
      })

      await expect(
        approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_transition', message })
      expectNoPublicationCycle(deps)
    },
  )

  it('refuses to approve until the Review is observed at the restored Property epoch', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
      reviewRepo: {
        findById: vi.fn(async () => makeReview({ sourceEpoch: 1 })),
      } as unknown as ReviewRepository,
      propertyPublicationScope: restored,
    })

    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: NOT_RECHECKED })
    expectNoPublicationCycle(deps)
  })

  it('refuses to republish an edited reply for a removed Property', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({
          status: 'published',
          text: 'Old public reply',
          publicationState: 'published',
          publicationAttempts: 1,
          publishedAt: NOW,
        }),
      ),
      propertyPublicationScope: archived,
    })

    await expect(
      editPublishedReply(deps)(
        { reviewId: REVIEW_ID, text: 'Improved public reply' },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: REMOVED })
    expectNoPublicationCycle(deps)
  })

  it('refuses a retry for a removed Property before settling any attempt', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationCycle: 1,
          publicationAttempts: 2,
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: NOW,
        }),
      ),
      propertyPublicationScope: archived,
    })
    vi.mocked(deps.dispatchEvidence.findDispatchEvidence).mockResolvedValue(
      'never_dispatched',
    )

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: REMOVED })
    expect(deps.commandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
    expectNoPublicationCycle(deps)
  })
})
