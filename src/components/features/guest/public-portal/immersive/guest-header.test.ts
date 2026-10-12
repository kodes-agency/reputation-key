// Header and title block, read back as markup: the unit project has no DOM.
// Behaviour that needs one (the sheet's focus, keys, computed styles) is in the
// stories next to this file.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GuestHeader, type GuestHeaderProps } from './guest-header'
import { GuestTitleBlock, type GuestTitleBlockProps } from './guest-title-block'

const LOGO = { url: 'https://media.example.com/avela-logo.png', width: 240, height: 64 }

function header(props: Partial<GuestHeaderProps> = {}, children?: string) {
  return renderToStaticMarkup(
    createElement(
      GuestHeader,
      {
        displayName: 'Avela Resort',
        wordmark: 'Avela',
        logo: null,
        logoAlt: 'Avela Resort logo',
        ...props,
      },
      children ? createElement('button', null, children) : undefined,
    ),
  )
}

function title(props: Partial<GuestTitleBlockProps> = {}) {
  return renderToStaticMarkup(
    createElement(GuestTitleBlock, {
      title: { value: 'Pool & Terrace' },
      displayName: 'Avela Resort',
      ...props,
    }),
  )
}

describe('GuestHeader', () => {
  it('shows the wordmark as text, not as a heading', () => {
    const html = header()
    expect(html).toContain('>Avela</p>')
    expect(html).not.toMatch(/<h[1-6]/u)
    expect(html).not.toContain('<img')
  })

  it('shows no mark at all when the property has no wordmark and no logo', () => {
    // The display name is the large line beneath; a small copy of it was cut off.
    for (const wordmark of [null, '', '   ']) {
      const html = header({ wordmark })
      expect(html).not.toContain('ih-wordmark')
      expect(html).not.toContain('Avela Resort')
      expect(html).not.toContain('<img')
    }
  })

  it('still carries the language switcher when there is no mark', () => {
    const html = header({ wordmark: null }, 'EN')
    expect(html).toMatch(/^<header\b/u)
    expect(html).toContain('<button>EN</button>')
  })

  it('hands the stylesheet the number of letters it has to fit, never the text', () => {
    expect(header()).toContain('style="--ih-wm-n:5"')
    expect(header({ wordmark: '  Hotel Marina Bay ' })).toContain('style="--ih-wm-n:16"')
    // A letter outside the basic plane is one letter, not two.
    expect(header({ wordmark: '𝓐𝓥𝓔𝓛𝓐' })).toContain('style="--ih-wm-n:5"')
  })

  it('does not need the display name, so a caller that leaves it out still draws the mark', () => {
    expect(header({ displayName: undefined })).toContain('>Avela</p>')
  })

  it('shows the logo instead of the wordmark, sized, with its description', () => {
    const html = header({ logo: LOGO })
    const image = html.match(/<img\b[^>]*>/u)?.[0] ?? ''
    expect(image).toContain('src="https://media.example.com/avela-logo.png"')
    expect(image).toContain('alt="Avela Resort logo"')
    expect(image).toContain('width="240"')
    expect(image).toContain('height="64"')
    expect(html).not.toContain('>Avela</p>')
  })

  it('never makes the logo a competing high-priority image', () => {
    const image = header({ logo: LOGO }).match(/<img\b[^>]*>/u)?.[0] ?? ''
    expect(image).not.toContain('fetchPriority')
    expect(image).not.toContain('lazy')
  })

  it('sits in a header element and carries the language switcher it is given', () => {
    const html = header({}, 'EN')
    expect(html).toMatch(/^<header\b/u)
    expect(html).toContain('<button>EN</button>')
  })

  it('is just the brand when there is no switcher', () => {
    expect(header()).not.toContain('<button')
  })
})

describe('GuestTitleBlock', () => {
  it('makes the portal title the h1 kicker and the display name the large line', () => {
    const html = title()
    expect(html).toMatch(/<h1\b[^>]*>Pool &amp; Terrace<\/h1>/u)
    expect(html).toMatch(/<p\b[^>]*ih-display[^>]*>Avela Resort<\/p>/u)
    expect(html.match(/<h1\b/gu)).toHaveLength(1)
  })

  it('declares the language of a title that was copied from another language', () => {
    expect(title({ title: { value: 'Pool & Terrace', lang: 'en' } })).toContain(
      '<h1 class="ih-title__kicker" lang="en">',
    )
    expect(title()).not.toContain('lang=')
  })

  it('is one large h1 when the portal is titled with the property’s own name', () => {
    const html = title({ title: { value: ' avela resort ' } })
    expect(html.match(/<h1\b/gu)).toHaveLength(1)
    expect(html).toMatch(/<h1\b[^>]*ih-title__name[^>]*>Avela Resort<\/h1>/u)
    expect(html).not.toContain('ih-title__kicker')
  })

  it('does not tag a bare name with a language', () => {
    const html = title({ title: { value: 'Avela Resort', lang: 'en' } })
    expect(html).not.toContain('lang=')
  })
})
