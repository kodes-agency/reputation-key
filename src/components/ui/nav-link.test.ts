// One "you are here" for a navigation link (UI consistency scan: NAV-09).
//
// TanStack's Link marks itself `aria-current="page"` (and `data-status`) whenever
// the location is at or under its path, and a prop cannot undo that. A nav that
// draws its own active row from a different test (a regex on the pathname, a
// `?section=`) therefore announced several current pages while it drew one. NavLink
// takes the answer from the nav and applies it once, to the attribute assistive
// technology reads and the one the row is styled from.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { NavLink } from './nav-link'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'

/** A link rendered while the router is at `url`. */
function renderAt(url: string, link: Readonly<Record<string, unknown>>): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(NavLink as never, link, 'Overview'),
    }),
  )
}

const OVERVIEW = {
  to: '/properties/$propertyId',
  params: { propertyId: PROPERTY_ID },
}

describe('NavLink', () => {
  it('is the current page when the nav says so', () => {
    const html = renderAt(`/properties/${PROPERTY_ID}`, { ...OVERVIEW, current: true })

    expect(html).toContain('aria-current="page"')
  })

  it('is not current when the nav says it is not, even at its own address', () => {
    const html = renderAt(`/properties/${PROPERTY_ID}`, { ...OVERVIEW, current: false })

    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('data-status')
  })

  it('does not announce itself as current on a page below its path', () => {
    // The router matches by prefix: the Dashboard link is "active" on every
    // /properties/$id/* page, and only the row the nav drew is the current one.
    const html = renderAt(`/properties/${PROPERTY_ID}/ratings`, {
      ...OVERVIEW,
      current: false,
    })

    expect(html).not.toContain('aria-current')
  })

  it('carries no router status or class of its own, so the style cannot follow the router', () => {
    for (const current of [true, false]) {
      const html = renderAt(`/properties/${PROPERTY_ID}`, { ...OVERVIEW, current })

      expect(html).not.toContain('data-status')
      expect(html).not.toContain('class="active"')
      expect(html).not.toMatch(/\bactive\b/u)
    }
  })

  it('is a plain anchor to the target, with the props it was given', () => {
    const html = renderAt('/', {
      ...OVERVIEW,
      current: false,
      className: 'row',
      'data-slot': 'section-nav-link',
    })

    expect(html).toContain(`href="/properties/${PROPERTY_ID}"`)
    expect(html).toContain('class="row"')
    expect(html).toContain('data-slot="section-nav-link"')
    expect(html).toContain('>Overview</a>')
  })
})
