// ADR 0044, "Anti-gating rule": review destination visibility, ordering,
// wording and prominence are invariant across guest response values and
// states. This is that architectural test. It renders the pure guest page for
// every rating, with and without the private-note card, and requires the Google
// card to be the same markup in the same place. A change that hides, moves,
// reorders or rewords the Google card by rating fails here.
//
// There is no DOM in the unit project, so the markup is split by a small tag
// walker rather than queried.

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getGuestPortalCopy } from './guest-language-pack'
import { GuestPageView, type GuestPageViewProps } from './guest-page-view'
import type { GuestPagePreviewState } from './guest-page-preview-state'
import type { PortalLocalization } from './portal-localization'
import { PortalSecondaryLinks } from './portal-secondary-links'

const RATINGS = [1, 2, 3, 4, 5] as const
const LOCALES = ['en', 'bg'] as const
const LOCALIZATION: Readonly<Record<(typeof LOCALES)[number], PortalLocalization>> = {
  en: {
    selectedLocale: 'en',
    primaryLocale: 'en',
    availableLocales: ['en', 'bg'],
    languagePackVersion: 'guest-ui-en-v1',
  },
  bg: {
    selectedLocale: 'bg',
    primaryLocale: 'en',
    availableLocales: ['en', 'bg'],
    languagePackVersion: 'guest-ui-bg-v1',
  },
}

const portal = {
  name: 'The Harbor Hotel',
  description: 'Thank you for visiting.',
  organizationName: 'Harbor Hospitality',
  heroImageUrl: null,
  theme: null,
}

function secondaryLinks(locale: (typeof LOCALES)[number]) {
  return createElement(PortalSecondaryLinks, {
    organizationName: portal.organizationName,
    categories: [{ id: 'c1', title: 'Useful links' }],
    links: [
      { id: 'l1', label: 'Hotel website', url: 'https://example.com/', categoryId: 'c1' },
    ],
    locale,
    languagePackVersion: LOCALIZATION[locale].languagePackVersion,
  })
}

function renderPage(
  locale: (typeof LOCALES)[number],
  previewState: GuestPagePreviewState,
  overrides: Partial<GuestPageViewProps> = {},
): string {
  return renderToStaticMarkup(
    createElement(GuestPageView, {
      portal,
      localization: LOCALIZATION[locale],
      body: { kind: 'preview', previewState, secondaryLinks: secondaryLinks(locale) },
      ...overrides,
    }),
  )
}

const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link'])

/** Direct-child markup of the first element whose opening tag contains `marker`. */
function directChildren(html: string, marker: string): string[] {
  const opening = html.indexOf(marker)
  expect(opening, `${marker} is present`).toBeGreaterThan(-1)
  const from = html.lastIndexOf('<', opening)
  const children: string[] = []
  let depth = 0
  let childStart = -1
  TAG.lastIndex = from
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    const [whole, closing, name] = match
    const selfContained =
      VOID_TAGS.has((name ?? '').toLowerCase()) || whole.endsWith('/>')
    if (closing) depth -= 1
    else if (!selfContained) depth += 1
    if (!closing && depth === 2 && childStart === -1) childStart = match.index
    if (childStart !== -1 && depth === 1) {
      children.push(html.slice(childStart, match.index + whole.length))
      childStart = -1
    }
    if (closing && depth === 0) return children
    if (selfContained && !closing && depth === 1 && childStart === -1) {
      children.push(whole)
    }
  }
  throw new Error(`${marker} is not closed`)
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const ratedSection = (html: string) =>
  directChildren(html, 'aria-labelledby="rating-receipt-heading"')

describe('anti-gating: the Google card does not depend on the rating', () => {
  for (const locale of LOCALES) {
    const copy = getGuestPortalCopy(locale, LOCALIZATION[locale].languagePackVersion)
    const cases = RATINGS.flatMap((rating) =>
      [true, false].map((noteEligible) => ({ rating, noteEligible })),
    )
    const rendered = cases.map((c) => ({
      ...c,
      children: ratedSection(
        renderPage(locale, {
          kind: 'rated',
          rating: c.rating,
          noteEligible: c.noteEligible,
        }),
      ),
    }))
    const googleIndex = (children: readonly string[]) =>
      children.findIndex((child) => child.includes(copy.googleTitle))

    it(`[${locale}] puts the Google card second, after the thank-you card, at every rating`, () => {
      for (const { children, rating, noteEligible } of rendered) {
        expect(googleIndex(children), `rating ${rating}, note ${noteEligible}`).toBe(1)
        expect(text(children[0] ?? '')).toContain(copy.privateRatingThanks)
      }
    })

    it(`[${locale}] renders identical Google card markup for ratings 1-5, note or not`, () => {
      const cards = rendered.map(({ children }) => children[googleIndex(children)])
      expect(new Set(cards).size).toBe(1)
    })

    it(`[${locale}] gives the Google card the same heading, copy and accessible name`, () => {
      for (const { children } of rendered) {
        const card = children[googleIndex(children)] ?? ''
        expect(card).toContain(`>${copy.googleTitle}</h2>`)
        expect(card).toContain(`>${copy.googleBody}</p>`)
        const button = /<button\b[^>]*>(.*?)<\/button>/s.exec(card)
        expect(text(button?.[1] ?? '')).toBe(copy.continueToGoogle)
        expect(/<button\b[^>]*\sdisabled(?=[\s=>])/.test(card)).toBe(false)
      }
    })

    it(`[${locale}] shows the note card only when eligible, and always after Google`, () => {
      for (const { children, noteEligible } of rendered) {
        const noteIndex = children.findIndex((child) =>
          child.includes(copy.privateFeedbackTitle),
        )
        if (!noteEligible) expect(noteIndex).toBe(-1)
        else expect(noteIndex).toBeGreaterThan(googleIndex(children))
      }
    })

    it(`[${locale}] keeps the other links after Google at every rating`, () => {
      for (const { children } of rendered) {
        const linksIndex = children.findIndex((child) =>
          child.includes(`aria-label="${copy.moreLinksLabel}"`),
        )
        expect(linksIndex).toBeGreaterThan(googleIndex(children))
      }
    })

    it(`[${locale}] keeps the unavailable card in the same place at every rating`, () => {
      const unavailable = RATINGS.map((rating) =>
        ratedSection(renderPage(locale, { kind: 'googleUnavailable', rating })),
      )
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

  it('leaves the page chrome untouched by the rating', () => {
    const chrome = (rating: number) => {
      const html = renderPage('en', { kind: 'rated', rating })
      return html.slice(0, html.indexOf('aria-labelledby="rating-receipt-heading"'))
    }
    expect(new Set(RATINGS.map(chrome)).size).toBe(1)
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

describe('GuestPageView purity', () => {
  const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

  it.each(['./guest-page-view.tsx', './guest-page-preview-state.ts'])(
    '%s imports no server function, action hook or controller',
    (file) => {
      const source = read(file)
      expect(source).not.toMatch(/useServerFn|useAction|createServerFn/)
      expect(source).not.toMatch(/from '#\/contexts\/[^']*\/server/)
      expect(source).not.toContain('use-guest-response-controller')
    },
  )
})
