// The unavailable page is rendered to markup and read back. It must read the
// same for every denial reason, so the component takes no props at all.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { bgV2 } from './public-portal/language-packs/bg-v2'
import { enV2 } from './public-portal/language-packs/en-v2'
import {
  PORTAL_UNAVAILABLE_BG,
  PORTAL_UNAVAILABLE_EN,
  PortalUnavailable,
} from './portal-unavailable'
import { PORTAL_UNAVAILABLE_CSS } from './portal-unavailable-styles'

const html = renderToStaticMarkup(createElement(PortalUnavailable))
const body = html.replace(/<style[\s\S]*?<\/style>/gu, '')

describe('PortalUnavailable', () => {
  it('is one main landmark with one level-one heading', () => {
    expect(body.match(/<main\b/gu)).toHaveLength(1)
    expect(body.match(/<h1\b/gu)).toHaveLength(1)
    expect(body).toMatch(/<h1[^>]*>This page isn’t available right now\.<\/h1>/u)
    expect(body).toContain('Please check back later.')
  })

  it('repeats the message in Bulgarian, marked with its own language', () => {
    expect(body).toMatch(
      /<p[^>]*lang="bg"[^>]*>Тази страница не е достъпна в момента\.<\/p>/u,
    )
    expect(body).toMatch(/<p[^>]*lang="bg"[^>]*>Моля, опитайте отново по-късно\.<\/p>/u)
  })

  it('carries the same words as the guest copy packs', () => {
    expect(PORTAL_UNAVAILABLE_EN).toEqual({
      title: enV2.copy.unavailableTitle,
      body: enV2.copy.unavailableBody,
    })
    expect(PORTAL_UNAVAILABLE_BG).toEqual({
      title: bgV2.copy.unavailableTitle,
      body: bgV2.copy.unavailableBody,
    })
  })

  it('says nothing about why, and never the old wording', () => {
    expect(body).not.toMatch(/Portal Unavailable|try again later/iu)
    expect(body).not.toMatch(
      /not found|inactive|suspended|disabled|expired|denied|forbidden/iu,
    )
  })

  it('hides the decorative icon and divider from assistive technology', () => {
    expect(body).toMatch(/<span[^>]*aria-hidden="true"[^>]*><svg/u)
    expect(body).toMatch(
      /<div[^>]*aria-hidden="true"[^>]*class="[^"]*portal-unavailable__rule/u,
    )
  })

  it('loads the self-hosted guest fonts itself, from our own origin', () => {
    expect(html).toContain(`href="${GUEST_FONT_STYLESHEET}"`)
    expect(html).not.toMatch(/googleapis|gstatic|fontshare/u)
  })

  it('is a function of nothing: two renders are identical', () => {
    expect(renderToStaticMarkup(createElement(PortalUnavailable))).toBe(html)
    expect(PortalUnavailable.length).toBe(0)
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
})
