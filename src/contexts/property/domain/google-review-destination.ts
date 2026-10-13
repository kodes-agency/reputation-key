import { normalizeGoogleReviewDestination } from '#/shared/domain/google-review-destination'
import type { GoogleBindingState } from './google-binding-contract'
import type { PropertyLifecycleState } from './property-lifecycle'

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

/**
 * The destination state a Property lifecycle transition commits. A transition
 * never changes which destination is held: only provider discovery or import
 * accepts one, and no state invents one where none is held.
 *
 * Leaving `active` fences a held destination as `awaiting_refresh`. Returning
 * to `active` lifts that fence while the Google binding is still `active`:
 * every binding change (disconnect, relink, scrub) either moves the binding off
 * `active` or replaces the destination, so an `active` binding that still holds
 * a fenced destination is the same binding (connection, account, location) it
 * was accepted for. Under any other binding it stays fenced until a relink
 * accepts a new one.
 */
export function googleReviewDestinationStateAfterLifecycleTransition(
  input: Readonly<{
    held: GoogleReviewDestinationState
    to: PropertyLifecycleState
    googleBindingState: GoogleBindingState
  }>,
): GoogleReviewDestinationState {
  if (input.held === 'unavailable') return 'unavailable'
  return input.to === 'active' && input.googleBindingState === 'active'
    ? 'verified'
    : 'awaiting_refresh'
}
