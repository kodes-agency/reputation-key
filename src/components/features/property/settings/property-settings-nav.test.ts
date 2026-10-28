// The hub's section list (UI consistency scan: NAV-01, NAV-05, NAV-06, FORM-07). It is a
// SectionNav, so these checks pin what is specific to the hub: which items it
// offers, that the Danger zone stays apart wherever the person is, and that the
// list waits for its container, not the window.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { PropertySettingsNav, propertySettingsNavItems } from './property-settings-nav'
import { visiblePropertySettingsSections } from './property-settings-sections'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'
const SECTIONS = visiblePropertySettingsSections(() => true)

// The nav reads the section of the page ON SCREEN, so the router must have
// presented a match for the address: a splat route answers every address.
async function renderAt(section: string): Promise<string> {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: '$' })
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({
      initialEntries: [`/properties/${PROPERTY_ID}/settings/${section}`],
    }),
  })
  await router.load()
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(PropertySettingsNav, {
        propertyId: PROPERTY_ID,
        sections: SECTIONS,
      }),
    }),
  )
}

describe('propertySettingsNavItems', () => {
  const items = propertySettingsNavItems(PROPERTY_ID, SECTIONS)

  it('is one item per visible section, in setup order, with its description', () => {
    expect(items.map((item) => item.key)).toEqual(SECTIONS.map((s) => s.key))
    expect(items.map((item) => item.summary)).toEqual(SECTIONS.map((s) => s.description))
  })

  it('links each section to its own route for this property', () => {
    expect(items.find((item) => item.key === 'ai')).toMatchObject({
      to: '/properties/$propertyId/settings/ai',
      params: { propertyId: PROPERTY_ID },
    })
  })

  it('sets the Danger zone apart in a group of its own', () => {
    const grouped = items.filter((item) => item.group !== undefined)

    expect(grouped.map((item) => item.key)).toEqual(['danger'])
  })
})

describe('PropertySettingsNav', () => {
  it('marks the open section current, from the page on screen', async () => {
    const html = await renderAt('ai')

    expect(html.match(/aria-current="page"/gu)).toHaveLength(1)
    const open = /<a [^>]*aria-current="page"[^>]*>/u.exec(html)?.[0] ?? ''
    expect(open).toContain(`href="/properties/${PROPERTY_ID}/settings/ai"`)
  })

  it('draws the same layout whichever section is open, so no row moves when one is chosen', async () => {
    // The Danger zone used to lose its 16px offset while it was the open section.
    // Layout cannot depend on the open section if the markup differs only by the
    // attribute the styles read.
    const withoutCurrent = (html: string) => html.replace(/ aria-current="page"/gu, '')

    expect(withoutCurrent(await renderAt('danger'))).toBe(
      withoutCurrent(await renderAt('profile')),
    )
  })

  it('becomes a column from a container width, not from a viewport breakpoint', async () => {
    const html = await renderAt('profile')

    expect(html).toContain('@3xl:flex-col')
    expect(html).not.toMatch(/(?:^|[\s"])md:flex-col/u)
    expect(html).not.toContain('md:mt-4')
  })

  it('does not print group headings: the Danger zone is named by its own row', async () => {
    expect(await renderAt('profile')).not.toContain('<p ')
  })
})
