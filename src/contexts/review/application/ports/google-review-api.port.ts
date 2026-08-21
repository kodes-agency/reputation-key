// Review context — bounded, provider-token-free Google Reviews facade.
// Integration owns provider pagination tokens and exposes only opaque cursor references.

import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GoogleReview } from '../../domain/types'

export type GoogleReviewPage = Readonly<{
  reviews: readonly GoogleReview[]
  totalReviewCount: number
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

export type GoogleReviewApiError = Error &
  Readonly<{
    _tag: 'GoogleReviewApiError'
    code: GoogleReviewApiErrorCode
    recoverable: boolean
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
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
    reviewName: string,
    text: string,
  ): Promise<void>
}>
