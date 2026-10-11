import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { GoalNewTabs } from './goal-new-tabs'

const NEW_GOAL = '/properties/p1/goals/new'

function render(props: Omit<Parameters<typeof GoalNewTabs>[0], 'propertyId'>): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [NEW_GOAL] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(GoalNewTabs, { propertyId: 'p1', ...props }),
    }),
  )
}

/** The opening tag of the link whose text is `label`. */
function linkNamed(html: string, label: string): string {
  const tag = html.match(new RegExp(`<a [^>]*>(?=${label}</a>)`, 'u'))?.[0]
  if (tag === undefined) throw new Error(`no link named ${label} in ${html}`)
  return tag
}

describe('GoalNewTabs', () => {
  it('is a named navigation of two views, each with an address', () => {
    const html = render({ view: 'one' })

    expect(html).toMatch(/^<nav /u)
    expect(html).toContain('aria-label="New goal views"')
    expect(html.match(/<a /gu)).toHaveLength(2)
    expect(linkNamed(html, 'One goal')).toContain(`href="${NEW_GOAL}"`)
    expect(linkNamed(html, 'Several portals')).toContain(
      `href="${NEW_GOAL}?mode=several"`,
    )
  })

  it('marks the view that is open as the current page, and only that one', () => {
    const one = render({ view: 'one' })
    const several = render({ view: 'several' })

    expect(linkNamed(one, 'One goal')).toContain('aria-current="page"')
    expect(linkNamed(one, 'Several portals')).not.toContain('aria-current')
    expect(linkNamed(several, 'Several portals')).toContain('aria-current="page"')
    expect(linkNamed(several, 'One goal')).not.toContain('aria-current')
  })

  it('keeps the subject a link chose, so going to the table and back does not lose it', () => {
    const html = render({ view: 'several', subject: 'portal:lobby' })

    expect(linkNamed(html, 'One goal')).toContain(
      `href="${NEW_GOAL}?subject=portal%3Alobby"`,
    )
    expect(linkNamed(html, 'Several portals')).toContain(
      `href="${NEW_GOAL}?subject=portal%3Alobby&amp;mode=several"`,
    )
  })
})
