// What the loading state draws while a page loads: a header with the title and the
// lines under it, then a body of the page's own shape. Rendered on the server, as
// the first paint of a slow page is, so what is asserted is the markup a person
// would see before any script runs.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { LoadingShape } from './page-identity'
import { PageState, type PageStateProps } from './page-state'

function render(props: PageStateProps): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(PageState, props),
    }),
  )
}

const skeletons = (html: string) => html.match(/data-slot="skeleton"/gu)?.length ?? 0
const h1s = (html: string) => html.match(/<h1\b/gu)?.length ?? 0

const SHAPES: readonly LoadingShape[] = [
  'scorecard',
  'list',
  'cards',
  'split',
  'workspace',
  'inbox',
]

describe('a loading state', () => {
  it.each(SHAPES)('draws the %s shape as a busy region with its label', (shape) => {
    const html = render({ kind: 'loading', title: 'People', shape })
    expect(html).toContain(`data-loading-shape="${shape}"`)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Loading People')
    expect(skeletons(html)).toBeGreaterThan(2)
    expect(h1s(html)).toBe(1)
  })

  it('holds the place of the one line the loaded header draws under its title', () => {
    const none = render({
      kind: 'loading',
      title: 'People',
      headerLines: 0,
      shape: 'list',
    })
    const one = render({
      kind: 'loading',
      title: 'People',
      headerLines: 1,
      shape: 'list',
    })
    const two = render({
      kind: 'loading',
      title: 'People',
      headerLines: 2,
      shape: 'list',
    })
    expect(skeletons(one) - skeletons(none)).toBe(1)
    expect(skeletons(two) - skeletons(none)).toBe(2)
  })

  it('draws one line when the page does not say how many', () => {
    const left = render({ kind: 'loading', title: 'People', shape: 'list' })
    const one = render({
      kind: 'loading',
      title: 'People',
      headerLines: 1,
      shape: 'list',
    })
    expect(skeletons(left)).toBe(skeletons(one))
  })

  it('takes its shape from the frame when the page names none', () => {
    expect(render({ kind: 'loading', title: 'Ratings', tier: 'dashboard' })).toContain(
      'data-loading-shape="scorecard"',
    )
    expect(render({ kind: 'loading', title: 'Profile', tier: 'narrow' })).toContain(
      'data-loading-shape="cards"',
    )
    expect(render({ kind: 'loading', title: 'Portal', fullBleed: true })).toContain(
      'data-loading-shape="workspace"',
    )
    expect(render({ kind: 'loading' })).toContain('data-loading-shape="cards"')
  })

  it('keeps the page width tier for a body that sits in a page', () => {
    expect(render({ kind: 'loading', title: 'People', tier: 'dashboard' })).toContain(
      'max-w-[1200px]',
    )
    expect(render({ kind: 'loading', title: 'Profile', tier: 'narrow' })).toContain(
      'max-w-3xl',
    )
  })

  it.each(['workspace', 'inbox'] as const)(
    'draws the %s shape as a whole surface: no page shell, no header above it',
    (shape) => {
      const html = render({ kind: 'loading', title: 'Portal', shape, fullBleed: true })
      expect(html).not.toContain('md:space-y-8')
      expect(html).not.toContain('h-full overflow-y-auto')
      expect(html.indexOf('data-loading-shape')).toBeLessThan(html.indexOf('<h1'))
    },
  )

  it('lays the workspace out on its container, with the thresholds of the editor', () => {
    const html = render({ kind: 'loading', title: 'Portal', shape: 'workspace' })
    expect(html).toContain('@container')
    expect(html).toContain('@4xl:w-[26rem]')
    expect(html).toContain('@6xl:w-[30rem]')
    expect(html).toContain('@7xl:w-72')
  })

  it('lays the Inbox out on its container, the queue rail from 64rem', () => {
    const html = render({ kind: 'loading', title: 'Inbox', shape: 'inbox' })
    expect(html).toContain('@container')
    expect(html).toContain('@5xl:flex')
    expect(html).toContain('h-[78px]')
  })
})

describe('the other states', () => {
  it('keep the page frame and draw no placeholder', () => {
    const html = render({
      kind: 'error',
      title: 'People',
      tier: 'dashboard',
      message: 'Something went wrong.',
    })
    expect(skeletons(html)).toBe(0)
    expect(html).toContain('max-w-[1200px]')
  })
})
