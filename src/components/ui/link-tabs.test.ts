import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { LinkTab, LinkTabs } from './link-tabs'
import { Tabs, TabsList, TabsTrigger, TabCount } from './tabs'
import { LINE_TAB_CLASS } from './tabs-line-styles'

/** The recipe as it appears inside a rendered `class` attribute. */
const RECIPE_IN_MARKUP = LINE_TAB_CLASS.replaceAll('&', '&amp;').replaceAll("'", '&#x27;')

/** Rendered through a real router, as a first request is, standing at `url`. */
function renderAt(url: string, node: ReactNode): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, { router, children: node }),
  )
}

/** A tab, typed loosely: the test router has no route tree to type against. */
function tab(props: Readonly<Record<string, unknown>>, label: string): ReactNode {
  return createElement(LinkTab as never, props, label)
}

/** The opening tag of the link to `href`, whatever order its attributes came in. */
function anchorTo(html: string, href: string): string {
  const escaped = href.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  const tag = html.match(new RegExp(`<a [^>]*href="${escaped}"[^>]*>`, 'u'))?.[0]
  if (tag === undefined) throw new Error(`no link to ${href} in ${html}`)
  return tag
}

const PORTAL = { to: '/portals/$portalId', params: { portalId: 'p1' } }

function render(active: 'page' | 'share', url = '/portals/p1?tab=page'): string {
  return renderAt(
    url,
    createElement(
      LinkTabs,
      { 'aria-label': 'Portal sections' },
      tab({ ...PORTAL, search: { tab: 'page' }, current: active === 'page' }, 'Page'),
      tab({ ...PORTAL, search: { tab: 'share' }, current: active === 'share' }, 'Share'),
    ),
  )
}

describe('LinkTabs', () => {
  it('is a named navigation landmark holding a list of links, not a tablist', () => {
    const html = render('page')

    expect(html).toMatch(/^<nav /)
    expect(html).toContain('aria-label="Portal sections"')
    expect(html).toContain('<ul')
    expect(html.match(/<li/g)).toHaveLength(2)
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('role="tab"')
  })

  it('marks only the tab the page says is current as the current page', () => {
    const html = render('share')

    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(anchorTo(html, '/portals/p1?tab=share')).toContain('aria-current="page"')
    expect(anchorTo(html, '/portals/p1?tab=share')).toContain('data-state="active"')
    expect(anchorTo(html, '/portals/p1?tab=page')).not.toContain('aria-current')
    expect(anchorTo(html, '/portals/p1?tab=page')).toContain('data-state="inactive"')
  })

  it('does not let the router name a second current page when one tab is a subset of another', () => {
    // The bare list and the same list with `?tab=removed`: standing on the second,
    // the router calls the first active too (its search is a subset), which used to
    // need `activeOptions={{ exact: true }}` on every such link.
    const html = renderAt(
      '/properties?tab=removed',
      createElement(
        LinkTabs,
        { 'aria-label': 'Which properties' },
        tab({ to: '/properties', current: false }, 'Workspace'),
        tab({ to: '/properties', search: { tab: 'removed' }, current: true }, 'Removed'),
      ),
    )

    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(anchorTo(html, '/properties?tab=removed')).toContain('aria-current="page"')
    expect(anchorTo(html, '/properties')).not.toContain('aria-current')
    expect(html).not.toContain('data-status')
  })

  it('draws a link the way a line tab is drawn, from the same recipe', () => {
    const html = render('page')

    expect(html).toContain(RECIPE_IN_MARKUP)
    expect(html).toContain('border-b')
  })

  it('wears the underline in the primary ink, the Portal workspace strip it was lifted from', () => {
    expect(LINE_TAB_CLASS).toContain('data-[state=active]:after:bg-primary')
    expect(LINE_TAB_CLASS).toContain('after:h-0.5')
    expect(LINE_TAB_CLASS).not.toContain('after:bg-foreground')
  })

  it('is 36px from md and the touch height below it, as every control is', () => {
    // Decision 1: desktop heights belong to the controls (36px), the touch token
    // (44px, 36px in a compact workspace) applies below `md`.
    expect(LINE_TAB_CLASS).toContain('min-h-9')
    expect(LINE_TAB_CLASS).toContain('max-md:min-h-(--control-touch)')
    expect(LINE_TAB_CLASS).not.toMatch(/(?<!max-md:)min-h-\(--control-touch\)/)
  })

  it('scrolls sideways instead of wrapping, with the scrollbar hidden and room for the fade', () => {
    const html = render('page')

    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('min-w-max')
    expect(html).toContain('[scrollbar-width:none]')
    expect(html).toContain('scroll-px-6')
  })

  it('draws no fade on the server: until measured, every tab fits', () => {
    expect(render('page')).not.toContain('mask-image')
  })

  it('lets the caller add a class, for the gutter of a full-bleed band', () => {
    const html = renderAt(
      '/',
      createElement(
        LinkTabs,
        { 'aria-label': 'Views', className: 'px-4 md:px-6' },
        tab({ to: '/', current: true }, 'A'),
      ),
    )

    expect(html).toContain('px-4 md:px-6')
  })

  it('lets the caller add a class to a tab, merged with the recipe', () => {
    const html = renderAt(
      '/',
      createElement(
        LinkTabs,
        { 'aria-label': 'Views' },
        tab({ to: '/', current: true, className: 'tab-extra' }, 'A'),
      ),
    )

    expect(html).toContain('tab-extra')
    expect(html).toContain(RECIPE_IN_MARKUP)
  })
})

describe('line Tabs', () => {
  function renderRadix(variant: 'line' | 'default'): string {
    return renderToStaticMarkup(
      createElement(
        Tabs,
        { value: 'all' },
        createElement(
          TabsList,
          { variant, 'aria-label': 'Filter' },
          createElement(TabsTrigger, { value: 'all' }, 'All'),
          createElement(TabsTrigger, { value: 'unread' }, 'Unread'),
        ),
      ),
    )
  }

  it('draws a Radix line trigger from the recipe the link twin uses', () => {
    const html = renderRadix('line')

    expect(html).toContain(RECIPE_IN_MARKUP)
    expect(html).toContain('data-variant="line"')
  })

  it('keeps a baseline under the line list, as the link strip has', () => {
    expect(renderRadix('line')).toMatch(
      /data-slot="tabs-list"[^>]*border-b|border-b[^>]*data-slot="tabs-list"/,
    )
  })

  it('leaves the pill trigger alone: no underline recipe, still the muted pill', () => {
    const html = renderRadix('default')

    expect(html).not.toContain('after:bg-primary')
    expect(html).not.toContain('border-b')
    expect(html).toContain('bg-muted')
    expect(html).toContain('data-[state=active]:bg-background')
  })
})

describe('TabCount', () => {
  it('is the one count anatomy: tabular figures in muted ink beside the label', () => {
    const html = renderToStaticMarkup(createElement(TabCount, null, 6))

    expect(html).toContain('tabular-nums')
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('>6<')
  })
})
