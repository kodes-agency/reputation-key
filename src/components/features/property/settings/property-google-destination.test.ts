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

  it('sends a restored, disconnected Property to relink', () => {
    expect(
      googleReviewDestinationText({
        lifecycleState: 'active',
        googleBindingState: 'disconnected',
        googleReviewDestination: { state: 'awaiting_refresh' },
      }),
    ).toBe('On hold — relink the Business Profile to bring the review link back')
  })

  it('tells an archived, disconnected Property to restore first: the import relinks only an active one', () => {
    expect(
      googleReviewDestinationText({
        lifecycleState: 'archived',
        googleBindingState: 'disconnected',
        googleReviewDestination: { state: 'awaiting_refresh' },
      }),
    ).toBe(
      'On hold while this property is archived — restore it, then relink the Business Profile',
    )
  })

  it('says publishing is blocked for an active, linked Property whose review link is on hold', () => {
    expect(
      googleReviewDestinationText({
        ...linked,
        googleReviewDestination: { state: 'awaiting_refresh' },
      }),
    ).toBe(
      'On hold — portals cannot be published and any live portal offers private feedback only',
    )
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

  it('names Google as the reason a linked Property has no review link, and says publishing is blocked', () => {
    expect(
      googleReviewDestinationText({
        ...linked,
        googleReviewDestination: { state: 'unavailable' },
      }),
    ).toBe(
      'Unavailable — Google gave no review link for this Business Profile, so portals cannot be published and any live portal offers private feedback only',
    )
  })

  it('says publishing is blocked for a Property that is not linked', () => {
    expect(
      googleReviewDestinationText({
        lifecycleState: 'active',
        googleBindingState: 'unbound',
        googleReviewDestination: { state: 'unavailable' },
      }),
    ).toBe(
      'Unavailable — portals cannot be published and any live portal offers private feedback only',
    )
  })

  it('never describes a Property without a verified review link by its live portals alone', () => {
    // Publishing needs a verified destination, so "private feedback only" on
    // its own would hide that no Portal of the Property can go live.
    const texts = (['awaiting_refresh', 'unavailable'] as const).flatMap((state) =>
      (['active', 'archived'] as const).flatMap((lifecycleState) =>
        (['active', 'disconnected', 'unbound'] as const).map((googleBindingState) =>
          googleReviewDestinationText({
            lifecycleState,
            googleBindingState,
            googleReviewDestination: { state },
          }),
        ),
      ),
    )

    expect(
      texts.filter(
        (text) =>
          !/cannot be published|restor(e|ing) it|relink the Business Profile/.test(text),
      ),
    ).toEqual([])
  })

  it('says nothing was checked when the Property carries no destination', () => {
    expect(googleReviewDestinationText({ ...linked })).toBe('Not checked yet')
  })
})
