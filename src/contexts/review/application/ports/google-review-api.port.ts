// Review context — bounded, provider-token-free Google Reviews facade.
// Integration owns provider pagination tokens and exposes only opaque cursor references.

import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GoogleProviderDispatch } from '#/shared/google-provider-control/egress-gateway'
import type { GoogleReview } from '../../domain/types'

/**
 * A Google review as the provider adapter maps it.
 *
 * `replyUnreadable` is true when Google returned a reply comment but no
 * original text is recoverable from it (a translation-only envelope); `replyText`
 * is then null and MUST NOT be read as "Google has no reply". A targeted
 * publication read records nothing for it and reports `unreadable`.
 *
 * Optional so fakes and consumers that predate it keep today's behaviour (a
 * missing flag reads as a readable reply); the adapter always sets it.
 */
export type GoogleReviewRead = GoogleReview & Readonly<{ replyUnreadable?: boolean }>

export type GoogleReviewPage = Readonly<{
  reviews: readonly GoogleReviewRead[]
  totalReviewCount: number
  /** Provider-owned aggregate for the exact page snapshot. Null is valid only
   * when the provider reports zero reviews. */
  averageRating: number | null
  nextCursorRef: string | null
}>

/**
 * Google's newest page: `reviews.list` page 1 ordered `updateTime desc`, which
 * Google documents as always accurate. No cursor reference exists for it and it
 * can never be continued: `hasMore` only says Google had more to give.
 */
export type GoogleReviewHeadResult =
  | Readonly<{
      status: 'ok'
      reviews: readonly GoogleReviewRead[]
      totalReviewCount: number
      /** Null only when the provider reports zero reviews. */
      averageRating: number | null
      /** Google had a further page. */
      hasMore: boolean
    }>
  /**
   * Google did not honor `orderBy`: a review lacked an updateTime, or one was
   * newer than the one before it. Nothing else is returned; such a page is
   * never compared with.
   */
  | Readonly<{ status: 'order_violation' }>

/**
 * The `code` of the error a process without a Google provider (a local or e2e
 * stack, a worker with none configured) throws from every call, before any
 * request is made. Callers that must not wait on it can tell it apart from a
 * real outage and from a refusal.
 */
export const GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE = 'google_review_api_not_configured'

/** The error such a process throws, carrying that code. */
export const googleReviewApiNotConfigured = (): Error =>
  Object.assign(new Error('Governed Google review API is unavailable'), {
    code: GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE,
  })

/**
 * The `code` of the error a Google read throws when the Property's Google
 * connection cannot be used at all: it waits for a reconnect, was disconnected,
 * or lost the Business Profile scope. Nothing reached Google, and no retry can
 * change that until someone reconnects, so a step that meets it ends quietly
 * (the reconnect notice is already the signal) instead of failing and
 * retrying. It is the integration authorizer's `connection_unusable`; the
 * authorizer's other refusals (`authorization_denied`, `runtime_unavailable`,
 * `stale_source`) stay loud.
 */
export const GOOGLE_CONNECTION_UNUSABLE_CODE = 'connection_unusable'

/** Whether a rejected Google read was refused for an unusable connection. */
export const isGoogleConnectionUnusable = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === GOOGLE_CONNECTION_UNUSABLE_CODE

export type GoogleReviewApiErrorCode =
  | 'invalid_request'
  | 'cursor_not_found'
  | 'cursor_expired'
  | 'cursor_binding_mismatch'
  | 'cursor_exhausted'
  | 'cursor_capacity_exceeded'
  | 'authorization_changed'
  // Refused because the Google connection waits for an AccountAdmin to
  // reconnect it; nothing reached Google as a reply, and no retry can until then.
  | 'reauthorization_required'
  | 'malformed_response'
  // Google answered that the Location or the request is not valid (404, 400).
  // Every retry gets the same answer, so a run ends on it instead of waiting.
  | 'provider_rejected'
  | 'provider_rate_limited'
  | 'provider_unavailable'

/**
 * Content-free evidence about one failed provider request. The reply
 * publication classifier decides retry safety from `dispatch` (only `not_sent`
 * proves no request reached Google); codes and the status are for logs and
 * BullMQ's failedReason.
 */
export type GoogleReviewApiFailure = Readonly<{
  /** Executor/gateway code (the admission code when one was given). */
  executionCode: string | null
  dispatch: GoogleProviderDispatch
  providerStatus: number | null
}>

export type GoogleReviewApiError = Error &
  Readonly<{
    _tag: 'GoogleReviewApiError'
    code: GoogleReviewApiErrorCode
    recoverable: boolean
    retryAfterMs?: number
    /** Absent when the error carries no dispatch evidence (treated as unknown). */
    failure?: GoogleReviewApiFailure
    /**
     * On `cursor_not_found` only: when the cursor store started, in epoch ms,
     * when it could tell. It keeps nothing across a restart, so a cursor of a
     * run that began before this instant was lost to the restart.
     */
    cursorStoreStartedAtMs?: number
  }>

export type GoogleReviewPageRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  locationName: string
  runId: string
  phase: 'main' | 'confirmation'
  pageIndex: number
  cursorRef: string | null
}>

export type GoogleReviewHeadRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  locationName: string
}>

export type GoogleReviewGetRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  locationName: string
  reviewName: string
  /**
   * The read RepKey makes right before it publishes a reply. Its authorization
   * refusals take the write path's vocabulary (a connection that waits for a
   * reconnect is `reauthorization_required`, an outage is a retryable
   * `provider_unavailable` that sent nothing), so the publish job can tell its
   * author the same things whether the read or the write was refused. Every
   * other read keeps the authorizer's own codes.
   */
  forReplyPublication?: true
}>

export type GoogleReviewGetResult =
  | Readonly<{ status: 'found'; review: GoogleReviewRead }>
  | Readonly<{ status: 'not_found' }>

export type GoogleReplyPublicationResult = Readonly<{
  /** Provider-supplied request correlation when available; null is honest. */
  providerCorrelationId: string | null
}>

export type GoogleReplyPublicationRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  reviewId: string
  materialReviewRevision: number
  replyId: string
  publicationCycle: number
  attemptNumber: number
  reviewName: string
  text: string
}>

export type GoogleReviewApiPort = Readonly<{
  listReviewsPage(input: GoogleReviewPageRequest): Promise<GoogleReviewPage>
  /**
   * One call for Google's newest-updated reviews, with no run, no cursor and no
   * continuation. Throws a `GoogleReviewApiError` like every other read.
   */
  readReviewsHead(input: GoogleReviewHeadRequest): Promise<GoogleReviewHeadResult>
  getReview(input: GoogleReviewGetRequest): Promise<GoogleReviewGetResult>
  discardReviewCursors(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      runId: string
    }>,
  ): Promise<void>
  replyToReview(
    input: GoogleReplyPublicationRequest,
  ): Promise<GoogleReplyPublicationResult>
}>
