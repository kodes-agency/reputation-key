// The Immersive Hub's rating card and after-rating layout (boards G03, G04,
// G05, G08), rendered to markup and read back. The unit project has no DOM, so
// keyboard and focus behaviour is covered by the stories' play functions; what
// is pinned here is what a guest is shown, in what order, and what must not
// depend on the rating.
//
// ADR 0044, "Anti-gating rule": the Google card is the same markup in the same
// place after every rating. The legacy page proves this in
// `guest-page-view.test.ts`; this is the same proof on the immersive DOM.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatGuestPlural, guestCopyText } from '../guest-copy-format'
import type { GuestPagePreviewState } from '../guest-page-preview-state'
import { directChildren, text } from '../__fixtures__/markup-walk'
import {
  DISPLAY_NAME,
  PACKS,
  RATINGS,
  renderResponse,
} from './__fixtures__/immersive-response-fixtures'
import { ratingChoiceError } from './immersive-rating-card'
import { immersiveResponseProps } from './immersive-response-preview'
import { ImmersiveResponseView } from './immersive-response-view'
import { IMMERSIVE_RESPONSE_CSS } from './immersive-response-styles'

const stars = (pack: (typeof PACKS)[number], count: number) =>
  formatGuestPlural(pack.plurals.ratingStars, count, pack.locale)
const wordOf = (pack: (typeof PACKS)[number], rating: number) =>
  pack.copy[`ratingWord${rating as 1 | 2 | 3 | 4 | 5}` as const]
const responseChildren = (html: string) => directChildren(html, 'data-ih-response')
const body = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')

describe.each(PACKS)('the rating card [$locale]', (pack) => {
  const html = body(renderResponse(pack, { kind: 'arrival' }))

  it('asks the question, shows the scale ends and offers "Send privately"', () => {
    expect(html).toContain(`>${pack.copy.ratingTitle}</h2>`)
    expect(text(html)).toContain(pack.copy.ratingScaleLow)
    expect(text(html)).toContain(pack.copy.ratingScaleHigh)
    expect(html).toMatch(
      new RegExp(`<button[^>]*type="submit"[^>]*>${pack.copy.ratingSend}</button>`),
    )
  })

  it('gives every star a v3 accessible name made of the count and the word', () => {
    for (const rating of RATINGS) {
      const name = `${stars(pack, rating)}, ${wordOf(pack, rating)}`
      expect(name).toBe(
        guestCopyText(pack, 'ratingOption', {
          stars: stars(pack, rating),
          word: wordOf(pack, rating),
        }),
      )
      expect(html).toContain(`aria-label="${name}"`)
    }
  })

  it('is one radio group of five, none chosen on arrival', () => {
    expect(html.match(/<input[^>]*type="radio"/gu)).toHaveLength(5)
    expect(html).not.toMatch(/<input[^>]*checked/u)
    expect(html).toContain(`role="radiogroup" aria-label="${pack.copy.ratingGroupLabel}"`)
  })

  it('says who sees the rating, with the property name', () => {
    expect(text(html)).toContain(
      guestCopyText(pack, 'ratingPrivacyLine', { name: DISPLAY_NAME }),
    )
  })

  it('carries the honeypot, hidden from assistive technology', () => {
    expect(html).toContain(`<label for=`)
    expect(html).toContain(pack.copy.honeypotLabel)
    expect(html).toMatch(/aria-hidden="true"[^>]*><label/u)
  })

  it('shows no error and no banner until something fails', () => {
    expect(html).not.toContain('role="alert"')
  })

  it('shows the save failure as an alert above the button', () => {
    const failed = body(renderResponse(pack, { kind: 'arrival' }, { failure: 'rating' }))
    expect(failed).toMatch(
      new RegExp(
        `role="alert"[^>]*>(?:<svg[\\s\\S]*?</svg>)?<span>${pack.copy.ratingSaveFailed}</span>`,
      ),
    )
    expect(failed.indexOf('role="alert"')).toBeLessThan(failed.indexOf('type="submit"'))
  })

  it('disables the choices and says "Sending" while a rating is on its way', () => {
    const pending = body(renderResponse(pack, { kind: 'arrival' }, { pending: true }))
    expect(pending).toContain(pack.copy.sending)
    expect(pending).toMatch(/<fieldset[^>]*disabled/u)
  })
})

describe('ratingChoiceError', () => {
  it('asks for a rating when none is chosen, and accepts 1 to 5', () => {
    expect(ratingChoiceError(0)).toBe('choose')
    expect(ratingChoiceError(6)).toBe('choose')
    for (const rating of RATINGS) expect(ratingChoiceError(rating)).toBeNull()
  })
})

describe('touch targets and motion', () => {
  it('sizes a star to the 54 px target of the boards', () => {
    expect(IMMERSIVE_RESPONSE_CSS).toMatch(/\.ih-star\s*\{[^}]*width:\s*54px/u)
    expect(IMMERSIVE_RESPONSE_CSS).toMatch(/\.ih-star\s*\{[^}]*height:\s*54px/u)
  })

  it('removes its transitions for a guest who asks for reduced motion', () => {
    expect(IMMERSIVE_RESPONSE_CSS).toContain('prefers-reduced-motion: reduce')
  })
})

describe.each(PACKS)('after a rating [$locale]', (pack) => {
  const rendered = RATINGS.map((rating) => ({
    rating,
    html: body(renderResponse(pack, { kind: 'rated', rating })),
  }))
  const googleIndex = (children: readonly string[]) =>
    children.findIndex((child) => child.includes(pack.copy.googleTitle))
  const noteIndex = (children: readonly string[]) =>
    children.findIndex((child) => child.includes(pack.copy.noteOfferTitle))

  it('shows the receipt strip first: thank you, the stars, the word, Change', () => {
    for (const { rating, html } of rendered) {
      const [strip] = responseChildren(html)
      expect(text(strip ?? ''), `rating ${rating}`).toContain(pack.copy.ratingThanks)
      expect(strip, `rating ${rating}`).toContain(`aria-label="${stars(pack, rating)}"`)
      expect(text(strip ?? '')).toContain(
        guestCopyText(pack, 'ratingSentSummary', { word: wordOf(pack, rating) }),
      )
      expect(text(strip ?? '')).toContain(pack.copy.ratingChange)
    }
  })

  it('puts the Google card second at every rating', () => {
    for (const { rating, html } of rendered) {
      expect(googleIndex(responseChildren(html)), `rating ${rating}`).toBe(1)
    }
  })

  it('renders identical Google card markup for ratings 1 to 5', () => {
    const cards = rendered.map(({ html }) => {
      const children = responseChildren(html)
      return children[googleIndex(children)]
    })
    expect(new Set(cards).size).toBe(1)
  })

  it('keeps the Google card heading, copy, action and hint the same at every rating', () => {
    for (const { rating, html } of rendered) {
      const children = responseChildren(html)
      const card = children[googleIndex(children)] ?? ''
      expect(card, `rating ${rating}`).toContain(`>${pack.copy.googleTitle}</h2>`)
      expect(card).toContain(`>${pack.copy.googleBody}</p>`)
      expect(text(/<button\b[^>]*>(.*?)<\/button>/su.exec(card)?.[1] ?? '')).toContain(
        pack.copy.googleAction,
      )
      expect(card).toContain(pack.copy.googleHint)
      expect(/<button\b[^>]*\sdisabled(?=[\s=>])/u.test(card)).toBe(false)
    }
  })

  it('offers the note at 3 stars and not at 4 (the threshold boundary)', () => {
    const at = (rating: number) =>
      noteIndex(responseChildren(body(renderResponse(pack, { kind: 'rated', rating }))))
    expect(at(1)).toBe(2)
    expect(at(2)).toBe(2)
    expect(at(3)).toBe(2)
    expect(at(4)).toBe(-1)
    expect(at(5)).toBe(-1)
  })

  it('moves the boundary with the portal threshold', () => {
    const at = (rating: number, threshold: number) =>
      noteIndex(
        responseChildren(
          body(renderResponse(pack, { kind: 'rated', rating }, {}, threshold)),
        ),
      )
    expect(at(4, 4)).toBe(2)
    expect(at(5, 4)).toBe(-1)
    expect(at(2, 1)).toBe(-1)
  })

  it('follows the server flag, not the rating, for the note', () => {
    const pinned = (state: GuestPagePreviewState) =>
      noteIndex(responseChildren(body(renderResponse(pack, state))))
    expect(pinned({ kind: 'rated', rating: 5, noteEligible: true })).toBe(2)
    expect(pinned({ kind: 'rated', rating: 1, noteEligible: false })).toBe(-1)
  })

  it('shows the note card collapsed, with a button that opens it', () => {
    const [, , note] = responseChildren(rendered[0]?.html ?? '')
    expect(note).toContain(`>${pack.copy.noteOfferTitle}</h2>`)
    expect(text(note ?? '')).toContain(
      guestCopyText(pack, 'noteOfferBody', { name: DISPLAY_NAME }),
    )
    expect(text(note ?? '')).toContain(pack.copy.noteOfferAction)
    expect(note).not.toContain('<textarea')
  })

  it('writes the note in a labelled field with a hint, Send and Not now', () => {
    const html = body(
      renderResponse(pack, { kind: 'note-writing', rating: 2, draft: 'Towels ran out' }),
    )
    const [, , note] = responseChildren(html)
    expect(note).toMatch(/<textarea[^>]*maxLength="2000"/u)
    expect(note).toContain('>Towels ran out</textarea>')
    expect(text(note ?? '')).toContain(pack.copy.noteLabel)
    expect(text(note ?? '')).toContain(pack.copy.noteHint)
    expect(text(note ?? '')).toContain(pack.copy.noteSend)
    expect(text(note ?? '')).toContain(pack.copy.noteDismiss)
    // The Google card keeps its place above the open note.
    expect(googleIndex(responseChildren(html))).toBe(1)
  })

  it('confirms a sent note in place of the form', () => {
    const html = body(renderResponse(pack, { kind: 'done', rating: 2 }))
    const [, , note] = responseChildren(html)
    expect(text(note ?? '')).toContain(
      guestCopyText(pack, 'noteSent', { name: DISPLAY_NAME }),
    )
    expect(note).toContain('role="status"')
    expect(note).not.toContain('<textarea')
    expect(html).not.toContain(pack.copy.noteOfferTitle)
  })

  it('shows a note failure inside the note card only', () => {
    const html = body(
      renderResponse(pack, { kind: 'note-writing', rating: 2 }, { failure: 'note' }),
    )
    const [, google, note] = responseChildren(html)
    expect(note).toContain(pack.copy.noteSendFailed)
    expect(google).not.toContain('role="alert"')
  })

  it('shows a Google failure inside the Google card only', () => {
    const html = body(
      renderResponse(pack, { kind: 'rated', rating: 2 }, { failure: 'google' }),
    )
    const [, google, note] = responseChildren(html)
    expect(google).toContain(`role="alert"`)
    expect(google).toContain(pack.copy.googleOpenFailed)
    expect(note).not.toContain(pack.copy.googleOpenFailed)
  })

  it('leaves out Change when the page gives it nowhere to go', () => {
    const html = body(
      renderResponse(pack, { kind: 'rated', rating: 5 }, { onChangeRating: undefined }),
    )
    expect(responseChildren(html)[0]).not.toContain(`>${pack.copy.ratingChange}<`)
  })
})

describe.each(PACKS)('Google unavailable [$locale] (board G08)', (pack) => {
  const render = (rating: number) =>
    body(renderResponse(pack, { kind: 'googleUnavailable', rating }))

  it('replaces the Google card with a gentle status in the same place', () => {
    for (const rating of RATINGS) {
      const children = responseChildren(render(rating))
      const card = children.findIndex((child) =>
        child.includes(pack.copy.googleUnavailableTitle),
      )
      expect(card, `rating ${rating}`).toBe(1)
      expect(children[card]).toContain('role="status"')
      expect(text(children[card] ?? '')).toContain(
        guestCopyText(pack, 'googleUnavailableBody', { name: DISPLAY_NAME }),
      )
      expect(children.join('')).not.toContain(pack.copy.googleAction)
    }
  })

  it('is identical at every rating, and the private note still works below it', () => {
    const cards = RATINGS.map((rating) => responseChildren(render(rating))[1])
    expect(new Set(cards).size).toBe(1)
    expect(responseChildren(render(3))[2]).toContain(pack.copy.noteOfferTitle)
  })
})

describe('other states', () => {
  const pack = PACKS[0]
  if (!pack) throw new Error('no pack')
  const view = (props: Parameters<typeof immersiveResponseProps>[0]) =>
    body(renderResponse(pack, props))

  it('says the response was removed after a full withdrawal, and offers nothing else', () => {
    const props = immersiveResponseProps(
      { kind: 'rated', rating: 2 },
      { pack, displayName: DISPLAY_NAME },
    )
    const html = body(
      renderToStaticMarkup(
        createElement(ImmersiveResponseView, {
          ...props,
          response: props.response && {
            ...props.response,
            status: 'deleted',
            rating: null,
          },
        }),
      ),
    )
    expect(html).toContain(pack.copy.responseRemoveAllDoneTitle)
    expect(html).not.toContain(pack.copy.googleTitle)
    expect(html).not.toContain('type="radio"')
  })

  it('shows a busy placeholder while the gateway loads, and the unavailable text when it fails', () => {
    const base = immersiveResponseProps(
      { kind: 'arrival' },
      { pack, displayName: DISPLAY_NAME },
    )
    const render = (availability: 'loading' | 'unavailable') =>
      body(
        renderToStaticMarkup(
          createElement(ImmersiveResponseView, { ...base, availability }),
        ),
      )
    expect(render('loading')).toContain('aria-busy="true"')
    expect(render('unavailable')).toContain(pack.copy.unavailableTitle)
    expect(render('unavailable')).not.toContain('type="radio"')
  })

  it('renders arrival as a single card, with no receipt, Google or note card', () => {
    const html = view({ kind: 'arrival' })
    expect(html).not.toContain(pack.copy.ratingThanks)
    expect(html).not.toContain(pack.copy.googleTitle)
    expect(html).not.toContain(pack.copy.noteOfferTitle)
  })
})
