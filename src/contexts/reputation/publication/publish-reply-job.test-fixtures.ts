import { vi } from 'vitest'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/shared/testing/google-provider-identifiers-v1'
export const NOW = new Date('2026-07-17T00:00:00Z')
export const JOB_DATA = {
  replyId: 'reply-1',
  organizationId: 'org-1',
  publicationCycle: 1,
  propertyId: 'prop-1',
  sourceEpoch: 0,
  materialReviewRevision: 1,
  baseObservationRevision: 0,
}

export const approvedReply = {
  id: 'reply-1',
  reviewId: 'rev-1',
  organizationId: 'org-1',
  text: 'Thanks!',
  status: 'approved',
  source: 'internal',
  createdBy: 'user-1',
  approvedBy: 'user-1',
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  stateRevision: 1,
  submittedAt: NOW,
  approvedAt: NOW,
  publishedAt: null,
  publicationState: 'authorized',
  publicationCycle: 1,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}

export const review = {
  id: 'rev-1',
  organizationId: 'org-1',
  propertyId: 'prop-1',
  googleConnectionId: 'conn-1',
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  sourceEpoch: 0,
  sourceRevision: 1,
  replyStateRevision: 1,
  contentExpiresAt: new Date('2026-08-16T00:00:00Z'),
}

/** Error shape thrown by the Google review API adapter (integration context). */
export function gbpApiError(status: number): Error {
  return Object.assign(new Error('Failed to reach Google review API'), {
    _tag: 'IntegrationError',
    code: 'gbp_api_error',
    context: { operation: 'reply', status, bodyBytes: 100 },
  })
}

export function gbpRateLimited(): Error {
  return Object.assign(new Error('Failed to reach Google review API'), {
    _tag: 'IntegrationError',
    code: 'gbp_api_rate_limited',
    context: { operation: 'reply', status: 429, bodyBytes: 100 },
  })
}

/** Pre-request failure: the connection is gone before the PUT is ever sent. */
export function connectionGone(): Error {
  return Object.assign(new Error('Google connection is disconnected'), {
    _tag: 'IntegrationError',
    code: 'connection_disconnected',
    context: {},
  })
}

/** Pre-request failure: token refresh failed before the PUT was sent. */
export function tokenRefreshFailed(): Error {
  return Object.assign(new Error('Failed to refresh Google access token'), {
    _tag: 'IntegrationError',
    code: 'token_refresh_failed',
    context: {},
  })
}

export function abortError(): Error {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

/** The review adapter's error, carrying the dispatch the provider plane recorded (D2). */
export function reviewApiFailure(
  code: string,
  failure: Readonly<{
    executionCode: string | null
    dispatch: 'not_sent' | 'answered' | 'unknown'
    providerStatus: number | null
  }>,
): Error {
  const status =
    failure.providerStatus === null ? '' : `; status ${failure.providerStatus}`
  return Object.assign(
    new Error(
      `Google review API request failed (${failure.executionCode ?? code}; ${failure.dispatch}${status})`,
    ),
    { _tag: 'GoogleReviewApiError', code, recoverable: true, failure },
  )
}

export function governedExecutorLostResponse(): Error {
  return Object.assign(new Error('governed provider execution failed after dispatch'), {
    _tag: 'GbpApiError',
    kind: 'upstream_error',
  })
}

export function makeDeps() {
  const replyCommandStore = {
    submitReply: vi.fn(),
    rejectReply: vi.fn(),
    markPublished: vi.fn(async (reply: object, updates: object, _event: object) => ({
      ...reply,
      ...updates,
    })),
    markProviderOutcomePendingObservation: vi.fn(
      async (reply: object, _outcome: object) => ({
        ...reply,
        publicationState: 'pending_observation',
      }),
    ),
    markPublicationAuthorized: vi.fn(),
    markPublicationSending: vi.fn(async (reply: typeof approvedReply) =>
      reply.publicationState === 'authorized'
        ? {
            ...reply,
            publicationState: 'sending',
            publicationAttempts: reply.publicationAttempts + 1,
          }
        : null,
    ),
    markPublicationTerminal: vi.fn(
      async (reply: object, errorClass: string, _event: object) => ({
        ...reply,
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: errorClass,
      }),
    ),
    markPublicationAmbiguous: vi.fn(async (reply: object, _event: object) => ({
      ...reply,
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationLastErrorClass: 'ambiguous',
    })),
    markPublicationRetryQueued: vi.fn(async (reply: object) => ({
      ...reply,
      publicationState: 'authorized',
    })),
    deferUncertainSend: vi.fn(async (reply: object, dueAt: Date, _now: Date) => ({
      ...reply,
      reconcileDueAt: dueAt,
    })),
    rescheduleAmbiguousReconciliation: vi.fn(),
    settleNeverDispatchedAttempt: vi.fn(
      async (reply: object, _event: object | null, _now: Date) => ({
        ...reply,
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
        reconcileDueAt: null,
      }),
    ),
    cancelPublications: vi.fn(),
  }
  return {
    replyRepo: {
      findById: vi.fn().mockResolvedValue(approvedReply),
      // A BullMQ backoff retry reads back 15-30 s after the attempt started.
      findCurrentPublicationAttemptStartedAt: vi
        .fn()
        .mockResolvedValue(new Date(NOW.getTime() - 30_000)),
    },
    reviewRepo: { findById: vi.fn().mockResolvedValue(review) },
    dispatchEvidence: {
      findDispatchEvidence: vi.fn().mockResolvedValue('too_recent'),
    },
    googleReviewApi: {
      replyToReview: vi.fn().mockResolvedValue({ providerCorrelationId: 'google-1' }),
      getReview: vi.fn().mockResolvedValue({
        status: 'found',
        review: {
          reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
          replyText: 'Thanks!',
          replyUpdatedAt: NOW,
        },
      }),
    },
    googleConnectionStatus: { findStatus: vi.fn().mockResolvedValue('active') },
    googleReplyObservationStore: {
      allocateReadGeneration: vi.fn(async () => 1),
      record: vi.fn().mockResolvedValue({
        observationRevision: 1,
        change: 'added',
        resolution: 'confirmed_on_google',
        matchedReplyId: 'reply-1',
        matchedPublicationCycle: 1,
        duplicate: false,
      }),
      // The head the manager authorized against (JOB_DATA.baseObservationRevision 0).
      findCurrentHead: vi.fn().mockResolvedValue(null),
    },
    // The read of Google before a fresh claim finds nothing that stops the
    // publication; publish-reply-preread.test.ts covers what it does otherwise.
    readBeforePublish: vi.fn().mockResolvedValue({ status: 'recorded' }),
    replyCommandStore,
    clock: () => NOW,
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    idGen: () => 'reply-1',
    staffPublicApi: {},
  }
}

export const makeJob = (attemptsMade = 0, data = JOB_DATA) =>
  ({ id: 'job-1', data, attemptsMade }) as never

export const absentOnGoogle = () => ({
  status: 'found',
  review: {
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    replyText: null,
    replyUpdatedAt: NOW,
  },
})
