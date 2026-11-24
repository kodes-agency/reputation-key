// Shared fakes and builders for the reply operation tests

import { vi } from 'vitest'
import {
  nextPublicationState,
  PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
} from '../domain/reply-publication-workflow'
import type { ReplyDeps } from './reply-operations.server'
import type {
  ReplyRepository,
  ConditionalReplyUpdate,
} from './reply-repository.port.server'
import type { ReplyCommandStore } from './reply-command-store.port.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'
import type { ReplyQueuePort } from '../publication/reply-queue.port.server'
import {
  createRecordedOutbox,
  type RecordedOutbox,
} from '#/shared/testing/recorded-outbox'
import type { DomainEvent } from '#/shared/events/events'
import type { Reply, Review } from '../domain/review-types'
import type { ReplyDispatchEvidence } from '../publication/reply-publication-dispatch-evidence.port.server'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import {
  reviewId,
  replyId,
  organizationId,
  userId as toUserId,
  propertyId,
} from '#/shared/domain/ids'

export const ORG_ID = organizationId('org-1')
export const OTHER_ORG_ID = organizationId('org-isolated')
export const REVIEW_ID = reviewId('51000000-0000-4000-8000-000000000010')
export const REPLY_ID = replyId('51000000-0000-4000-8000-000000000020')
export const USER_ID = toUserId('user-1')
export const ADMIN_ID = toUserId('admin-1')
export const PROP_ID = propertyId('51000000-0000-4000-8000-000000000001')
export const NOW = new Date('2025-06-01T12:00:00Z')
export const ATTEMPT_STARTED_AT = new Date('2025-06-01T10:00:00Z')
export const WONT_SEND_AGAIN =
  "RepKey won't send this reply again because Google may already have it. Use Check Google again instead."

export function makeReview(overrides: Partial<Review> = {}): Review {
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
    googleReviewUrl: null,
    rating: 5,
    text: 'Great!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW,
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

export function makeReply(overrides: Partial<Reply> = {}): Reply {
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
  }
}

export const makeStaffApi = (
  accessible: ReadonlyArray<PropertyId> | null,
): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

export const replyRepoWith = (
  reply: Reply | null,
  overrides: Partial<FakeReplyRepository> = {},
): FakeReplyRepository => ({
  ...makeDeps().replyRepo,
  findInternalByReviewId: vi.fn(async () => reply),
  ...overrides,
})

/** Deps whose reply repository finds `reply` for the review. */
export const depsWith = (
  reply: Reply | null,
  overrides: Partial<FakeReplyRepository> = {},
  depsOverrides: Partial<ReplyDeps> = {},
): TestReplyDeps =>
  makeDeps({ replyRepo: replyRepoWith(reply, overrides), ...depsOverrides })

/**
 * The fake command store's guarded write. The production store owns its SQL
 * guard; here one overridable seam stands in for it, so a test can make any
 * store command lose its race by returning null.
 */
export type FakeGuardedWrite = (
  id: Reply['id'],
  organizationId: Reply['organizationId'],
  expectedStatuses: ReadonlyArray<Reply['status']>,
  updates: ConditionalReplyUpdate,
  now?: Date,
) => Promise<Reply | null>
export type FakeReplyRepository = ReplyRepository & {
  conditionalUpdate: FakeGuardedWrite
}

/**
 * In-memory fake of ReplyCommandStore (application zone must not import
 * infra). Mirrors the production contract: guarded conditionalUpdate first,
 * then the outbox fact; a lost race (conditionalUpdate → null) records
 * nothing. `getReplyRepo` resolves lazily so per-test replyRepo overrides
 * take effect.
 */
export function makeReplyCommandStoreFake(
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
    // Authorize mirrors the production write — guarded status update
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
  }
}

export type TestReplyDeps = Omit<ReplyDeps, 'replyRepo'> & {
  replyRepo: FakeReplyRepository
  outbox: RecordedOutbox
}

export function makeDeps(overrides: Partial<ReplyDeps> = {}): TestReplyDeps {
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
    replyLibrary: { loadSnapshot: vi.fn(async () => null) },
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

export const MANAGER_CTX = {
  role: 'PropertyManager' as const,
  userId: USER_ID,
  organizationId: ORG_ID,
}
export const ADMIN_CTX = {
  role: 'AccountAdmin' as const,
  userId: ADMIN_ID,
  organizationId: ORG_ID,
}
export const MEMBER_CTX = {
  role: 'Member' as const,
  userId: USER_ID,
  organizationId: ORG_ID,
}
