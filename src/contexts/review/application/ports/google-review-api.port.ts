// Review context — bounded, provider-token-free Google Reviews facade.
// Integration owns provider pagination tokens and exposes only opaque cursor references.

import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GoogleProviderDispatch } from '#/shared/google-provider-control/egress-gateway'
import type { GoogleReview } from '../../domain/types'

export type GoogleReviewPage = Readonly<{
  reviews: readonly GoogleReview[]
  totalReviewCount: number
  /** Provider-owned aggregate for the exact page snapshot. Null is valid only
   * when the provider reports zero reviews. */
  averageRating: number | null
  nextCursorRef: string | null
}>

export type GoogleReviewApiErrorCode =
  | 'invalid_request'
  | 'cursor_not_found'
  | 'cursor_expired'
  | 'cursor_binding_mismatch'
  | 'cursor_exhausted'
  | 'cursor_capacity_exceeded'
  | 'authorization_changed'
  | 'malformed_response'
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

export type GoogleReviewGetRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  locationName: string
  reviewName: string
}>

export type GoogleReviewGetResult =
  Readonly<{ status: 'found'; review: GoogleReview }> | Readonly<{ status: 'not_found' }>

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
