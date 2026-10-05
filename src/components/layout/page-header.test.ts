// PageHeader slots (UI consistency scan: FRAME-08, FRAME-09, NAV-10).
//
// The first line under a title was a count on one page, the Property the page is
// about on another (which the breadcrumb already says), a purpose sentence on a
// third and a middle-dot meta line on a fourth. Each slot now has one job:
//
//   title        what the page is, or the name of the entity it is about
//   meta         where you are and what state it is in: the Property, a count, a status
//   description  one sentence of purpose, help text and nothing else
//   actions      what the page lets you do
//
// A page goes up through its breadcrumbs, so there is no separate "back" link above them.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './page-header'

type Props = Parameters<typeof PageHeader>[0]

function render(props: Props): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(PageHeader, props),
    }),
  )
}

describe('PageHeader title', () => {
  it('is the page one h1', () => {
    expect(render({ title: 'Ratings' })).toContain('<h1')
    expect(render({ title: 'Ratings' })).toMatch(/<h1[^>]*>Ratings<\/h1>/u)
  })
})

describe('PageHeader meta', () => {
  it('draws nothing when a page has no meta', () => {
    expect(render({ title: 'Ratings' })).not.toContain('data-slot="page-header-meta"')
    expect(render({ title: 'Ratings', meta: [] })).not.toContain(
      'data-slot="page-header-meta"',
    )
  })

  it('is one quiet line of the items it is given, in the muted ink', () => {
    const html = render({ title: 'Properties', meta: ['3 properties', '1 paused'] })

    expect(html).toContain('data-slot="page-header-meta"')
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('3 properties')
    expect(html).toContain('1 paused')
  })

  it('separates the items with a dot a screen reader skips, and puts none around one', () => {
    const several = render({ title: 'Group', meta: ['Group', '2 portals', 'Hotel'] })
    const dots = several.match(/<span aria-hidden="true">·<\/span>/gu) ?? []
    expect(dots).toHaveLength(2)

    const one = render({ title: 'Overview', meta: ['Hotel Aurora'] })
    expect(one).not.toContain('·')
  })

  it('can hold a status Badge as an item', () => {
    const html = render({
      title: 'Goal',
      meta: [createElement('span', { 'data-badge': 'active' }, 'Active')],
    })

    expect(html).toContain('data-badge="active"')
  })

  it('sits under the title and above the description', () => {
    const html = render({
      title: 'Portals',
      meta: ['3 portals'],
      description: 'Guest pages for this property.',
    })

    expect(html.indexOf('</h1>')).toBeLessThan(html.indexOf('3 portals'))
    expect(html.indexOf('3 portals')).toBeLessThan(
      html.indexOf('Guest pages for this property.'),
    )
  })
})

describe('PageHeader description', () => {
  it('is a paragraph of help text', () => {
    const html = render({ title: 'Ratings', description: 'How you are rated.' })

    expect(html).toMatch(/<p[^>]*>How you are rated\.<\/p>/u)
  })

  it('is left out when a page has none, so nothing reads as filler', () => {
    expect(render({ title: 'Ratings' })).not.toContain('<p')
  })
})

describe('PageHeader breadcrumbs', () => {
  const trail = [
    { label: 'Properties', to: '/properties' },
    { label: 'Hotel Aurora', to: '/properties/p1' },
    { label: 'Ratings' },
  ] as const

  it('links every crumb above the page and marks only the last as the page', () => {
    const html = render({ title: 'Ratings', breadcrumbs: trail })

    expect(html).toContain('href="/properties"')
    expect(html).toContain('href="/properties/p1"')
    expect(html.match(/aria-current="page"/gu) ?? []).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*>Ratings</u)
  })

  it('has no back link of its own: the way up is the trail', () => {
    // @ts-expect-error `backTo` is gone: a page that has breadcrumbs goes up through them.
    const html = render({ title: 'Ratings', breadcrumbs: trail, backTo: { to: '/' } })

    expect(html).not.toContain('Back to')
    expect(html).not.toContain('lucide-arrow-left')
  })
})

describe('PageHeader actions', () => {
  it('sit in one right-aligned slot beside the title', () => {
    const html = render({
      title: 'Goals',
      actions: createElement('button', { type: 'button' }, 'New goal'),
    })

    expect(html).toContain('New goal')
    expect(html).toContain('justify-between')
  })
})
