import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LinkTab, LinkTabs } from './link-tabs'
import { Tabs, TabsList, TabsTrigger, TabCount } from './tabs'
import { LINE_TAB_CLASS } from './tabs-line-styles'

/** The recipe as it appears inside a rendered `class` attribute. */
const RECIPE_IN_MARKUP = LINE_TAB_CLASS.replaceAll('&', '&amp;').replaceAll("'", '&#x27;')

function render(active: 'page' | 'share'): string {
  return renderToStaticMarkup(
    createElement(
      LinkTabs,
      { 'aria-label': 'Portal sections' },
      createElement(LinkTab, {
        active: active === 'page',
        children: createElement('a', { href: '/portal?tab=page' }, 'Page'),
      }),
      createElement(LinkTab, {
        active: active === 'share',
        children: createElement('a', { href: '/portal?tab=share' }, 'Share'),
      }),
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

  it('marks only the active link as the current page', () => {
    const html = render('share')

    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/href="\/portal\?tab=share"[^>]*aria-current="page"/)
    expect(html).toMatch(/href="\/portal\?tab=share"[^>]*data-state="active"/)
    expect(html).toMatch(/href="\/portal\?tab=page"[^>]*data-state="inactive"/)
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

  it('is a tap target below md and keeps the desktop height from md', () => {
    expect(LINE_TAB_CLASS).toContain('min-h-(--control-touch)')
    expect(LINE_TAB_CLASS).toContain('md:min-h-9')
  })

  it('scrolls sideways instead of wrapping when the links do not fit', () => {
    const html = render('page')

    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('min-w-max')
  })

  it('lets the caller add a class, for the gutter of a full-bleed band', () => {
    const html = renderToStaticMarkup(
      createElement(
        LinkTabs,
        { 'aria-label': 'Views', className: 'px-4 md:px-6' },
        createElement(LinkTab, {
          active: true,
          children: createElement('a', { href: '/' }, 'A'),
        }),
      ),
    )

    expect(html).toContain('px-4 md:px-6')
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
