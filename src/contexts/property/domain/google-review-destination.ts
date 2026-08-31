import { normalizeGoogleReviewDestination } from '#/shared/domain/google-review-destination'

export const GOOGLE_REVIEW_DESTINATION_STATES = [
  'verified',
  'awaiting_refresh',
  'unavailable',
] as const

export type GoogleReviewDestinationState =
  (typeof GOOGLE_REVIEW_DESTINATION_STATES)[number]

export type PropertyGoogleReviewDestination = Readonly<{
  state: GoogleReviewDestinationState
  uri: string | null
  retrievedAt: Date | null
  sourceEpoch: number | null
  profileVersion: number | null
}>

export const unavailableGoogleReviewDestination =
  (): PropertyGoogleReviewDestination => ({
    state: 'unavailable',
    uri: null,
    retrievedAt: null,
    sourceEpoch: null,
    profileVersion: null,
  })

export function verifiedGoogleReviewDestination(
  input: Readonly<{
    uri: string
    retrievedAt: Date
    sourceEpoch: number
    profileVersion: number
  }>,
): PropertyGoogleReviewDestination | null {
  const uri = normalizeGoogleReviewDestination(input.uri)
  if (
    !uri ||
    !Number.isSafeInteger(input.sourceEpoch) ||
    input.sourceEpoch < 0 ||
    !Number.isSafeInteger(input.profileVersion) ||
    input.profileVersion < 1 ||
    Number.isNaN(input.retrievedAt.getTime())
  ) {
    return null
  }
  return {
    state: 'verified',
    uri,
    retrievedAt: input.retrievedAt,
    sourceEpoch: input.sourceEpoch,
    profileVersion: input.profileVersion,
  }
}

export function awaitingRefreshGoogleReviewDestination(
  current: PropertyGoogleReviewDestination,
): PropertyGoogleReviewDestination {
  return current.state === 'verified'
    ? { ...current, state: 'awaiting_refresh' }
    : current
}
