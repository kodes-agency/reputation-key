import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { RANGE_CONTROL_LABEL } from '#/components/ui/range-control'
import { PropertyGuestVoicePage } from './property-guest-voice-page'
import { HAMPTON_READ } from './guest-voice-fixtures-check-in'

// The AI-off state offers the account admin's button, which asks who may manage AI.
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))

// Unavailable analysis offers no window to choose.
const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

function renderPage(state: 'disabled' | 'preparing') {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(PropertyGuestVoicePage, {
        propertyId: PROPERTY_ID,
        propertyName: 'Hotel',
        range: 'auto',
        onRangeChange: () => undefined,
        state,
      }),
    }),
  )
}

describe('PropertyGuestVoicePage without a page to draw', () => {
  it('says AI analysis is off, with no window to choose', () => {
    const markup = renderPage('disabled')

    expect(markup).toContain('AI analysis is off for this property')
    expect(markup).not.toContain(RANGE_CONTROL_LABEL)
  })

  it('says the analysis is being prepared, with no window to choose', () => {
    const markup = renderPage('preparing')

    expect(markup).toContain('Guest voice is being prepared')
    expect(markup).not.toContain(RANGE_CONTROL_LABEL)
  })
})

it('renders the actual shared range inside PageHeader actions and the resolved caption', () => {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const html = renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(PropertyGuestVoicePage, {
        propertyId: PROPERTY_ID,
        propertyName: 'Hotel',
        range: 'auto',
        onRangeChange: () => undefined,
        v2: { read: HAMPTON_READ },
      }),
    }),
  )
  const actions = /data-slot="page-header-actions"[^>]*>([\s\S]*?)<\/div><\/div>/u.exec(
    html,
  )?.[1]
  expect(actions).toContain('Time range')
  expect(actions).toContain('Last 12 months')
  expect(actions).toContain('132 reviews')
  expect(html).not.toContain('page-header-meta')
})
