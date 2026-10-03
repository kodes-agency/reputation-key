// The footer is rendered to markup and read back (the unit project has no DOM).
// What a click does and that the visit is recorded whatever the guest does with
// the notice are exercised in the stories next to this file, in a browser.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { bgV2 } from '../language-packs/bg-v2'
import { enV2 } from '../language-packs/en-v2'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { loadGuestPortalCopyV2 } from '../language-packs/load-guest-copy-v2'
import { guestCopyText } from '../guest-copy-format'
import {
  ImmersiveFooterView,
  InertImmersiveFooterView,
  type ImmersiveFooterViewProps,
} from './immersive-footer'
import { immersiveFooterCopy } from './immersive-footer-copy'
import { IMMERSIVE_FOOTER_CSS } from './immersive-footer-styles'

// Every language a guest can reach, loaded the way a request loads them.
const PACKS: readonly GuestPortalCopyV2[] = await Promise.all(
  GUEST_LOCALES.map((locale) => loadGuestPortalCopyV2(locale)),
)
const NAME = 'Avela Resort'

function render(props: Partial<ImmersiveFooterViewProps> = {}, pack = enV2) {
  return renderToStaticMarkup(
    createElement(ImmersiveFooterView, {
      copy: immersiveFooterCopy(pack, NAME),
      isNoticeVisible: true,
      onAcknowledge: () => undefined,
      ...props,
    }),
  )
}

const withoutStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')

/** Visible text of the markup, tags and the hoisted stylesheet removed. */
const textOf = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gu, '')
    .replace(/<[^>]+>/gu, '|')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)

describe('immersiveFooterCopy', () => {
  it.each(PACKS)(
    'uses the one-line notice of $locale with the name filled in',
    (pack) => {
      const copy = immersiveFooterCopy(pack, NAME)
      expect(copy.visitNotice).toBe(guestCopyText(pack, 'visitNotice', { name: NAME }))
      expect(copy.visitNotice.startsWith(NAME)).toBe(true)
      expect(copy.visitNotice).not.toContain('{name}')
    },
  )

  it('says it in one line in English, and still discloses the cookie and the marker', () => {
    const { visitNotice } = immersiveFooterCopy(enV2, NAME)
    expect(visitNotice).toBe(
      `${NAME} counts visits with one essential cookie and a privacy-protected marker. No ads or third-party trackers.`,
    )
    expect(visitNotice).toMatch(/essential cookie/iu)
    expect(visitNotice).toMatch(/privacy-protected marker/iu)
    expect(visitNotice).toMatch(/no ads or third.party trackers/iu)
  })

  it.each(PACKS)('takes the labels of the footer from $locale', (pack) => {
    expect(immersiveFooterCopy(pack, NAME)).toMatchObject({
      noticeLabel: pack.copy.visitNoticeLabel,
      acknowledge: pack.copy.visitNoticeAcknowledge,
      privacyLink: pack.copy.privacyNoticeLink,
      madeWith: pack.copy.footerMadeWith,
    })
  })
})

describe('ImmersiveFooterView with the notice', () => {
  const html = render()

  it('is the page footer, with the notice inline and no overlay', () => {
    expect(html.replace(/<style[\s\S]*?<\/style>/gu, '')).toMatch(/^<footer\b/u)
    expect(html).toContain('<section')
    expect(html).not.toMatch(/position:\s*fixed/iu)
    expect(IMMERSIVE_FOOTER_CSS).not.toMatch(/position:\s*fixed/iu)
    expect(html).not.toContain('role="dialog"')
  })

  it('names the notice for assistive technology', () => {
    expect(html).toContain('aria-label="Visit counting"')
  })

  it('shows the one-line notice with the property name filled in', () => {
    const text = textOf(html).join(' ')
    expect(text).toContain(`${NAME} counts visits with one essential cookie`)
    expect(text).toContain('a privacy-protected marker')
    expect(text).toContain('No ads or third-party trackers.')
    expect(text).not.toContain('{name}')
    expect(text).not.toContain('session cookie')
    expect(text).not.toContain('network marker')
  })

  it('has the privacy link and one acknowledge button, and no way to refuse', () => {
    expect(html).toMatch(/<a [^>]*href="\/privacy"[^>]*>Privacy notice<\/a>/u)
    expect(html.match(/<button\b/gu)).toHaveLength(1)
    expect(html).toMatch(
      /<button [^>]*type="button"[^>]*>[\s\S]*Got it[\s\S]*<\/button>/u,
    )
    expect(html).not.toMatch(/reject|decline|refuse/iu)
  })

  it('reads the notice before the privacy link and the acknowledge button', () => {
    const text = textOf(html)
    expect(text.indexOf('Privacy notice')).toBeGreaterThan(
      text.findIndex((part) => part.includes('essential cookie')),
    )
    expect(text.indexOf('Got it')).toBeGreaterThan(text.indexOf('Privacy notice'))
  })
})

describe('ImmersiveFooterView after the notice is acknowledged', () => {
  const html = render({ isNoticeVisible: false })

  it('reads "Privacy notice" then "Made with Reputation Key"', () => {
    expect(textOf(html)).toEqual(['Privacy notice', 'Made with Reputation Key'])
  })

  it('has no region, no button and none of the notice text', () => {
    expect(html).not.toContain('<section')
    expect(html).not.toContain('<button')
    expect(html).not.toMatch(/essential cookie|privacy-protected marker/iu)
  })

  it('keeps the privacy link a 44 px target', () => {
    expect(html).toMatch(/<a [^>]*href="\/privacy"/u)
    expect(IMMERSIVE_FOOTER_CSS).toMatch(/\.ih-footer__link\s*\{[^}]*min-height:\s*44px/u)
  })
})

describe('ImmersiveFooterView in Bulgarian', () => {
  it('shows the Bulgarian notice, labels and attribution', () => {
    const html = render({ isNoticeVisible: true }, bgV2)
    expect(html).toContain(guestCopyText(bgV2, 'visitNotice', { name: NAME }))
    expect(html).toContain(`aria-label="${bgV2.copy.visitNoticeLabel}"`)
    expect(html).toContain(bgV2.copy.privacyNoticeLink)
    expect(html).toContain(bgV2.copy.visitNoticeAcknowledge)
    expect(textOf(render({ isNoticeVisible: false }, bgV2))).toEqual([
      bgV2.copy.privacyNoticeLink,
      bgV2.copy.footerMadeWith,
    ])
  })
})

describe('the footer stylesheet', () => {
  it('is hoisted into the markup', () => {
    expect(render()).toContain('<style')
  })

  it('scopes every rule under the Immersive Hub root, so nothing reaches the app', () => {
    const selectors = IMMERSIVE_FOOTER_CSS.split('{')
      .slice(0, -1)
      .map((chunk) => chunk.split('}').pop()?.trim() ?? '')
      .filter((selector) => selector && !selector.startsWith('@'))
      .flatMap((selector) => selector.split(',').map((part) => part.trim()))
    expect(selectors.length).toBeGreaterThan(5)
    expect(selectors.filter((selector) => !selector.startsWith('.ih-root '))).toEqual([])
  })

  it('answers reduced motion wherever it moves anything', () => {
    expect(IMMERSIVE_FOOTER_CSS).toMatch(/prefers-reduced-motion:\s*reduce/u)
  })
})

describe('InertImmersiveFooterView (the admin preview)', () => {
  const inert = (props: Partial<Omit<ImmersiveFooterViewProps, 'onAcknowledge'>> = {}) =>
    renderToStaticMarkup(
      createElement(InertImmersiveFooterView, {
        copy: immersiveFooterCopy(enV2, NAME),
        isNoticeVisible: true,
        ...props,
      }),
    )

  it('draws the one-line notice, the privacy link and "Got it" as the guest reads them', () => {
    const text = textOf(inert()).join(' ')
    expect(text).toContain('counts visits with one essential cookie')
    expect(text).toContain('Privacy notice')
    expect(text).toContain('Got it')
  })

  it('goes nowhere: no address, no button, nothing to acknowledge', () => {
    const html = withoutStyle(inert())
    expect(html).not.toContain('href=')
    expect(html).not.toContain('<button')
    expect(html).toContain('ih-footer__ack--inert')
  })

  it('draws the acknowledged row the same way', () => {
    const html = withoutStyle(inert({ isNoticeVisible: false }))
    expect(textOf(html)).toEqual(['Privacy notice', 'Made with Reputation Key'])
    expect(html).not.toContain('href=')
  })

  it('drops the pointer and the hover of the acknowledge pill', () => {
    expect(IMMERSIVE_FOOTER_CSS).toMatch(
      /\.ih-footer__ack--inert\s*\{[^}]*cursor:\s*default/u,
    )
  })
})
