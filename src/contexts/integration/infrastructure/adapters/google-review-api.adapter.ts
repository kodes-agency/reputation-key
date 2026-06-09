// Integration context — Google Review API adapter implementing review context's facade port
// Standalone adapter — does NOT share code with gbp-api.adapter.ts (GbpApiPort).
// Uses RefreshGoogleToken use case for token management. Pagination handled internally.

import type { GoogleReviewApiPort } from '#/contexts/review/application/public-api'
import type { GoogleReview, StarRating } from '#/contexts/review/application/public-api'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import type { GoogleConnectionRepository } from '../../application/ports/google-connection.repository'
import type { TokenEncryptionPort } from '../../application/ports/token-encryption.port'
import type { RefreshGoogleToken } from '../../application/use-cases/refresh-google-token'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { integrationError } from '../../domain/errors'

const REVIEWS_API_BASE = 'https://mybusiness.googleapis.com/v4'

/** GBP returns star ratings as uppercase words 'ONE' through 'FIVE' */
const STAR_RATING_MAP: Record<string, StarRating | undefined> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

// ── GBP Reviews API response types ──────────────────────────────────

type GbpReviewsPageResponse = Readonly<{
  reviews?: ReadonlyArray<GbpReviewItem>
  nextPageToken?: string
}>

type GbpReviewItem = Readonly<{
  name: string
  starRating?: string
  comment?: string
  reviewer?: { displayName?: string; profilePhotoUrl?: string }
  reviewReply?: { comment?: string; updateTime?: string }
  createTime: string
}>

// ── Adapter ─────────────────────────────────────────────────────────

type GoogleReviewApiAdapterDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  encryption: TokenEncryptionPort
  refreshToken: RefreshGoogleToken
}>

export const createGoogleReviewApiAdapter = (
  deps: GoogleReviewApiAdapterDeps,
): GoogleReviewApiPort => {
  const resolveAccessToken = async (
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
  ): Promise<string> => {
    const connection = await deps.refreshToken(organizationId, connectionId)
    return deps.encryption.decrypt(connection.encryptedAccessToken)
  }

  const withTimeout = (ms: number) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    return { signal: controller.signal, clear: () => clearTimeout(timer) }
  }

  const throwApiError = (operation: string, status: number, body: string): never => {
    const isRateLimited = status === 429
    throw integrationError(
      isRateLimited ? 'gbp_api_rate_limited' : 'gbp_api_error',
      `GBP ${operation} failed: ${status} ${body}`,
      isRateLimited,
    )
  }

  const mapReview = (raw: GbpReviewItem): GoogleReview | null => {
    const reviewName = raw.name
    const reviewId = reviewName.split('/').pop() ?? ''
    const rating = raw.starRating ? STAR_RATING_MAP[raw.starRating] : undefined

    if (!rating) {
      getLogger().warn(
        { starRating: raw.starRating, reviewId },
        'Unknown star rating, skipping review',
      )
      return null
    }

    return {
      reviewName,
      externalId: reviewId,
      externalLocationId: '',
      reviewerName: raw.reviewer?.displayName ?? null,
      reviewerProfilePhotoUrl: raw.reviewer?.profilePhotoUrl ?? null,
      rating,
      text: raw.comment ?? null,
      languageCode: null,
      reviewedAt: new Date(raw.createTime),
      replyText: raw.reviewReply?.comment ?? null,
      replyUpdatedAt: raw.reviewReply?.updateTime
        ? new Date(raw.reviewReply.updateTime)
        : null,
    }
  }

  const fetchReviews: GoogleReviewApiPort['fetchReviews'] = async (
    organizationId,
    connectionId,
    locationName,
  ) => {
    const accessToken = await resolveAccessToken(organizationId, connectionId)
    const allReviews: GoogleReview[] = []
    let pageToken: string | undefined

    do {
      const params = new URLSearchParams({ pageSize: '100' })
      if (pageToken) params.set('pageToken', pageToken)

      const url = `${REVIEWS_API_BASE}/${locationName}/reviews?${params.toString()}`
      const { signal, clear } = withTimeout(30_000)
      let response: Response
      try {
        response = await trace('googleReviewApi.fetchReviews', () =>
          fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal,
          }),
        )
      } finally {
        clear()
      }

      if (!response.ok) {
        const body = await response.text()
        throwApiError('reviews fetch', response.status, body)
      }

      const data = (await response.json()) as GbpReviewsPageResponse

      for (const raw of data.reviews ?? []) {
        const mapped = mapReview(raw)
        if (mapped) {
          allReviews.push({ ...mapped, externalLocationId: locationName })
        }
      }

      pageToken = data.nextPageToken
    } while (pageToken)

    return allReviews
  }

  const replyToReview: GoogleReviewApiPort['replyToReview'] = async (
    organizationId,
    connectionId,
    reviewName,
    text,
  ) => {
    const accessToken = await resolveAccessToken(organizationId, connectionId)

    const { signal, clear } = withTimeout(30_000)
    let response: Response
    try {
      response = await trace('googleReviewApi.replyToReview', () =>
        fetch(`${REVIEWS_API_BASE}/${reviewName}/reply`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ comment: text }),
          signal,
        }),
      )
    } finally {
      clear()
    }

    if (!response.ok) {
      const body = await response.text()
      throwApiError('reply', response.status, body)
    }
  }

  return { fetchReviews, replyToReview }
}
