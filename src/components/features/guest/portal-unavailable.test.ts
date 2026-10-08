// The unavailable page is rendered to markup and read back. It must read the
// same for every denial reason, so the only thing it takes is the language.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PortalUnavailable } from './portal-unavailable'
import {
  PORTAL_UNAVAILABLE_ENGLISH,
  unavailableCopyOf,
  type PortalUnavailableCopy,
} from './portal-unavailable-copy'
import { PORTAL_UNAVAILABLE_CSS } from './portal-unavailable-styles'
import { loadGuestPortalCopyV2 } from './public-portal/language-packs/load-guest-copy-v2'

const PACKS = await Promise.all(
  GUEST_LOCALES.map((locale) => loadGuestPortalCopyV2(locale)),
)
const COPIES = PACKS.map(unavailableCopyOf)
const GERMAN = COPIES.find((copy) => copy.locale === 'de') as PortalUnavailableCopy

const strip = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/gu, '')
const render = (copy?: PortalUnavailableCopy) =>
  renderToStaticMarkup(createElement(PortalUnavailable, copy ? { copy } : {}))

const html = render()
const body = strip(html)

describe('PortalUnavailable in English', () => {
  it('is one main landmark with one level-one heading', () => {
    expect(body.match(/<main\b/gu)).toHaveLength(1)
    expect(body.match(/<h1\b/gu)).toHaveLength(1)
    expect(body).toMatch(/<h1[^>]*>This page isn’t available right now\.<\/h1>/u)
    expect(body).toContain('Please check back later.')
  })

  it('is English alone: no second language, no rule', () => {
    expect(body).not.toContain('lang="bg"')
    expect(body).not.toMatch(/Тази страница|Моля, опитайте/u)
    expect(body).not.toContain('portal-unavailable__rule')
    expect(body.match(/lang="en"/gu)?.length).toBeGreaterThan(0)
    expect(body).not.toMatch(/lang="(?!en")/u)
  })

  it('offers "Try again" as a plain button', () => {
    expect(body).toMatch(
      /<button[^>]*type="button"[^>]*class="portal-unavailable__retry"[^>]*>Try again<\/button>/u,
    )
    expect(body.match(/<button\b/gu)).toHaveLength(1)
  })
})

describe('PortalUnavailable in another language', () => {
  const german = strip(render(GERMAN))

  it('leads with the visitor’s language, marked with its own language', () => {
    expect(german).toMatch(
      /<h1[^>]*lang="de"[^>]*>Diese Seite ist derzeit nicht verfügbar\.<\/h1>/u,
    )
    expect(german).toMatch(
      /<p[^>]*lang="de"[^>]*>Bitte schauen Sie später noch einmal vorbei\.<\/p>/u,
    )
    expect(german).toMatch(/<button[^>]*lang="de"[^>]*>Erneut versuchen<\/button>/u)
    expect(german.match(/<h1\b/gu)).toHaveLength(1)
  })

  it('adds the English words under a rule, and only then', () => {
    expect(german.indexOf('portal-unavailable__rule')).toBeGreaterThan(
      german.indexOf('Erneut versuchen'),
    )
    expect(german).toMatch(
      /<p[^>]*lang="en"[^>]*>This page isn’t available right now\.<\/p>/u,
    )
    expect(german).toMatch(/<p[^>]*lang="en"[^>]*>Please check back later\.<\/p>/u)
    expect(german.match(/<button\b/gu)).toHaveLength(1)
  })

  it('never adds the fixed Bulgarian line the page used to carry', () => {
    expect(german).not.toContain('lang="bg"')
    expect(german).not.toMatch(/Тази страница/u)
  })

  it.each(COPIES.filter((copy) => copy.locale !== 'en'))(
    'draws $locale with its own words first and the English after',
    (copy) => {
      const markup = strip(render(copy))
      expect(markup.indexOf(copy.title)).toBeGreaterThan(-1)
      expect(markup.indexOf(copy.title)).toBeLessThan(
        markup.indexOf(PORTAL_UNAVAILABLE_ENGLISH.title),
      )
      expect(markup).toContain(`>${copy.retry}</button>`)
    },
  )
})

describe('the unavailable page’s words', () => {
  it('carry the same words as the guest copy packs, in every language', () => {
    for (const pack of PACKS) {
      expect(unavailableCopyOf(pack)).toEqual({
        locale: pack.locale,
        title: pack.copy.unavailableTitle,
        body: pack.copy.unavailableBody,
        retry: pack.copy.unavailableRetry,
      })
    }
  })

  it('write English out so the page needs no pack to draw', () => {
    const english = PACKS.find((pack) => pack.locale === 'en')
    expect(PORTAL_UNAVAILABLE_ENGLISH).toEqual(unavailableCopyOf(english as never))
  })
})

describe('PortalUnavailable says nothing about why', () => {
  it('never uses the old wording or a reason, in any language it is drawn in', () => {
    for (const copy of [PORTAL_UNAVAILABLE_ENGLISH, ...COPIES]) {
      const markup = strip(render(copy))
      expect(markup).not.toMatch(/Portal Unavailable|try again later/iu)
      expect(markup).not.toMatch(
        /not found|inactive|suspended|disabled|expired|denied|forbidden/iu,
      )
    }
  })

  it('takes no reason: its only prop is the language', () => {
    expect(PortalUnavailable.length).toBe(1)
    expect(render()).toBe(render(PORTAL_UNAVAILABLE_ENGLISH))
  })

  it('draws the same page for the same language every time', () => {
    expect(render(GERMAN)).toBe(render(GERMAN))
  })

  it('hides the decorative icon and divider from assistive technology', () => {
    expect(body).toMatch(/<span[^>]*aria-hidden="true"[^>]*><svg/u)
    expect(strip(render(GERMAN))).toMatch(
      /<div[^>]*aria-hidden="true"[^>]*class="[^"]*portal-unavailable__rule/u,
    )
  })

  it('links no font stylesheet: the root chooses the guest set for this route', () => {
    expect(html).not.toContain(GUEST_FONT_STYLESHEET)
    expect(html).not.toMatch(/<link\b|googleapis|gstatic|fontshare/u)
  })
})

describe('the unavailable page stylesheet', () => {
  it('is light whatever the app theme, and sets its own type', () => {
    expect(PORTAL_UNAVAILABLE_CSS).toContain('color-scheme: light')
    expect(PORTAL_UNAVAILABLE_CSS).toContain('var(--font-guest-body')
    expect(PORTAL_UNAVAILABLE_CSS).toMatch(/radial-gradient/u)
  })

  it('fills the viewport so the message sits at the centre', () => {
    expect(PORTAL_UNAVAILABLE_CSS).toMatch(/min-height:\s*100dvh/u)
  })

  it('keeps the retry button a 44 px target with a visible focus ring and no motion on request', () => {
    expect(PORTAL_UNAVAILABLE_CSS).toMatch(
      /\.portal-unavailable__retry\s*\{[^}]*min-height:\s*44px/u,
    )
    expect(PORTAL_UNAVAILABLE_CSS).toMatch(/\.portal-unavailable__retry:focus-visible/u)
    expect(PORTAL_UNAVAILABLE_CSS).toMatch(/prefers-reduced-motion:\s*reduce/u)
  })
})
