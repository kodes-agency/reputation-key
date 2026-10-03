// SectionNav (UI consistency scan: NAV-01, NAV-05, NAV-07, NAV-09, FORM-07), rendered
// on the server through a real router, as a first request is. The Vitest runner
// compiles no Tailwind, so the classes are read as written; their geometry is
// proved in the Storybook metrics gate.
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { NavCount, SectionNav } from './section-nav'
import { SectionNavLayout } from './section-nav-layout'
import type { SectionNavItem } from './section-nav-types'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'

const ITEMS: ReadonlyArray<SectionNavItem> = [
  {
    key: 'profile',
    to: '/properties/$propertyId/settings/profile',
    params: { propertyId: PROPERTY_ID },
    label: 'Profile',
    summary: 'Name, country and timezone',
  },
  {
    key: 'google',
    to: '/properties/$propertyId/settings/google',
    params: { propertyId: PROPERTY_ID },
    label: 'Google',
    summary: 'Business Profile link',
    count: 3,
  },
  {
    key: 'danger',
    to: '/properties/$propertyId/settings/danger',
    params: { propertyId: PROPERTY_ID },
    label: 'Danger zone',
    group: 'danger',
  },
]

function render(
  node: ReactNode,
  url = `/properties/${PROPERTY_ID}/settings/profile`,
): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, { router, children: node }),
  )
}

type NavProps = Partial<Parameters<typeof SectionNav>[0]>

function nav(props: NavProps = {}, url?: string): string {
  return render(
    createElement(SectionNav, {
      'aria-label': 'Property settings sections',
      items: ITEMS,
      current: 'profile',
      ...props,
    }),
    url,
  )
}

/** The opening tag of the first element whose attributes match. */
function tagWith(html: string, needle: string): string {
  const match = new RegExp(`<[a-z]+[^>]*${needle}[^>]*>`, 'u').exec(html)
  return match?.[0] ?? ''
}

describe('SectionNav', () => {
  it('is a navigation landmark with a link per item, in item order', () => {
    const html = nav()

    expect(html).toContain('<nav aria-label="Property settings sections"')
    const labels = [...html.matchAll(/<a [^>]*>[\s\S]*?<\/a>/gu)].map((match) =>
      match[0]
        .replace(/<[^>]+>/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim(),
    )
    expect(labels).toEqual([
      'Profile Name, country and timezone',
      'Google Business Profile link 3',
      'Danger zone',
    ])
  })

  it('links each item to its address', () => {
    const html = nav()

    expect(html).toContain(`href="/properties/${PROPERTY_ID}/settings/google"`)
  })

  describe('which row is the current page', () => {
    it('is the item the nav names, and only that one', () => {
      const html = nav({ current: 'google' })

      expect(html.match(/aria-current="page"/gu)).toHaveLength(1)
      expect(tagWith(html, 'aria-current="page"')).toContain('settings/google')
    })

    it('is none when the nav names none', () => {
      expect(nav({ current: null })).not.toContain('aria-current')
    })

    it('does not follow the router: a page below a link does not make it current', () => {
      // The router is two levels under every item's address prefix, which TanStack
      // would call active for a link to the settings root.
      const html = nav(
        {
          current: 'profile',
          items: [
            ...ITEMS,
            {
              key: 'root',
              to: '/properties/$propertyId/settings',
              params: { propertyId: PROPERTY_ID },
              label: 'Settings home',
            },
          ],
        },
        `/properties/${PROPERTY_ID}/settings/profile`,
      )

      expect(html.match(/aria-current="page"/gu)).toHaveLength(1)
    })

    it('is drawn from the same attribute it is announced by', () => {
      const html = nav({ current: 'profile' })
      const row = tagWith(html, 'settings/profile')

      // The fill, the weight and the icon follow `aria-current`, so they cannot differ
      // from what a screen reader hears.
      expect(row).toContain('aria-[current=page]:bg-accent')
      expect(row).toContain('aria-[current=page]:font-medium')
      expect(row).not.toMatch(/(?:^|\s)bg-accent(?:\s|")/u)
    })
  })

  describe('the row', () => {
    it('wears the shared focus ring and the touch height', () => {
      const row = tagWith(nav(), 'settings/profile')

      expect(row).toContain('focus-ring')
      expect(row).toContain('max-md:min-h-(--control-touch)')
      expect(row).not.toContain('focus-visible:ring')
    })

    it('keeps a rail row at the touch token on every width', () => {
      const html = nav({ frame: 'rail' })

      expect(tagWith(html, 'settings/profile')).toMatch(
        /(?:^|\s|")min-h-\(--control-touch\)/u,
      )
    })

    it('draws a count only when there is one', () => {
      const html = nav({
        items: [
          { ...ITEMS[0]!, count: 0 },
          { ...ITEMS[1]!, count: null },
          { ...ITEMS[2]!, count: 12 },
        ],
      })

      expect(html.match(/tabular-nums/gu)).toHaveLength(1)
      expect(html).toContain('>12<')
    })

    it('draws the icon first and hides it from assistive technology', () => {
      const html = nav({ items: [{ ...ITEMS[0]!, icon: Lock }] })

      expect(html).toMatch(/<a [^>]*><svg [^>]*aria-hidden="true"/u)
    })

    it('takes any summary node, and leaves a missing one out', () => {
      const html = nav({
        items: [
          { ...ITEMS[0]!, summary: createElement('em', null, 'live value') },
          { ...ITEMS[1]!, summary: undefined },
        ],
      })

      expect(html).toContain('<em>live value</em>')
      expect(html).not.toContain('Business Profile link')
    })
  })

  describe('groups', () => {
    it('heads each named group and names its list after it', () => {
      const html = nav({
        items: ITEMS.map((item) => ({
          ...item,
          group: item.key === 'danger' ? 'Risky' : 'Set up',
        })),
      })

      expect(html).toContain('>Set up</p>')
      expect(html).toContain('>Risky</p>')
      expect(html.match(/<ul [^>]*aria-labelledby="/gu)).toHaveLength(2)
    })

    it('can leave the headings out and still keep the groups apart', () => {
      const html = nav({ groupHeadings: false })

      expect(html).not.toContain('<p ')
      expect(html.match(/<ul /gu)).toHaveLength(2)
    })

    it('draws the footer once, in the list only', () => {
      const html = nav({ footer: 'Edits stay in this draft.' })

      expect(html.match(/Edits stay in this draft\./gu)).toHaveLength(1)
      expect(html).toMatch(/<div [^>]*hidden[^>]*>Edits stay in this draft\.<\/div>/u)
    })
  })

  describe('presentation', () => {
    it('is a strip below the container width and a list from it, by default', () => {
      const html = nav()

      expect(html).toContain('data-presentation="auto"')
      expect(html).toContain('@3xl:flex-col')
      expect(html).toContain('overflow-x-auto')
    })

    it('waits for the wider container in the rail frame', () => {
      const html = nav({ frame: 'rail' })

      expect(html).toContain('@6xl:flex-col')
      expect(html).not.toContain('@3xl:')
    })

    it('is always a row when it is a strip, whatever the container', () => {
      const html = nav({ presentation: 'strip' })

      expect(html).toContain('data-presentation="strip"')
      expect(html).not.toContain('@')
      expect(html).toContain('overflow-x-auto')
    })

    it('is always a column when it is a list, whatever the container', () => {
      const html = nav({ presentation: 'list' })

      expect(html).toContain('data-presentation="list"')
      expect(html).not.toContain('@')
      expect(html).not.toContain('overflow-x-auto')
    })

    it('never switches on the viewport', () => {
      const html = nav({ footer: 'note', frame: 'rail' })

      expect(html).not.toMatch(
        /(?:^|[\s"])(?:sm|md|lg|xl|2xl):(?:flex-col|block|flex|hidden)/u,
      )
    })
  })

  describe('inside a layout', () => {
    it('takes its frame from the layout', () => {
      const html = render(
        createElement(SectionNavLayout, {
          frame: 'rail',
          children: createElement(SectionNav, {
            'aria-label': 'Editor sections',
            items: ITEMS,
            current: 'profile',
          }),
        }),
      )

      expect(html).toContain('@6xl:flex-col')
    })

    it('declares the container the nav waits for, around the layout that changes', () => {
      const html = render(
        createElement(SectionNavLayout, {
          frame: 'inline',
          children: createElement('div', null, 'content'),
        }),
      )

      expect(html).toMatch(
        /^<div class="@container[^"]*"><div class="grid[^"]*@3xl:grid-cols/u,
      )
      expect(html).toContain('content')
    })
  })
})

describe('NavCount', () => {
  it('is a tabular figure in the muted ink, red only when it is urgent', () => {
    const plain = render(createElement(NavCount, { children: 12 }))
    const urgent = render(createElement(NavCount, { tone: 'negative', children: 2 }))

    expect(plain).toContain('tabular-nums')
    expect(plain).toContain('text-muted-foreground')
    expect(urgent).toContain('text-negative')
    expect(urgent).not.toContain('text-muted-foreground')
  })
})
