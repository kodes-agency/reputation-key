// The live Immersive Hub page (round 4, slice 19), rendered to markup and read
// back: what a guest of a schema version 3 portal is given at first byte, in
// which order, and what must not be there. The unit project has no DOM, so the
// bound behaviour (acting on a click) is in `guest-response-actions.test.ts`
// and the browser journey in `e2e/critical/guest-portal.spec.ts`.

import { describe, expect, it } from 'vitest'
import { text } from '../__fixtures__/markup-walk'
import {
  BG_PACK,
  IMMERSIVE,
  RATED,
  TOKEN,
  renderImmersivePortal,
} from './__fixtures__/immersive-public-portal-fixtures'

const clickHref = (linkId: string) => `/api/public/p/${TOKEN}/click/${linkId}`

describe('a guest arriving at a schema version 3 portal', () => {
  const html = renderImmersivePortal()

  it('has one page landmark in the portal language and one h1, the portal title', () => {
    expect(html).toMatch(/<main[^>]*class="ih-root ih-root--page"[^>]*lang="en"/u)
    expect(html.match(/<h1\b/gu)).toHaveLength(1)
    expect(html).toMatch(/<h1[^>]*>Pool and terrace<\/h1>/u)
    expect(text(html)).toContain('Avela Resort')
  })

  it('offers the rating card first, then the Linktree, then the footer', () => {
    const order = [
      html.indexOf('How was your experience?'),
      html.indexOf('Around the resort'),
      html.indexOf('<footer'),
    ]

    expect(order.every((position) => position > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('shows its Linktree from arrival, every tile a plain link to the click route', () => {
    for (const link of IMMERSIVE.links) {
      expect(html).toContain(`href="${clickHref(link.id)}"`)
    }
    expect(text(html)).toContain('Menu')
    expect(text(html)).toContain('Breakfast until 11')
  })

  it('does not show the Google card or "Your response" before a rating', () => {
    expect(html).not.toContain('Share your experience on Google')
    expect(html).not.toContain('Your response')
  })

  it('names the five stars the v3 way', () => {
    expect(html).toContain('aria-label="1 star, Poor"')
    expect(html).toContain('aria-label="5 stars, Excellent"')
  })

  it('carries no destination, asset id or provenance in its markup', () => {
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/u)
    expect(html).not.toContain('assetId')
    expect(html).not.toContain('aiDraft')
  })

  it('declares the language of a text copied from another language', () => {
    expect(html).toContain('lang="en"')
  })
})

describe('the language chip', () => {
  it('is offered when the portal has more than one language', () => {
    expect(renderImmersivePortal()).toContain('EN, Language: English')
  })

  it('is absent for a portal with one language', () => {
    expect(renderImmersivePortal({ availableLocales: ['en'] })).not.toContain(
      'Language: English',
    )
  })

  it('reads in the language of the pack the page was given', () => {
    const html = renderImmersivePortal({
      pack: BG_PACK,
      selectedLocale: 'bg',
      immersive: {
        ...IMMERSIVE,
        content: {
          ...IMMERSIVE.content,
          linktreeTitle: { value: '', fallbackFrom: null },
        },
      },
    })

    expect(html).toMatch(/<main[^>]*lang="bg"/u)
    expect(html).toContain(BG_PACK.copy.ratingTitle)
    // A blank stored title falls back to the pack's own default heading.
    expect(html).toContain(BG_PACK.copy.linktreeDefaultTitle)
  })
})

describe('a guest who has rated', () => {
  const html = renderImmersivePortal({ initialResponse: RATED })

  it('is shown the receipt, then the Google card, then the note card, then "Your response"', () => {
    const order = [
      html.indexOf('Thank you.'),
      html.indexOf('Share your experience on Google'),
      html.indexOf('Add a private note for the team'),
      html.indexOf('Your response'),
    ]

    expect(order.every((position) => position > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(text(html)).toContain('Fair · sent privately')
  })

  it('keeps the Linktree where it was, and takes the rating card away', () => {
    expect(html).toContain('Around the resort')
    expect(html).not.toContain('How was your experience?')
  })

  it('writes the deadlines against the server clock in the portal zone', () => {
    // Opened, the section prints "Until 15:55 today, Sofia time"; closed it
    // prints none, and no browser clock is read either way.
    expect(html).not.toContain('Invalid')
  })
})

describe('a tenant that cannot take a response', () => {
  it.each(['permission_denied', 'error'] as const)(
    'shows the notice instead of the rating card when it is %s',
    (availability) => {
      const html = renderImmersivePortal({ availability })

      // Only the rating is said to be out of reach, not the page that stands around it.
      expect(html).toContain('Ratings can’t be sent from here right now.')
      expect(html).toContain('Please try again later.')
      expect(html).not.toContain('This page isn’t available')
      expect(html).not.toContain('How was your experience?')
      // The page itself, and its Linktree, still stand.
      expect(html).toContain('Around the resort')
    },
  )
})

describe('a Google destination that cannot be offered', () => {
  it('says so after a rating instead of offering Google', () => {
    const html = renderImmersivePortal({
      initialResponse: RATED,
      googleReview: { status: 'unavailable' },
    })

    expect(html).toContain('Google can’t be opened from here right now')
    expect(html).not.toContain('Continue to Google')
  })
})

describe('a portal whose Linktree is off', () => {
  it('renders no links at all', () => {
    const html = renderImmersivePortal({
      immersive: { ...IMMERSIVE, linktree: { enabled: false } },
    })

    expect(html).not.toContain('/click/')
    expect(html).not.toContain('Around the resort')
  })
})
