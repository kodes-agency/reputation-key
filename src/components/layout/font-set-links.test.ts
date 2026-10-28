// The root document links exactly one font set. Rendered to static markup so
// the tags a guest's browser actually receives are what is asserted.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FontSetLinks } from './font-set-links'

function render(fontSet: 'app' | 'guest', locale: 'en' | 'bg'): string {
  return renderToStaticMarkup(createElement(FontSetLinks, { fontSet, locale }))
}

describe('FontSetLinks', () => {
  it('links the Satoshi and app stylesheets, preconnecting to Fontshare, and nothing from Google', () => {
    const html = render('app', 'en')
    expect(html).toContain('<link rel="preconnect" href="https://api.fontshare.com"/>')
    expect(html).toContain(
      '<link rel="preconnect" href="https://cdn.fontshare.com" crossorigin="anonymous"/>',
    )
    expect(html).toContain('href="https://api.fontshare.com/v2/css?')
    expect(html).toContain('rel="stylesheet" href="/fonts/app/app-fonts.css"')
    expect(html).not.toContain('google')
    expect(html).not.toContain('gstatic')
    expect(html).not.toContain('/fonts/guest/')
    expect(html).not.toContain('preload')
  })

  it('links the guest stylesheet and preloads the Latin pair, with no third-party request', () => {
    const html = render('guest', 'en')
    expect(html).toContain('rel="stylesheet" href="/fonts/guest/guest-fonts.css"')
    expect(html).toContain(
      '<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/guest/cormorant-garamond-latin-600-normal.woff2"/>',
    )
    expect(html).toContain('/fonts/guest/ysabeau-office-latin-400-normal.woff2')
    expect(html).not.toContain('https://')
  })

  it('preloads the Cyrillic pair when the guest reads Bulgarian', () => {
    const html = render('guest', 'bg')
    expect(html).toContain('cormorant-garamond-cyrillic-600-normal.woff2')
    expect(html).toContain('ysabeau-office-cyrillic-400-normal.woff2')
    expect(html).not.toContain('-latin-')
  })
})
