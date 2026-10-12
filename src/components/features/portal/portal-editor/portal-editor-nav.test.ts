// The editor's section list on SectionNav (UI consistency scan: NAV-01, NAV-05, NAV-07,
// FORM-07). The nav is the reference composition, so these checks pin what it
// keeps: the guest-order groups, the live summary under each name, the lock and
// attention marks, and a link per available section to the same route with a
// different `?section=`.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { SectionNavLayout } from '#/components/ui/section-nav-layout'
import { PortalEditorNav, portalEditorNavItems } from './portal-editor-nav'
import {
  PORTAL_EDITOR_SECTIONS,
  type PortalEditorSection,
} from './portal-editor-sections'
import {
  summarizePortalEditorSections,
  type PortalEditorSectionSummary,
} from './portal-editor-summary'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'
const PORTAL_ID = '20000000-0000-4000-8000-000000000201'

const SUMMARIES: Readonly<Record<PortalEditorSection, PortalEditorSectionSummary>> =
  summarizePortalEditorSections({
    portalName: 'Pool & Terrace',
    privateFeedbackThreshold: 3,
    linkCount: 4,
    languageCount: 2,
    missingTextCount: 3,
    groupName: 'Pool side',
    responsibleNames: ['Georgi Petrov', 'Elena Ivanova'],
  })

const ALL: ReadonlyArray<PortalEditorSection> = PORTAL_EDITOR_SECTIONS

function items(available: ReadonlyArray<PortalEditorSection> = ALL) {
  return portalEditorNavItems({
    propertyId: PROPERTY_ID,
    portalId: PORTAL_ID,
    available,
    summaries: SUMMARIES,
  })
}

function render(active: PortalEditorSection, available = ALL): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({
      initialEntries: [`/properties/${PROPERTY_ID}/portals/${PORTAL_ID}?tab=page`],
    }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(SectionNavLayout, {
        frame: 'rail',
        children: createElement(PortalEditorNav, {
          propertyId: PROPERTY_ID,
          portalId: PORTAL_ID,
          active,
          available,
          summaries: SUMMARIES,
        }),
      }),
    }),
  )
}

describe('portalEditorNavItems', () => {
  it('lists the sections in guest order, then what only managers see, in two groups', () => {
    const list = items()

    expect(list.map((item) => item.key)).toEqual([...PORTAL_EDITOR_SECTIONS])
    expect([...new Set(list.map((item) => item.group))]).toEqual([
      'On the page',
      'Behind the page',
    ])
  })

  it('leaves out a section the viewer cannot reach, and a group with none left', () => {
    const list = items(['look', 'welcome'])

    expect(list.map((item) => item.key)).toEqual(['look', 'welcome'])
    expect(new Set(list.map((item) => item.group))).toEqual(new Set(['On the page']))
  })

  it('links each section to the same route with its own ?section=', () => {
    expect(items().find((item) => item.key === 'linktree')).toMatchObject({
      to: '/properties/$propertyId/portals/$portalId',
      params: { propertyId: PROPERTY_ID, portalId: PORTAL_ID },
      search: { tab: 'page', section: 'linktree' },
    })
  })

  it('gives every item an icon and a summary', () => {
    for (const item of items()) {
      expect(item.icon).toBeDefined()
      expect(item.summary).toBeDefined()
    }
  })
})

describe('PortalEditorNav', () => {
  it('is the "Editor sections" landmark', () => {
    expect(render('welcome')).toContain('<nav aria-label="Editor sections"')
  })

  it('marks the open section, and only it, current', () => {
    const html = render('linktree')

    expect(html.match(/aria-current="page"/gu)).toHaveLength(1)
    const open = /<a [^>]*aria-current="page"[^>]*>/u.exec(html)?.[0] ?? ''
    expect(open).toContain('section=linktree')
  })

  it('prints the two group headings and names each list after its heading', () => {
    const html = render('welcome')

    expect(html).toContain('>On the page</p>')
    expect(html).toContain('>Behind the page</p>')
    expect(html.match(/<ul [^>]*aria-labelledby=/gu)).toHaveLength(2)
  })

  it('shows each summary, with its lock and its attention mark', () => {
    const html = render('welcome')

    expect(html).toContain('Photo and colours · property-wide')
    expect(html).toContain('Always included')
    expect(html).toContain('3 missing')
    // The two fixed sections wear a lock, the languages row an attention icon.
    expect(html.match(/lucide-lock/gu)).toHaveLength(2)
    expect(html).toContain('lucide-circle-alert')
  })

  it('keeps the draft note with the list', () => {
    expect(render('welcome')).toContain(
      'Edits stay in this draft until you publish. Printed codes keep working.',
    )
  })

  it('waits for a wide container before it is a column', () => {
    const html = render('welcome')

    expect(html).toContain('@6xl:flex-col')
    expect(html).not.toMatch(/(?:^|[\s"])xl:/u)
  })
})
