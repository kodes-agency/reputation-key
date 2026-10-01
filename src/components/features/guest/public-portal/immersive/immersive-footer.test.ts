// The footer is rendered to markup and read back (the unit project has no DOM).
// What a click does and that the visit is recorded whatever the guest does with
// the notice are exercised in the stories next to this file, in a browser.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { bgV2 } from '../language-packs/bg-v2'
import { enV2 } from '../language-packs/en-v2'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { guestCopyText } from '../guest-copy-format'
import { ImmersiveFooterView, type ImmersiveFooterViewProps } from './immersive-footer'
import { immersiveFooterCopy } from './immersive-footer-copy'
import { IMMERSIVE_FOOTER_CSS } from './immersive-footer-styles'

const PACKS: readonly GuestPortalCopyV2[] = [enV2, bgV2]
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
    'uses the full disclosure of $locale, never the shorter notice',
    (pack) => {
      const copy = immersiveFooterCopy(pack, NAME)
      expect(copy.visitNotice).toBe(
        guestCopyText(pack, 'visitNoticeDetail', { name: NAME }),
      )
      expect(copy.visitNotice).not.toBe(
        guestCopyText(pack, 'visitNotice', { name: NAME }),
      )
      expect(copy.visitNotice).toContain(NAME)
    },
  )

  it('discloses the session cookie and the network marker in English', () => {
    const { visitNotice } = immersiveFooterCopy(enV2, NAME)
    expect(visitNotice).toMatch(/session cookie/iu)
    expect(visitNotice).toMatch(/network marker/iu)
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

  it('shows the full disclosure with the property name filled in', () => {
    const text = textOf(html).join(' ')
    expect(text).toContain('An essential session cookie protects your response.')
    expect(text).toContain('privacy-protected network marker')
    expect(text).toContain(`count this visit for ${NAME}`)
    expect(text).not.toContain('{name}')
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
      text.findIndex((part) => part.includes('session cookie')),
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
    expect(html).not.toMatch(/session cookie|network marker/iu)
  })

  it('keeps the privacy link a 44 px target', () => {
    expect(html).toMatch(/<a [^>]*href="\/privacy"/u)
    expect(IMMERSIVE_FOOTER_CSS).toMatch(/\.ih-footer__link\s*\{[^}]*min-height:\s*44px/u)
  })
})

describe('ImmersiveFooterView in Bulgarian', () => {
  it('shows the Bulgarian disclosure, labels and attribution', () => {
    const html = render({ isNoticeVisible: true }, bgV2)
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
  it('is hoisted once and scoped to the Immersive Hub root', () => {
    expect(render()).toContain('<style')
    expect(IMMERSIVE_FOOTER_CSS).toMatch(/\.ih-footer\b/u)
  })

  it('answers reduced motion wherever it moves anything', () => {
    expect(IMMERSIVE_FOOTER_CSS).toMatch(/prefers-reduced-motion:\s*reduce/u)
  })
})
