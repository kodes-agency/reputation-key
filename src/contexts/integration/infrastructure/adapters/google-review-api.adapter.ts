// Integration context — Google Review API adapter implementing review context's facade port
// Standalone adapter — does NOT share code with gbp-api.adapter.ts (GbpApiPort).
// Uses RefreshGoogleToken use case for token management. Pagination handled internally.

import type { GoogleReviewApiPort } from '#/contexts/review/application/ports/google-review-api.port'
import type { GoogleReview } from '#/contexts/review/domain/types'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import type { GoogleConnectionRepository } from '../../application/ports/google-connection.repository'
import type { TokenEncryptionPort } from '../../application/ports/token-encryption.port'
import type { RefreshGoogleToken } from '../../application/use-cases/refresh-google-token'
import type { StarRating } from '#/contexts/review/domain/types'
import { getLogger } from '#/shared/observability/logger'
import { integrationError } from '../../domain/errors'

const REVIEWS_API_BASE = 'https://mybusiness.googleapis.com/v4'

/** GBP returns star ratings as uppercase words 'ONE' through 'FIVE' */
const STAR_RATING_MAP = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
} as const

type GoogleReviewApiAdapterDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  encryption: TokenEncryptionPort
  refreshToken: RefreshGoogleToken
}>

export const createGoogleReviewApiAdapter = (deps: GoogleReviewApiAdapterDeps): GoogleReviewApiPort => {
  const resolveAccessToken = async (organizationId: OrganizationId, connectionId: GoogleConnectionId): Promise<string> => {
    // Delegate to the existing RefreshGoogleToken use case:
    // finds connection, checks status, refreshes if needed, returns connection with fresh tokens
    const connection = await deps.refreshToken(organizationId, connectionId)

    // Decrypt the (now fresh) access token
    return deps.encryption.decrypt(connection.encryptedAccessToken)
  }

  /** Create an AbortController that fires after `ms` milliseconds */
  const withTimeout = (ms: number) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    return { signal: controller.signal, clear: () => clearTimeout(timer) }
  }

  const fetchReviews: GoogleReviewApiPort['fetchReviews'] = async (organizationId, connectionId, locationName) => {
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
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal,
        })
      } finally {
        clear()
      }

      if (!response.ok) {
        const body = await response.text()
        const code = response.status === 429 ? 'gbp_api_rate_limited' : 'gbp_api_error'
        throw integrationError(code, `GBP reviews fetch failed: ${response.status} ${body}`)
      }

      const data = await response.json() as {
        reviews?: Array<Record<string, unknown>>
        nextPageToken?: string
      }

      for (const raw of data.reviews ?? []) {
        const reviewName = raw.name as string
        const reviewId = reviewName.split('/').pop() ?? ''
        const starRatingStr = raw.starRating as string | undefined

        const rating = starRatingStr ? (STAR_RATING_MAP as Record<string, StarRating | undefined>)[starRatingStr] : undefined
        if (!rating) {
          getLogger().warn({ starRating: starRatingStr, reviewId }, 'Unknown star rating, skipping review')
          continue
        }

        // GBP review.text is { text: string, languageCode: string }, not a plain string
        const textObj = raw.text as { text?: string; languageCode?: string } | null | undefined

        allReviews.push({
          reviewName,
          externalId: reviewId,
          externalLocationId: locationName,
          reviewerName: (raw.reviewer as Record<string, unknown> | undefined)?.displayName as string | null ?? null,
          reviewerProfilePhotoUrl: (raw.reviewer as Record<string, unknown> | undefined)?.profilePhotoUrl as string | null ?? null,
          rating,
          text: textObj?.text ?? null,
          languageCode: textObj?.languageCode ?? null,
          reviewedAt: new Date(raw.createTime as string),
          replyText: (raw.reviewReply as Record<string, unknown> | undefined)?.comment as string | null ?? null,
          replyUpdatedAt: (raw.reviewReply as Record<string, unknown> | undefined)?.updateTime
            ? new Date((raw.reviewReply as Record<string, unknown>).updateTime as string)
            : null,
        })
      }

      pageToken = data.nextPageToken
    } while (pageToken)

    return allReviews
  }

  const replyToReview: GoogleReviewApiPort['replyToReview'] = async (organizationId, connectionId, reviewName, text) => {
    const accessToken = await resolveAccessToken(organizationId, connectionId)

    const { signal, clear } = withTimeout(30_000)
    let response: Response
    try {
      response = await fetch(`${REVIEWS_API_BASE}/${reviewName}/reply`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: text }),
        signal,
      })
    } finally {
      clear()
    }

    if (!response.ok) {
      const body = await response.text()
      const code = response.status === 429 ? 'gbp_api_rate_limited' : 'gbp_api_error'
      throw integrationError(code, `GBP reply failed: ${response.status} ${body}`)
    }
  }

  return { fetchReviews, replyToReview }
}
