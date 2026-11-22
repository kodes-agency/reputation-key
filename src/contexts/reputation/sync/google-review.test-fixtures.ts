import type { GoogleReviewPage, GoogleReviewRead } from './google-review-api.port.server'

type GoogleReviewFixture = Readonly<{
  /** The location resource the review hangs under. */
  location: string
  slug: string
  publishedAt: Date
  externalId?: string
  rating?: GoogleReviewRead['rating']
  overrides?: Partial<GoogleReviewRead>
}>

/** A published, unanswered Google review, as the Google API reads it. */
export function googleReviewFixture(fixture: GoogleReviewFixture): GoogleReviewRead {
  const { location, slug, publishedAt } = fixture
  return {
    reviewName: `${location}/reviews/${slug}`,
    externalId: fixture.externalId ?? slug,
    externalLocationId: location,
    reviewerName: `Guest ${slug}`,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: fixture.rating ?? 4,
    text: `Review ${slug}`,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: publishedAt,
    sourceCreatedAt: publishedAt,
    sourceUpdatedAt: publishedAt,
    replyText: null,
    replyUpdatedAt: null,
    ...fixture.overrides,
  }
}

export function googleReviewPage(
  reviews: readonly GoogleReviewRead[],
  totalReviewCount: number,
  nextCursorRef: string | null = null,
  averageRating = 4,
): GoogleReviewPage {
  return { reviews, totalReviewCount, averageRating, nextCursorRef }
}
