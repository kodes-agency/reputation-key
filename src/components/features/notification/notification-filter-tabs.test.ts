import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { NotificationFilterTabs } from './notification-filter-tabs'
import {
  notificationFilterScope,
  parseNotificationFilter,
  type NotificationFilter,
} from './notification-filters'

const PROPERTY = '10000000-0000-4000-8000-000000000101'

function render(url: string, value: NotificationFilter): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(NotificationFilterTabs, { value, children: 'The feed' }),
    }),
  )
}

/** The opening tag of the link named `label`, whatever order its attributes came in. */
function anchorNamed(html: string, label: string): string {
  const match = html.match(new RegExp(`<a [^>]*>${label}</a>`, 'u'))
  if (match === null) throw new Error(`no link named ${label} in ${html}`)
  return match[0]
}

describe('NotificationFilterTabs', () => {
  it('is a named landmark of three links, not a tablist', () => {
    const html = render('/notifications', 'needs_you')

    expect(html).toContain('aria-label="Filter notifications"')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('role="tab"')
    expect(html.match(/<a /g)).toHaveLength(3)
    expect(html).toContain('The feed')
  })

  it('marks only the filter the page is on as the current page', () => {
    const html = render('/notifications?filter=updates', 'updates')

    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(anchorNamed(html, 'Updates')).toContain('aria-current="page"')
    expect(anchorNamed(html, 'Needs you')).not.toContain('aria-current')
    expect(anchorNamed(html, 'All')).not.toContain('aria-current')
  })

  it('links each filter to the route with `?filter=`, and keeps the Property filter', () => {
    const html = render(`/notifications?property=${PROPERTY}&filter=all`, 'all')

    for (const [label, filter] of [
      ['Needs you', 'needs_you'],
      ['Updates', 'updates'],
      ['All', 'all'],
    ] as const) {
      const tag = anchorNamed(html, label)
      expect(tag).toContain(`href="/notifications?`)
      expect(tag).toContain(`filter=${filter}`)
      expect(tag).toContain(`property=${PROPERTY}`)
    }
  })

  // ADR 0046, amended 2026-10-17: "Goals" became two rows. A link written
  // before the split names `recognition`; it opens the page, not an error.
  it('opens a bookmarked goals filter, from before or after the split, on Needs you', () => {
    for (const bookmarked of ['recognition', 'portal_goals']) {
      const filter = parseNotificationFilter(bookmarked)
      expect(filter).toBe('needs_you')

      const html = render(`/notifications?filter=${bookmarked}`, filter)
      expect(anchorNamed(html, 'Needs you')).toContain('aria-current="page"')
    }
  })

  it('names each goal row in a filter-scoped announcement by its own label', () => {
    expect(notificationFilterScope('recognition')).toBe(
      'Google rating goal notifications',
    )
    expect(notificationFilterScope('portal_goals')).toBe('Portal goals notifications')
  })
})
