// The shell is rendered to markup and read back: the unit project has no DOM,
// and the pieces that matter here (which image loads first, what is decorative,
// what the stylesheet says) are all visible in the markup. Computed styles and
// axe run in the Storybook stories next to this file.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GlassSurface, glassClassName } from './glass-surface'
import { focalObjectPosition } from './guest-hero'
import {
  IMMERSIVE_TEXT_COLOUR,
  PHOTO_BACKDROP,
  resolveImmersiveLook,
} from './immersive-look'
import { ImmersiveShell, type ImmersiveShellProps } from './immersive-shell'
import { IMMERSIVE_CSS } from './immersive-styles'

const HERO = {
  url: 'https://media.example.com/harbor-1600.jpg',
  width: 1600,
  height: 1000,
  focalX: 0.4,
  focalY: 0.6,
} as const
const BRAND = { accentColour: '#EAD6A8', fieldColour: '#15110D' } as const

function render(props: Partial<ImmersiveShellProps> = {}, content = 'Page content') {
  return renderToStaticMarkup(
    createElement(
      ImmersiveShell,
      {
        brand: { ...BRAND, hero: null },
        heroAlt: { value: '' },
        lang: 'en',
        ...props,
      },
      createElement('p', null, content),
    ),
  )
}

const images = (html: string) => html.match(/<img\b[^>]*>/gu) ?? []
/** The markup without the hoisted stylesheet, whose class names would match a markup check. */
const withoutStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')

describe('ImmersiveShell with a photo', () => {
  const html = render({
    brand: { ...BRAND, hero: HERO },
    heroAlt: { value: 'The Harbor Hotel at dusk' },
  })

  it('loads the hero, and only the hero, eagerly at high priority', () => {
    const eager = images(html).filter((tag) => tag.includes('fetchPriority="high"'))
    expect(eager).toHaveLength(1)
    expect(eager[0]).toContain('loading="eager"')
    expect(eager[0]).toContain('src="https://media.example.com/harbor-1600.jpg"')
  })

  it('declares the hero size so its box exists before it loads', () => {
    const hero = images(html).find((tag) => tag.includes('ih-hero__image'))
    expect(hero).toContain('width="1600"')
    expect(hero).toContain('height="1000"')
  })

  it('describes the hero with the page-language alt text', () => {
    const hero = images(html).find((tag) => tag.includes('ih-hero__image'))
    expect(hero).toContain('alt="The Harbor Hotel at dusk"')
  })

  it('marks the photo decorative when it has no description', () => {
    const decorative = render({ brand: { ...BRAND, hero: HERO }, heroAlt: { value: '' } })
    expect(images(decorative).find((tag) => tag.includes('ih-hero__image'))).toContain(
      'alt=""',
    )
  })

  it('marks the alt text with its own language when it is a fallback from another one', () => {
    const fallback = render({
      brand: { ...BRAND, hero: HERO },
      lang: 'bg',
      heroAlt: { value: 'The Harbor Hotel at dusk', lang: 'en' },
    })
    const hero = images(fallback).find((tag) => tag.includes('ih-hero__image'))
    expect(hero).toContain('lang="en"')
    expect(images(html).find((tag) => tag.includes('ih-hero__image'))).not.toContain(
      'lang=',
    )
  })

  it('meets the hero image first, so the backdrop copy cannot claim its request at low priority', () => {
    const tags = images(html)
    const heroAt = tags.findIndex((tag) => tag.includes('ih-hero__image'))
    const backdropAt = tags.findIndex((tag) => tag.includes('ih-backdrop__photo'))
    expect(heroAt).toBeGreaterThanOrEqual(0)
    expect(backdropAt).toBeGreaterThan(heroAt)
  })

  it('hides a blurred copy of the photo from assistive technology and ranks it low', () => {
    expect(html).toContain('data-ih-backdrop="photo" aria-hidden="true"')
    const copy = images(html).find((tag) => tag.includes('ih-backdrop__photo'))
    expect(copy).toContain('alt=""')
    expect(copy).toContain('fetchPriority="low"')
    expect(copy).not.toContain('fetchPriority="high"')
  })

  it('keeps the focal point of the crop', () => {
    expect(html).toContain('--ih-focal:40% 60%')
  })

  it('draws no arch and no grain', () => {
    expect(withoutStyle(html)).not.toContain('ih-arch')
    expect(withoutStyle(html)).not.toContain('feTurbulence')
    expect(html).toContain('data-ih-surface="photo"')
  })
})

describe('ImmersiveShell with no photo (board G09)', () => {
  const html = render()

  it('loads no image at all', () => {
    expect(images(html)).toHaveLength(0)
  })

  it('draws the field, its washes, its grain and the arch, all decorative', () => {
    expect(html).toContain('data-ih-surface="field"')
    expect(withoutStyle(html)).toContain('ih-backdrop__wash--field')
    expect(html).toContain('<feTurbulence')
    expect(html).toContain('data-ih-hero="arch"')
    expect(html).toMatch(/<svg[^>]*class="ih-arch"[^>]*aria-hidden="true"/u)
  })

  it('gives each grain filter its own id, so two shells on a page do not collide', () => {
    const id = (markup: string) => /<filter id="([^"]+)"/u.exec(markup)?.[1]
    const both = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(
          ImmersiveShell,
          { brand: { ...BRAND, hero: null }, heroAlt: { value: '' }, lang: 'en' },
          null,
        ),
        createElement(
          ImmersiveShell,
          { brand: { ...BRAND, hero: null }, heroAlt: { value: '' }, lang: 'en' },
          null,
        ),
      ),
    )
    const ids = [...both.matchAll(/<filter id="([^"]+)"/gu)].map((match) => match[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(id(html)).toBeTruthy()
  })
})

describe('ImmersiveShell frame', () => {
  it('is the one main landmark of the public page, in the page language, left to right', () => {
    const html = render({ lang: 'bg', height: 'page' })
    expect(html.match(/<main\b/gu)).toHaveLength(1)
    expect(html).toMatch(/<main[^>]*lang="bg"/u)
    expect(html).toMatch(/<main[^>]*dir="ltr"/u)
  })

  it('is no landmark inside a frame, where the host page owns the main landmark', () => {
    for (const html of [render({ height: 'container', lang: 'bg' }), render()]) {
      expect(html).not.toContain('<main')
      expect(withoutStyle(html)).toMatch(
        /^<div class="ih-root ih-root--container"[^>]*lang="/u,
      )
    }
  })

  it('renders its children inside the content column', () => {
    expect(render({}, 'Rate your visit')).toMatch(
      /<div class="ih-column"><p>Rate your visit<\/p><\/div>/u,
    )
  })

  it('carries the resolved look on the root, never the raw brand input', () => {
    const html = render({
      brand: {
        accentColour: 'red; } body { display: none',
        fieldColour: '#fff',
        hero: null,
      },
    })
    const look = resolveImmersiveLook({ accentColour: 'x', fieldColour: 'y' })
    expect(html).toContain(`--ih-accent:${look.accent}`)
    expect(html).not.toContain('display: none')
  })

  it('fills the viewport for the public page and its frame inside a preview', () => {
    expect(render({ height: 'page' })).toContain('ih-root ih-root--page')
    expect(render({ height: 'container' })).toContain('ih-root ih-root--container')
    expect(render()).toContain('ih-root--container')
  })

  it('reads none of the app theme: no theme utility or app surface token on the root', () => {
    const html = withoutStyle(render())
    expect(html).not.toMatch(/\bdark:|bg-background|text-foreground|var\(--background\)/u)
  })
})

describe('the stylesheet', () => {
  const html = render()
  const style = /<style[^>]*>([\s\S]*?)<\/style>/u.exec(html)

  it('is emitted once, hoisted with a precedence, and readable as CSS', () => {
    expect(style).not.toBeNull()
    // React escapes text children of a plain <style>; a hoisted one is raw CSS.
    expect(style?.[1]).toBe(IMMERSIVE_CSS)
    expect(style?.[1]).not.toMatch(/&(?:gt|quot|amp|#x27);/u)
  })

  it('answers the global link colour, which no scoped selector could outrank', () => {
    expect(IMMERSIVE_CSS).toMatch(
      /\.ih-root a \{[^}]*color: var\(--ih-link-colour, inherit\) !important/u,
    )
    expect(IMMERSIVE_CSS).toMatch(
      /\.ih-root a \{[^}]*text-decoration: var\(--ih-link-decoration, none\) !important/u,
    )
  })

  it('pins the dark colour scheme on the document over the theme script, for the page alone', () => {
    expect(IMMERSIVE_CSS).toMatch(
      /:root:has\(\.ih-root--page\) \{ color-scheme: dark !important/u,
    )
    expect(IMMERSIVE_CSS).toMatch(/body:has\(\.ih-root--page\) \{ background-color:/u)
    expect(IMMERSIVE_CSS).toMatch(/\.ih-root \{[^}]*color-scheme: dark/u)
  })

  it('never reaches the document from a frame: no document rule matches a bare root', () => {
    for (const rule of IMMERSIVE_CSS.matchAll(/(?:^|\n)((?::root|html|body)[^{]*)\{/gu)) {
      expect(rule[1]).toContain('.ih-root--page')
    }
  })

  it('answers body { overflow-wrap: anywhere } with break-word and language hyphenation', () => {
    expect(IMMERSIVE_CSS).toMatch(/\.ih-root \{[^}]*overflow-wrap: break-word/u)
    expect(IMMERSIVE_CSS).toMatch(/\.ih-root \{[^}]*hyphens: auto/u)
    expect(IMMERSIVE_CSS).not.toMatch(/overflow-wrap:\s*anywhere/u)
  })

  it('gives every glass surface the resolver literal where backdrop-filter is missing', () => {
    const fallback =
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{([\s\S]*?)\n\}/u.exec(
        IMMERSIVE_CSS,
      )
    expect(fallback?.[1]).toMatch(
      /\.ih-glass \{[^}]*--ih-glass-bg: var\(--ih-glass-solid\)/u,
    )
    // The browsers that need the fallback predate color-mix: it must not rely on it.
    expect(fallback?.[1]).not.toContain('color-mix')
  })

  it('takes the page text colour from the resolver, not from a literal of its own', () => {
    expect(IMMERSIVE_CSS).not.toMatch(/#f6f1e8/iu)
    expect(IMMERSIVE_CSS).toMatch(/color: var\(--ih-text\)/u)
    expect(html).toContain(`--ih-text:${IMMERSIVE_TEXT_COLOUR}`)
  })

  it('stops the tile and chip motion for people who ask for less of it', () => {
    expect(IMMERSIVE_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.ih-root \.ih-glass \{ transition: none; \}[^@]*transform: none/u,
    )
  })

  it('selects text in the page accent, not the app purple', () => {
    expect(IMMERSIVE_CSS).toMatch(/\.ih-root ::selection \{[^}]*var\(--ih-accent\)/u)
  })

  it('draws the photo backdrop from constants the contrast tests pin', () => {
    expect(IMMERSIVE_CSS).toContain(`brightness(${PHOTO_BACKDROP.brightness})`)
    expect(IMMERSIVE_CSS).toContain(`${PHOTO_BACKDROP.fieldMix * 100}%, transparent)`)
  })

  it('prefixes backdrop-filter for Safari', () => {
    expect(IMMERSIVE_CSS).toContain('-webkit-backdrop-filter: var(--ih-glass-filter)')
  })

  it('declares no declaration that is a script, a url or an expression', () => {
    expect(IMMERSIVE_CSS).not.toMatch(/url\(|@import|expression\(|javascript:/iu)
  })
})

describe('GlassSurface', () => {
  it('builds the class list of each variant', () => {
    expect(glassClassName('card')).toBe('ih-glass ih-glass--card')
    expect(glassClassName('tile', 'p-3')).toBe('ih-glass ih-glass--tile p-3')
    expect(glassClassName('chip')).toBe('ih-glass ih-glass--chip')
  })

  it('renders a section with the card class and the caller attributes', () => {
    const html = renderToStaticMarkup(
      createElement(
        GlassSurface,
        { variant: 'card', as: 'section', 'aria-labelledby': 'question' },
        'Hello',
      ),
    )
    expect(html).toBe(
      '<section class="ih-glass ih-glass--card" aria-labelledby="question">Hello</section>',
    )
  })
})

describe('focalObjectPosition', () => {
  it('turns a unit focal point into percentages', () => {
    expect(focalObjectPosition(0.5, 0.42)).toBe('50% 42%')
    expect(focalObjectPosition(0, 1)).toBe('0% 100%')
  })

  it('clamps and repairs values outside the unit square', () => {
    expect(focalObjectPosition(-2, 7)).toBe('0% 100%')
    expect(focalObjectPosition(Number.NaN, Number.POSITIVE_INFINITY)).toBe('50% 50%')
  })
})
