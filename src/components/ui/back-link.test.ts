// BackLink and BackButton (UI consistency scan: ACT-12, FRAME-09, NAV-10).
//
// "Back" was drawn five ways: a muted text link above the breadcrumbs, a ghost
// Button with an arrow in the Portal workspace header, an icon-only button in the
// Inbox, an outline Button with no arrow in three footers and a route error, and a
// link-variant Button. One ghost, small Button with the one arrow is the way back
// where the page has no breadcrumbs (a full-bleed workspace) or a step goes back to
// the one before. A link goes to an address (`BackLink`), a button changes what the
// page shows (`BackButton`); both look the same.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { BackButton, BackLink } from './back-link'

function renderLink(props: Readonly<Record<string, unknown>>, at = '/'): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [at] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(BackLink as never, { to: '/', ...props }),
    }),
  )
}

function renderButton(props: Readonly<Record<string, unknown>>): string {
  return renderToStaticMarkup(
    createElement(BackButton as never, { label: 'Back to questions', ...props }),
  )
}

describe('BackLink', () => {
  it('is an anchor to the address, drawn as a ghost small Button', () => {
    const html = renderLink({ label: 'Back to editing' })

    expect(html).toContain('<a ')
    expect(html).toContain('href="/"')
    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="sm"')
  })

  it('wears the one arrow, which a screen reader skips, before its words', () => {
    const html = renderLink({ label: 'Back to editing' })

    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>/u)
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('Back to editing'))
    expect(html).toContain('>Back to editing<')
  })

  it('keeps its words for a screen reader while a phone shows only the arrow', () => {
    const html = renderLink({ label: 'Portals', iconBelow: 'sm' })

    expect(html).toContain('sr-only sm:not-sr-only')
    expect(html).toContain('max-sm:w-(--control-touch)')
    expect(html).toContain('>Portals<')
  })

  it('shows its words at every width without iconBelow', () => {
    const html = renderLink({ label: 'Back to editing' })

    expect(html).not.toContain('sr-only')
    expect(html).not.toContain('max-sm:w-(--control-touch)')
  })

  it('is flush when asked: the arrow, not the box, sits on the content edge', () => {
    expect(renderLink({ label: 'Portals', flush: true })).toContain('-ml-2')
    expect(renderLink({ label: 'Portals' })).not.toContain('-ml-2')
  })

  it('is never announced as the current page, though the page it leaves is below its address', () => {
    // The router matches by prefix, so a link to the parent is "active" on every
    // page under it; a way back is not where the person is.
    const html = renderLink(
      { to: '/properties/$propertyId', params: { propertyId: 'p1' }, label: 'Back' },
      '/properties/p1/portals',
    )

    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('data-status')
    expect(html).not.toMatch(/\bactive\b/u)
  })
})

describe('BackButton', () => {
  it('is a button that never submits a form, drawn the same as the link', () => {
    const html = renderButton({})

    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="sm"')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>/u)
    expect(html).toContain('>Back to questions<')
  })

  it('can be disabled while the step it leaves is saving', () => {
    expect(renderButton({ disabled: true })).toContain('disabled=""')
  })
})
