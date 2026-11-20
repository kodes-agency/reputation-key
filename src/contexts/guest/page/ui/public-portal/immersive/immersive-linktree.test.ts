// The Linktree is rendered to markup and read back: the unit project has no DOM.
// Computed geometry, hover and axe run in the stories next to this file.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PORTAL_LINK_ICON_KEYS } from '#/shared/domain/portal-link-icon'
import {
  ImmersiveLinktree,
  InertImmersiveLinktree,
  type ImmersiveLinktreeLink,
  type ImmersiveLinktreeProps,
  type InertImmersiveLinktreeProps,
} from './immersive-linktree'
import { linktreeIconFor } from './linktree-icons'
import { LINKTREE_CSS } from './linktree-styles'

const LINKS: readonly ImmersiveLinktreeLink[] = [
  {
    id: 'l1',
    iconKey: 'waves',
    imageUrl: null,
    label: 'Spa & treatments',
    line: 'Book a time',
    fallbackFrom: null,
  },
  {
    id: 'l2',
    iconKey: 'utensils',
    imageUrl: null,
    label: 'Olive Terrace menu',
    line: null,
    fallbackFrom: null,
  },
]

const base: ImmersiveLinktreeProps = {
  enabled: true,
  title: { value: 'Around the resort', fallbackFrom: null },
  defaultTitle: 'Useful links',
  links: LINKS,
  hrefFor: (id) => `/api/public/p/tok/click/${id}`,
}

const render = (props: Partial<ImmersiveLinktreeProps> = {}) =>
  renderToStaticMarkup(createElement(ImmersiveLinktree, { ...base, ...props }))

/** The markup without the hoisted stylesheet, whose class names would match a markup check. */
const withoutStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')
const anchors = (html: string) => withoutStyle(html).match(/<a\b[^>]*>/gu) ?? []
const tags = (html: string, name: string) =>
  withoutStyle(html).match(new RegExp(`<${name}\\b[^>]*>`, 'gu')) ?? []

describe('ImmersiveLinktree visibility', () => {
  it('renders nothing when the Linktree is switched off', () => {
    expect(render({ enabled: false })).toBe('')
  })

  it('renders nothing when there is no link to show', () => {
    expect(render({ links: [] })).toBe('')
  })
})

describe('ImmersiveLinktree structure', () => {
  const html = render()

  it("names the navigation landmark by the visible title, so it keeps the title's language", () => {
    const nav = tags(html, 'nav')[0] ?? ''
    const heading = /<h2\b[^>]*\bid="([^"]+)"/u.exec(withoutStyle(html))?.[1]
    expect(heading).toBeTruthy()
    expect(nav).toContain(`aria-labelledby="${heading}"`)
    expect(nav).not.toContain('aria-label=')
  })

  it('shows the section title as a heading', () => {
    expect(withoutStyle(html)).toMatch(/<h2\b[^>]*>Around the resort<\/h2>/u)
  })

  it('lists the links in order, one list item and one anchor each', () => {
    expect(tags(html, 'li')).toHaveLength(2)
    const hrefs = anchors(html).map((tag) => /href="([^"]*)"/u.exec(tag)?.[1])
    expect(hrefs).toEqual(['/api/public/p/tok/click/l1', '/api/public/p/tok/click/l2'])
  })

  it('draws a two-column grid', () => {
    expect(withoutStyle(html)).toContain('ih-linktree__grid')
    expect(LINKTREE_CSS).toMatch(
      /\.ih-linktree__grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u,
    )
  })

  it('keeps the tracked destination out of the markup: the page never holds a link URL', () => {
    expect(html).not.toContain('https://')
  })

  it('follows the page in the same tab, as the legacy page does', () => {
    for (const tag of anchors(html)) {
      expect(tag).not.toContain('target=')
      expect(tag).toContain('rel="noreferrer"')
    }
  })

  it('escapes a label a manager typed', () => {
    const hostile = render({
      links: [{ ...LINKS[0]!, label: '<img src=x onerror=alert(1)>' }],
    })
    expect(withoutStyle(hostile)).not.toContain('<img src=x')
    expect(hostile).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it("hoists its own stylesheet, apart from the shell's", () => {
    const style = /<style[^>]*>([\s\S]*?)<\/style>/u.exec(html)
    expect(style?.[1]).toBe(LINKTREE_CSS)
  })
})

describe('ImmersiveLinktree title', () => {
  it('uses the language default when the stored title is blank', () => {
    const html = render({ title: { value: '   ', fallbackFrom: null } })
    expect(withoutStyle(html)).toMatch(/<h2\b[^>]*>Useful links<\/h2>/u)
  })

  it('marks a title copied from another language with that language', () => {
    const html = render({ title: { value: 'Around the resort', fallbackFrom: 'en' } })
    expect(withoutStyle(html)).toMatch(
      /<h2\b[^>]*lang="en"[^>]*>Around the resort<\/h2>/u,
    )
  })

  it('leaves a title in the page language unmarked', () => {
    expect(tags(render(), 'h2')[0]).not.toContain('lang=')
  })
})

describe('ImmersiveLinktree link wording', () => {
  const fallbackLinks: readonly ImmersiveLinktreeLink[] = [
    { ...LINKS[0]!, label: 'Das Resort entdecken', line: 'Zimmer, Pools und Meer' },
    {
      ...LINKS[1]!,
      label: 'Olive Terrace menu',
      line: 'Lunch and dinner',
      fallbackFrom: 'en',
    },
  ]
  const html = withoutStyle(render({ links: fallbackLinks }))

  it('takes the language of a fallback text from the snapshot', () => {
    expect(html).toMatch(/<span class="ih-tile__text" lang="en">/u)
  })

  it('leaves a text in the page language unmarked', () => {
    expect(html).toMatch(/<span class="ih-tile__text">/u)
    expect((html.match(/lang="en"/gu) ?? []).length).toBe(1)
  })

  it('shows the label, and the line only when there is one', () => {
    const plain = withoutStyle(render())
    expect(plain).toContain('Book a time')
    expect((plain.match(/ih-tile__line/gu) ?? []).length).toBe(1)
  })
})

describe('ImmersiveLinktree icons and photos', () => {
  const photo = 'https://media.example.com/terrace.jpg'

  it('draws the lucide icon an icon key names, hidden from assistive technology', () => {
    const html = withoutStyle(render())
    expect(html).toContain('lucide-waves')
    expect(html).toContain('lucide-utensils')
    expect(html).toMatch(/<svg\b[^>]*aria-hidden="true"/u)
  })

  it('draws the default link icon for a tile with no icon key', () => {
    const html = withoutStyle(render({ links: [{ ...LINKS[0]!, iconKey: null }] }))
    expect(html).toContain('lucide-link')
    expect(html).not.toContain('lucide-waves')
  })

  it('draws no icon for a key it does not know, never another one in its place', () => {
    const html = withoutStyle(
      render({ links: [{ ...LINKS[0]!, iconKey: 'not-an-icon' }] }),
    )
    expect(html).not.toContain('ih-tile__icon')
    expect(html).not.toContain('lucide-link"')
    expect(html).toContain('Spa &amp; treatments')
  })

  it('shows a photo tile instead of an icon tile when the link has a photo', () => {
    const html = withoutStyle(render({ links: [{ ...LINKS[0]!, imageUrl: photo }] }))
    expect(html).toContain('ih-tile--photo')
    expect(html).not.toContain('ih-tile--icon')
    expect(html).not.toContain('lucide-waves')
    const image = /<img\b[^>]*>/u.exec(html)?.[0] ?? ''
    expect(image).toContain(`src="${photo}"`)
    expect(image).toContain('alt=""')
    expect(image).toContain('loading="lazy"')
    expect(image).not.toContain('fetchPriority')
  })

  it('declares the photo box size, so nothing moves when it arrives', () => {
    const html = withoutStyle(render({ links: [{ ...LINKS[0]!, imageUrl: photo }] }))
    const image = /<img\b[^>]*>/u.exec(html)?.[0] ?? ''
    expect(image).toMatch(/width="\d+"/u)
    expect(image).toMatch(/height="\d+"/u)
  })

  it('has a lucide icon for every key a manager can choose', () => {
    for (const key of PORTAL_LINK_ICON_KEYS) expect(linktreeIconFor(key)).not.toBeNull()
  })

  it('names the default link icon for a tile with no key', () => {
    expect(linktreeIconFor(null)).toBe(linktreeIconFor('link'))
  })

  it.each(['', 'Waves', 'constructor', '__proto__', 'toString'])(
    'has no icon for the unknown key %j',
    (key) => {
      expect(linktreeIconFor(key)).toBeNull()
    },
  )
})

describe('InertImmersiveLinktree (the admin preview)', () => {
  const photo = 'https://media.example.com/terrace.jpg'
  const renderInert = (props: Partial<InertImmersiveLinktreeProps> = {}) =>
    renderToStaticMarkup(
      createElement(InertImmersiveLinktree, {
        enabled: base.enabled,
        title: base.title,
        defaultTitle: base.defaultTitle,
        links: base.links,
        ...props,
      }),
    )

  it('draws the same title and tiles but no anchor, no address and no button', () => {
    const html = withoutStyle(renderInert())
    expect(html).toMatch(/<h2\b[^>]*>Around the resort<\/h2>/u)
    expect(html).toContain('Spa &amp; treatments')
    expect(html).toContain('Olive Terrace menu')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('<button')
    expect(tags(html, 'li')).toHaveLength(2)
  })

  it('draws a photo tile with its photo, the arrow and its text, and still no anchor', () => {
    const html = withoutStyle(renderInert({ links: [{ ...LINKS[0]!, imageUrl: photo }] }))
    expect(html).toContain('ih-tile--photo')
    expect(html).toContain(`src="${photo}"`)
    expect(html).toContain('ih-tile__arrow')
    expect(html).toContain('Spa &amp; treatments')
    expect(html).not.toContain('<a ')
  })

  it('marks an inert tile so the stylesheet can drop the pointer', () => {
    expect(withoutStyle(renderInert())).toContain('ih-tile--inert')
    expect(LINKTREE_CSS).toMatch(/\.ih-tile--inert \{[^}]*cursor: default/u)
  })

  it('keeps the Linktree rules: nothing renders when it is off or empty', () => {
    expect(renderInert({ enabled: false })).toBe('')
    expect(renderInert({ links: [] })).toBe('')
  })

  it('draws a waiting tile as a dashed variant of the real tile, with the reason for its line', () => {
    const html = withoutStyle(
      renderInert({
        links: [
          {
            ...LINKS[1]!,
            line: 'Lunch and dinner',
            placeholder: { kind: 'awaiting_approval', note: 'Waiting for approval' },
          },
        ],
      }),
    )
    expect(html).toContain('ih-glass ih-glass--tile ih-tile')
    expect(html).toContain('ih-tile--waiting')
    expect(html).toContain('data-ih-tile-placeholder="awaiting_approval"')
    expect(html).toContain('lucide-clock')
    expect(html).toContain('Olive Terrace menu')
    expect(html).toMatch(/<span class="ih-tile__line">Waiting for approval<\/span>/u)
    expect(html).not.toContain('Lunch and dinner')
    expect(html).not.toContain('ih-tile__arrow')
    expect(LINKTREE_CSS).toMatch(/\.ih-tile--waiting \{[^}]*dashed/u)
  })

  it('draws a waiting tile with a photo as a glass tile: nothing is approved to show', () => {
    const html = withoutStyle(
      renderInert({
        links: [
          {
            ...LINKS[0]!,
            imageUrl: photo,
            placeholder: { kind: 'not_approved', note: 'Not approved' },
          },
        ],
      }),
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('ih-tile--photo')
  })

  it('never draws a placeholder on a live page, whatever the link carries', () => {
    const html = withoutStyle(
      render({
        links: [
          {
            ...LINKS[0]!,
            placeholder: { kind: 'awaiting_approval', note: 'Waiting for approval' },
          },
        ],
      }),
    )
    expect(html).not.toContain('Waiting for approval')
    expect(html).not.toContain('ih-tile--waiting')
    expect(html).toContain('href="/api/public/p/tok/click/l1"')
  })
})
