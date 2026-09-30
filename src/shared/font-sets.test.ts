import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_FONT_STYLESHEETS,
  GUEST_FONT_STYLESHEET,
  fontSetLinks,
  fontSetOfMatches,
  fontSetForGuestSurface,
} from './font-sets'

const ROOT = join(import.meta.dirname, '..', '..')
const guestCss = readFileSync(join(ROOT, 'public/fonts/guest/guest-fonts.css'), 'utf8')

describe('font set of a route match list', () => {
  it('is the app set when no match declares one', () => {
    expect(fontSetOfMatches([])).toBe('app')
    expect(fontSetOfMatches([{ loaderData: undefined }, { loaderData: null }])).toBe(
      'app',
    )
    expect(fontSetOfMatches([{ loaderData: { dsn: 'x' } }])).toBe('app')
  })

  it('is the guest set when a match loader declares it', () => {
    expect(
      fontSetOfMatches([
        { loaderData: { dsn: 'x' } },
        { loaderData: { fontSet: 'guest' } },
      ]),
    ).toBe('guest')
  })

  it('ignores a declared value that is not a known set', () => {
    expect(fontSetOfMatches([{ loaderData: { fontSet: 'serif' } }])).toBe('app')
    expect(fontSetOfMatches([{ loaderData: { fontSet: 'app' } }])).toBe('app')
  })
})

describe('font set of a guest surface', () => {
  it('keeps the legacy surface on the app fonts', () => {
    expect(fontSetForGuestSurface('legacy')).toBe('app')
  })

  it('moves the Immersive Hub to the guest fonts', () => {
    expect(fontSetForGuestSurface('immersive')).toBe('guest')
  })
})

describe('font set head links', () => {
  it('loads the app fonts from their two stylesheets, in the order the CSS imported them', () => {
    const links = fontSetLinks('app', 'en')
    expect(links).toEqual(
      APP_FONT_STYLESHEETS.map((href) => ({ rel: 'stylesheet', href })),
    )
    expect(APP_FONT_STYLESHEETS.map((href) => new URL(href).host)).toEqual([
      'api.fontshare.com',
      'fonts.googleapis.com',
    ])
  })

  it('makes no third-party request for the guest set', () => {
    for (const locale of ['en', 'bg'] as const) {
      for (const link of fontSetLinks('guest', locale)) {
        expect(link.href.startsWith('/fonts/guest/')).toBe(true)
      }
    }
  })

  it('links the guest stylesheet and preloads the Latin pair for a Latin locale', () => {
    const links = fontSetLinks('guest', 'en')
    expect(links[0]).toEqual({ rel: 'stylesheet', href: GUEST_FONT_STYLESHEET })
    expect(links.slice(1)).toEqual([
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
        href: '/fonts/guest/cormorant-garamond-latin-600-normal.woff2',
      },
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
        href: '/fonts/guest/ysabeau-office-latin-400-normal.woff2',
      },
    ])
  })

  it('preloads the Cyrillic pair for Bulgarian', () => {
    const preloads = fontSetLinks('guest', 'bg').filter((link) => link.rel === 'preload')
    expect(preloads.map((link) => link.href)).toEqual([
      '/fonts/guest/cormorant-garamond-cyrillic-600-normal.woff2',
      '/fonts/guest/ysabeau-office-cyrillic-400-normal.woff2',
    ])
  })

  it('never mixes the two sets', () => {
    const app = fontSetLinks('app', 'en').map((link) => link.href)
    const guest = fontSetLinks('guest', 'en').map((link) => link.href)
    expect(app.some((href) => href.includes('/fonts/guest/'))).toBe(false)
    expect(guest.some((href) => href.startsWith('https://'))).toBe(false)
  })

  it('preloads only files the guest stylesheet actually serves', () => {
    for (const link of fontSetLinks('guest', 'en').filter((l) => l.rel === 'preload')) {
      expect(guestCss).toContain(`url(${link.href})`)
      expect(existsSync(join(ROOT, 'public', link.href))).toBe(true)
    }
    for (const link of fontSetLinks('guest', 'bg').filter((l) => l.rel === 'preload')) {
      expect(guestCss).toContain(`url(${link.href})`)
      expect(existsSync(join(ROOT, 'public', link.href))).toBe(true)
    }
  })
})

type FontFace = Readonly<{
  family: string
  style: string
  weight: string
  display: string
  src: string
  range: string
}>

function fontFaces(css: string): readonly FontFace[] {
  const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
  return blocks.map((block) => {
    const body = block[1] ?? ''
    const read = (name: string) =>
      new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? ''
    return {
      family: read('font-family').replace(/['"]/g, ''),
      style: read('font-style'),
      weight: read('font-weight'),
      display: read('font-display'),
      src: read('src'),
      range: read('unicode-range'),
    }
  })
}

describe('the vendored guest fonts', () => {
  const faces = fontFaces(guestCss)
  const real = faces.filter((face) => face.src.includes('/fonts/guest/'))
  const subsets = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']

  it('covers Cormorant Garamond 600 and 500 italic, and Ysabeau Office 400 and 600, in four subsets each', () => {
    const wanted = subsets.flatMap((subset) => [
      `Cormorant Garamond|normal|600|${subset}`,
      `Cormorant Garamond|italic|500|${subset}`,
      `Ysabeau Office|normal|400|${subset}`,
      `Ysabeau Office|normal|600|${subset}`,
    ])
    const found = real.map((face) => {
      const file =
        /\/fonts\/guest\/[a-z-]+?-(latin-ext|latin|cyrillic-ext|cyrillic)-\d+-(?:normal|italic)\.woff2/.exec(
          face.src,
        )
      return `${face.family}|${face.style}|${face.weight}|${file?.[1]}`
    })
    expect([...found].sort()).toEqual([...wanted].sort())
  })

  it('swaps in while loading, and gives every subset its own unicode range', () => {
    for (const face of real) {
      expect(face.display).toBe('swap')
      expect(face.range.length).toBeGreaterThan(0)
    }
  })

  it('has every referenced file on disk, as woff2', () => {
    for (const face of real) {
      const path = /url\((\/fonts\/guest\/[^)]+)\)\s*format\('woff2'\)/.exec(
        face.src,
      )?.[1]
      expect(path, face.src).toBeDefined()
      expect(existsSync(join(ROOT, 'public', path ?? '')), path).toBe(true)
    }
  })

  it('never reaches a third-party host', () => {
    expect(guestCss).not.toMatch(/https?:\/\//)
    expect(guestCss).not.toMatch(/@import/)
  })

  it('adjusts a local fallback face to each web font, so text does not jump when it loads', () => {
    const fallbacks = faces.filter((face) => face.src.startsWith('local('))
    expect(fallbacks.map((face) => face.family).sort()).toEqual([
      'Cormorant Garamond Fallback',
      'Ysabeau Office Fallback',
    ])
    for (const fallback of fallbacks) {
      const block = guestCss.slice(guestCss.indexOf(`'${fallback.family}'`))
      expect(block).toMatch(/size-adjust:\s*\d/)
      expect(block).toMatch(/ascent-override:\s*\d/)
      expect(block).toMatch(/descent-override:\s*\d/)
    }
  })

  it('ships the licence of both families beside the files', () => {
    for (const name of ['cormorant-garamond', 'ysabeau-office']) {
      const licence = readFileSync(
        join(ROOT, `public/fonts/guest/OFL-${name}.txt`),
        'utf8',
      )
      expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1')
    }
  })
})

describe('the app stylesheet', () => {
  it('no longer imports a third-party font, so a route can choose its own set', () => {
    const styles = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')
    expect(styles).not.toMatch(/@import\s+url\(/)
    expect(styles).not.toContain('fontshare')
    expect(styles).not.toContain('fonts.googleapis')
  })
})
