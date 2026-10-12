import { describe, expect, it } from 'vitest'
import { GOOGLE_BINDING_STATES } from './google-binding-contract'
import {
  awaitingRefreshGoogleReviewDestination,
  googleReviewDestinationStateAfterLifecycleTransition,
  unavailableGoogleReviewDestination,
  verifiedGoogleReviewDestination,
} from './google-review-destination'

describe('Property Google review destination', () => {
  it('pins provider URI to the binding and profile generations', () => {
    const retrievedAt = new Date('2026-08-25T12:00:00Z')
    expect(
      verifiedGoogleReviewDestination({
        uri: 'https://search.google.com/local/writereview?placeid=abc',
        retrievedAt,
        sourceEpoch: 2,
        profileVersion: 4,
      }),
    ).toEqual({
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=abc',
      retrievedAt,
      sourceEpoch: 2,
      profileVersion: 4,
    })
  })

  it('rejects an untrusted URI or invalid generation', () => {
    expect(
      verifiedGoogleReviewDestination({
        uri: 'https://evil.example/review',
        retrievedAt: new Date(),
        sourceEpoch: 0,
        profileVersion: 1,
      }),
    ).toBeNull()
    expect(
      verifiedGoogleReviewDestination({
        uri: 'https://search.google.com/review',
        retrievedAt: new Date(),
        sourceEpoch: -1,
        profileVersion: 1,
      }),
    ).toBeNull()
  })

  it('retains a verified URI internally while marking it awaiting refresh', () => {
    const current = verifiedGoogleReviewDestination({
      uri: 'https://search.google.com/review',
      retrievedAt: new Date('2026-08-25T12:00:00Z'),
      sourceEpoch: 1,
      profileVersion: 2,
    })!
    expect(awaitingRefreshGoogleReviewDestination(current)).toEqual({
      ...current,
      state: 'awaiting_refresh',
    })
    expect(
      awaitingRefreshGoogleReviewDestination(unavailableGoogleReviewDestination()),
    ).toEqual(unavailableGoogleReviewDestination())
  })

  it('fences a held destination when the Property leaves active, whatever its binding', () => {
    for (const googleBindingState of GOOGLE_BINDING_STATES) {
      for (const held of ['verified', 'awaiting_refresh'] as const) {
        expect(
          googleReviewDestinationStateAfterLifecycleTransition({
            held,
            to: 'archived',
            googleBindingState,
          }),
        ).toBe('awaiting_refresh')
      }
    }
  })

  it('lifts the fence on return to active only while the binding is still active', () => {
    for (const held of ['verified', 'awaiting_refresh'] as const) {
      expect(
        googleReviewDestinationStateAfterLifecycleTransition({
          held,
          to: 'active',
          googleBindingState: 'active',
        }),
      ).toBe('verified')
    }
    for (const googleBindingState of [
      'disconnected',
      'unbound',
      'account_confirmation_required',
    ] as const) {
      for (const held of ['verified', 'awaiting_refresh'] as const) {
        expect(
          googleReviewDestinationStateAfterLifecycleTransition({
            held,
            to: 'active',
            googleBindingState,
          }),
        ).toBe('awaiting_refresh')
      }
    }
  })

  it('never turns a Property with no destination into one that has it', () => {
    for (const googleBindingState of GOOGLE_BINDING_STATES) {
      for (const to of ['archived', 'active'] as const) {
        expect(
          googleReviewDestinationStateAfterLifecycleTransition({
            held: 'unavailable',
            to,
            googleBindingState,
          }),
        ).toBe('unavailable')
      }
    }
  })
})
