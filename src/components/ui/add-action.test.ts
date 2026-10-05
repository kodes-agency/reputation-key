// AddAction (UI consistency scan: COLL-21, ACT-14, FRAME-12).
//
// The control that adds a thing to a list (New goal, Invite member, Import from
// Google, New portal, Add staff) spelled its Plus three ways (`<Plus />`,
// `data-icon="inline-start"`, `className="size-4"`), at two heights and in two cases.
// It is one component now: the default Button, the Plus before the label, nothing
// else. Its height is the Button's (36px, 44px on a phone), so no page restyles it.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { AddAction, AddActionLink } from './add-action'

function renderLink(
  props: Readonly<Record<string, unknown>>,
  label = 'New goal',
): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(AddActionLink as never, { to: '/', ...props }, label),
    }),
  )
}

describe('AddAction', () => {
  it('is the default Button with a Plus before its label', () => {
    const html = renderToStaticMarkup(createElement(AddAction, null, 'Invite member'))

    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-variant="default"')
    expect(html).toContain('data-size="default"')
    expect(html.indexOf('lucide-plus')).toBeLessThan(html.indexOf('Invite member'))
    expect(html).toContain('>Invite member<')
  })

  it('draws the Plus for the eye only, and never sizes it itself', () => {
    const html = renderToStaticMarkup(createElement(AddAction, null, 'Add staff'))

    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>/u)
    expect(html).not.toContain('data-icon')
    // The Button sizes an svg child itself; the Plus carries no size or margin class.
    expect(html).not.toMatch(/<svg[^>]*class="[^"]*\b(size-|mr-)/u)
  })

  it('does not submit a form by accident', () => {
    // A Button defaults to a submit button; a page action opens something.
    expect(renderToStaticMarkup(createElement(AddAction, null, 'New group'))).toContain(
      'type="button"',
    )
  })

  it('is a secondary action when a page has a more important one', () => {
    const html = renderToStaticMarkup(
      createElement(AddAction, { variant: 'outline' }, 'New group'),
    )

    expect(html).toContain('data-variant="outline"')
  })

  it('takes a trailing glyph for the one that opens a menu', () => {
    const html = renderToStaticMarkup(
      createElement(
        AddAction,
        null,
        'New portal',
        createElement('i', { 'data-chevron': '' }),
      ),
    )

    expect(html.indexOf('lucide-plus')).toBeLessThan(html.indexOf('New portal'))
    expect(html.indexOf('New portal')).toBeLessThan(html.indexOf('data-chevron'))
  })

  it('can be disabled, with the reason left to the page', () => {
    expect(
      renderToStaticMarkup(createElement(AddAction, { disabled: true }, 'New portal')),
    ).toContain('disabled=""')
  })
})

describe('AddActionLink', () => {
  it('is an anchor to the page that makes the thing, drawn as the same Button', () => {
    const html = renderLink({
      to: '/properties/$propertyId/goals/new',
      params: { propertyId: 'p1' },
    })

    expect(html).toContain('<a ')
    expect(html).toContain('href="/properties/p1/goals/new"')
    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-variant="default"')
    expect(html.indexOf('lucide-plus')).toBeLessThan(html.indexOf('New goal'))
  })

  it('takes the secondary variant too', () => {
    expect(renderLink({ variant: 'outline' })).toContain('data-variant="outline"')
  })
})
