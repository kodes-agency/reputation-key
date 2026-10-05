// The one rating-threshold field (UI consistency scan: FORM-03, FORM-08).
//
// "How low a rating" was asked three ways: a native select of 1 to 5 stars on the
// Portal editor ("N stars or below"), a Select of Off and 1 to 4 stars on the
// notification page ("N★ or lower"), and a number box on the Organization targets
// ("At or below (stars)"). One field now, one wording: the star glyph on screen and
// the word read aloud, because a screen reader says "★" as "black star". The markup
// is pinned here (server-rendered, no DOM; a closed Select draws no options), the
// options and the choice in the Storybook project.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  RATING_THRESHOLDS,
  ratingThresholdWords,
  spokenRatingThresholdWords,
} from './rating-threshold'
import { RatingThresholdField } from './rating-threshold-field'

describe('the words of a threshold', () => {
  it('prints the glyph on screen: "3★ or lower"', () => {
    expect(ratingThresholdWords(3)).toBe('3★ or lower')
    expect(ratingThresholdWords(5)).toBe('5★ or lower')
  })

  it('says "only" for the lowest rating, which has nothing below it', () => {
    expect(ratingThresholdWords(1)).toBe('1★ only')
    expect(spokenRatingThresholdWords(1)).toBe('1 star only')
  })

  it('reads the same aloud without the glyph: "3 stars or lower"', () => {
    expect(spokenRatingThresholdWords(3)).toBe('3 stars or lower')
    expect(spokenRatingThresholdWords(2)).not.toContain('★')
  })

  it('offers the five ratings', () => {
    expect([...RATING_THRESHOLDS]).toEqual([1, 2, 3, 4, 5])
  })
})

type Props = Parameters<typeof RatingThresholdField>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(RatingThresholdField, {
      id: 'threshold',
      label: 'Private feedback threshold',
      value: 3,
      onValueChange: () => undefined,
      ...props,
    } as Props),
  )
}

describe('RatingThresholdField', () => {
  it('is a select named by its label, in the shared field frame', () => {
    const html = render()

    expect(html).toContain('role="combobox"')
    expect(html).toMatch(
      /<label[^>]*for="threshold"[^>]*>Private feedback threshold<\/label>/u,
    )
    expect(html).toContain('id="threshold"')
    expect(html).toContain('data-slot="select-trigger"')
  })

  it('names its help as the select description', () => {
    const html = render({ description: 'Controls when the private note is offered.' })

    expect(html).toContain('aria-describedby="threshold-description"')
    expect(html).toContain('Controls when the private note is offered.')
  })

  it('keeps the visible label inside an accessible name that says more', () => {
    const html = render({
      label: 'In the app',
      accessibleName: 'Low ratings: In the app',
    })

    expect(html).toContain('aria-label="Low ratings: In the app"')
  })

  it('reads as invalid, with its reason, when the schema refuses it', () => {
    const html = render({ invalid: true, errors: [{ message: 'Choose a rating' }] })

    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('Choose a rating')
  })

  it('disables the select', () => {
    expect(render({ disabled: true })).toMatch(
      /role="combobox"[^>]*disabled=""|disabled=""[^>]*role="combobox"/u,
    )
  })
})
