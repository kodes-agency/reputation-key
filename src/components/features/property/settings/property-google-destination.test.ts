import { describe, expect, it } from 'vitest'
import { googleReviewDestinationText } from './property-google-destination'

const linked = { lifecycleState: 'active', googleBindingState: 'active' } as const

describe('Google review destination text on the settings card', () => {
  it('says guests can leave a review only for a verified destination', () => {
    expect(
      googleReviewDestinationText({
        ...linked,
        googleReviewDestination: { state: 'verified' },
      }),
    ).toBe('Verified — guests can leave a Google review')
  })

  it('says an archived, still linked Property gets its review link back on restore', () => {
    expect(
      googleReviewDestinationText({
        lifecycleState: 'archived',
        googleBindingState: 'active',
        googleReviewDestination: { state: 'awaiting_refresh' },
      }),
    ).toBe(
      'On hold while this property is archived — restoring it brings the review link back',
    )
  })

  it('sends a disconnected Property to relink, archived or restored', () => {
    for (const lifecycleState of ['archived', 'active'] as const) {
      expect(
        googleReviewDestinationText({
          lifecycleState,
          googleBindingState: 'disconnected',
          googleReviewDestination: { state: 'awaiting_refresh' },
        }),
      ).toBe('On hold — relink the Business Profile to bring the review link back')
    }
  })

  it('never claims a refresh is under way, because nothing performs one', () => {
    const texts = (['active', 'archived', 'suspended'] as const).flatMap(
      (lifecycleState) =>
        (['active', 'disconnected', 'unbound'] as const).map((googleBindingState) =>
          googleReviewDestinationText({
            lifecycleState,
            googleBindingState,
            googleReviewDestination: { state: 'awaiting_refresh' },
          }),
        ),
    )

    expect(texts.filter((text) => /refresh/i.test(text))).toEqual([])
    expect(texts.every((text) => text.startsWith('On hold'))).toBe(true)
  })

  it('names Google as the reason a linked Property has no review link', () => {
    expect(
      googleReviewDestinationText({
        ...linked,
        googleReviewDestination: { state: 'unavailable' },
      }),
    ).toBe(
      'Unavailable — Google gave no review link for this Business Profile, so portals offer private feedback only',
    )
  })

  it('keeps the plain wording for a Property that is not linked', () => {
    expect(
      googleReviewDestinationText({
        lifecycleState: 'active',
        googleBindingState: 'unbound',
        googleReviewDestination: { state: 'unavailable' },
      }),
    ).toBe('Unavailable — portals offer private feedback only')
    expect(googleReviewDestinationText({ ...linked })).toBe('Not checked yet')
  })
})
