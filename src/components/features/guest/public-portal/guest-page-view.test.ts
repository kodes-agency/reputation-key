// ADR 0044, "Anti-gating rule": review destination visibility, ordering,
// wording and prominence are invariant across guest response values and
// states. This is that architectural test. It renders the guest page for every
// rating and state on BOTH paths a guest can reach (a controlled preview state
// and the live container that binds the response session) and requires the
// Google card to be the same markup in the same place. A change that hides,
// moves, reorders or rewords the Google card by rating fails here, wherever in
// the stack it is made.
//
// There is no DOM in the unit project, so the markup is split by a small tag
// walker rather than queried.

import { describe, expect, it } from 'vitest'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { getGuestPortalCopy } from './guest-language-pack'
import type { GuestPagePreviewState } from './guest-page-preview-state'
import {
  LOCALES,
  LOCALIZATION,
  RATINGS,
  VARIANTS,
  renderCorrecting,
  renderLive,
  renderPage,
  secondaryLinks,
  submitted,
  type Locale,
} from './__fixtures__/guest-page-fixtures'
import { directChildren, text } from './__fixtures__/markup-walk'

const ratedSection = (html: string) =>
  directChildren(html, 'aria-labelledby="rating-receipt-heading"')
const noteVisible = (response: GuestResponseView) =>
  response.privateFeedbackEligible && !response.hasPrivateFeedback

type Rendered = Readonly<{
  label: string
  noteVisible: boolean
  children: readonly string[]
}>

/** Every variant on every path that can render it. */
function renderEverywhere(locale: Locale): Rendered[] {
  return VARIANTS.flatMap(({ label, response, preview }) => {
    const shown = noteVisible(response)
    const row = (path: string, html: string): Rendered => ({
      label: `${path}: ${label}`,
      noteVisible: shown,
      children: ratedSection(html),
    })
    return [
      ...(preview ? [row('preview', renderPage(locale, preview))] : []),
      row('live', renderLive(locale, response)),
      row('correcting', renderCorrecting(locale, response)),
    ]
  })
}

describe('anti-gating: the Google card does not depend on the rating', () => {
  for (const locale of LOCALES) {
    const copy = getGuestPortalCopy(locale, LOCALIZATION[locale].languagePackVersion)
    const rendered = renderEverywhere(locale)
    const googleIndex = (children: readonly string[]) =>
      children.findIndex((child) => child.includes(copy.googleTitle))

    it(`[${locale}] covers the preview, live and correcting paths`, () => {
      const paths = new Set(rendered.map(({ label }) => label.split(':')[0]))
      expect(paths).toEqual(new Set(['preview', 'live', 'correcting']))
    })

    it(`[${locale}] puts the Google card second, after the thank-you card, everywhere`, () => {
      for (const { children, label } of rendered) {
        expect(googleIndex(children), label).toBe(1)
        expect(text(children[0] ?? ''), label).toContain(copy.privateRatingThanks)
      }
    })

    it(`[${locale}] renders identical Google card markup for every rating, state and path`, () => {
      const cards = rendered.map(({ children }) => children[googleIndex(children)])
      expect(new Set(cards).size).toBe(1)
    })

    it(`[${locale}] gives the Google card the same heading, copy and accessible name`, () => {
      for (const { children, label } of rendered) {
        const card = children[googleIndex(children)] ?? ''
        expect(card, label).toContain(`>${copy.googleTitle}</h2>`)
        expect(card, label).toContain(`>${copy.googleBody}</p>`)
        const button = /<button\b[^>]*>(.*?)<\/button>/s.exec(card)
        expect(text(button?.[1] ?? ''), label).toBe(copy.continueToGoogle)
        expect(/<button\b[^>]*\sdisabled(?=[\s=>])/.test(card), label).toBe(false)
      }
    })

    it(`[${locale}] shows the note card only when eligible, and always after Google`, () => {
      for (const { children, noteVisible: expected, label } of rendered) {
        const noteIndex = children.findIndex((child) =>
          child.includes(copy.privateFeedbackTitle),
        )
        if (!expected) expect(noteIndex, label).toBe(-1)
        else expect(noteIndex, label).toBeGreaterThan(googleIndex(children))
      }
    })

    it(`[${locale}] keeps the other links after Google everywhere`, () => {
      for (const { children, label } of rendered) {
        const linksIndex = children.findIndex((child) =>
          child.includes(`aria-label="${copy.moreLinksLabel}"`),
        )
        expect(linksIndex, label).toBeGreaterThan(googleIndex(children))
      }
    })

    it(`[${locale}] keeps the unavailable card in the same place at every rating, on every path`, () => {
      const unavailable = RATINGS.flatMap((rating) => [
        renderPage(locale, { kind: 'googleUnavailable', rating }),
        renderLive(locale, submitted({ rating, noteEligible: false }), 'unavailable'),
        renderCorrecting(locale, submitted({ rating, noteEligible: false }), false),
      ]).map(ratedSection)
      const positions = unavailable.map((children) =>
        children.findIndex((child) => child.includes(copy.googleUnavailableTitle)),
      )
      const cards = unavailable.map((children, i) => children[positions[i] ?? -1])
      expect(new Set(positions)).toEqual(new Set([1]))
      expect(new Set(cards).size).toBe(1)
      for (const children of unavailable) {
        expect(children.join('')).not.toContain(copy.continueToGoogle)
      }
    })
  }

  it('leaves the page chrome untouched by the rating, on the preview and live paths', () => {
    const beforeResponse = (html: string) =>
      html.slice(0, html.indexOf('aria-labelledby="rating-receipt-heading"'))
    const previewChrome = RATINGS.map((rating) =>
      beforeResponse(renderPage('en', { kind: 'rated', rating })),
    )
    const liveChrome = RATINGS.map((rating) =>
      beforeResponse(renderLive('en', submitted({ rating, noteEligible: rating <= 3 }))),
    )
    expect(new Set(previewChrome).size).toBe(1)
    expect(new Set(liveChrome).size).toBe(1)
  })
})

describe('GuestPageView', () => {
  it('renders every preview state with no token, action or nonce', () => {
    const states: GuestPagePreviewState[] = [
      { kind: 'arrival' },
      { kind: 'rated', rating: 5 },
      { kind: 'rated', rating: 2 },
      { kind: 'note-writing' },
      { kind: 'done' },
      { kind: 'googleUnavailable' },
    ]
    for (const previewState of states) {
      const html = renderPage('en', previewState)
      expect(html).toContain('<main')
      expect(html).toContain('<h1')
    }
  })

  it('sizes to its container in a frame and to the viewport on the public page', () => {
    const frame = renderPage('en', { kind: 'arrival' }, { height: 'container' })
    const page = renderPage('en', { kind: 'arrival' }, { height: 'page' })

    expect(frame).toContain('min-h-full')
    expect(frame).not.toContain('min-h-screen')
    expect(page).toContain('min-h-screen')
  })

  it('offers no language switch without a token, and one with a token', () => {
    const copy = getGuestPortalCopy('en', 'guest-ui-en-v1')
    const nav = `aria-label="${copy.languageNavigationLabel}"`

    expect(renderPage('en', { kind: 'arrival' })).not.toContain(nav)
    expect(renderPage('en', { kind: 'arrival' }, { token: 'tok' })).toContain(nav)
  })

  it('fails closed with the status panel when a public page has no gateway', () => {
    const copy = getGuestPortalCopy('en', 'guest-ui-en-v1')
    const html = renderPage('en', { kind: 'arrival' }, { body: { kind: 'unavailable' } })

    expect(html).toContain(copy.gatewayUnavailableTitle)
    expect(html).not.toContain(copy.submitPrivateRating)
  })

  it('shows the static rating card and links to a manager preview', () => {
    const copy = getGuestPortalCopy('en', 'guest-ui-en-v1')
    const html = renderPage(
      'en',
      { kind: 'arrival' },
      { body: { kind: 'manager', secondaryLinks: secondaryLinks('en') } },
    )

    expect(html).toContain(copy.previewRatingTitle)
    expect(html).toContain(`aria-label="${copy.moreLinksLabel}"`)
    expect(html).not.toContain(copy.submitPrivateRating)
  })
})
