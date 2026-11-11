// The screen decides, from what the Portal workspace loaded, whether the page is
// live and whether its scans are counted. The tab it draws is correct on its own
// (it has stories), so a prop forgotten here fails no other test: Results went
// without whether the page is live. The tab is recorded here rather than rendered.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PortalResultsScreen } from './portal-results-screen'

type Props = Parameters<typeof PortalResultsScreen>[0]

const { results } = vi.hoisted(() => ({
  results: [] as Readonly<Record<string, unknown>>[],
}))

vi.mock('./portal-analytics-tab', () => ({
  PortalAnalyticsTab: (props: Readonly<Record<string, unknown>>) => {
    results.push(props)
    return null
  },
}))

const TOKEN: Props['tokenStatus'] = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 1,
  issuedAt: '2026-03-12T09:30:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: true,
  madeBy: null,
}

function render(
  publicationState: Props['portal']['publicationState'],
  tokenStatus: Props['tokenStatus'] = TOKEN,
): void {
  renderToStaticMarkup(
    createElement(PortalResultsScreen, {
      portal: { id: 'portal-1', publicationState, skipPrivateRating: false },
      propertyId: 'property-1',
      tokenStatus,
      getPortalAnalytics: vi.fn() as unknown as Props['getPortalAnalytics'],
    }),
  )
}

beforeEach(() => {
  results.length = 0
})

describe('the Results tab', () => {
  it.each(['draft', 'disabled', 'archived'] as const)(
    'knows the portal is not live when it is %s, so its results say to publish',
    (state) => {
      render(state)

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ pageIsLive: false })
    },
  )

  it('knows a published portal is live', () => {
    render('published')

    expect(results[0]).toMatchObject({ pageIsLive: true })
  })

  it('counts scans for a live portal whose code counts them', () => {
    render('published')

    expect(results[0]).toMatchObject({ scansCounted: true })
  })

  it('says its scans are not counted when the live code predates scan counting, as the overview does', () => {
    render('published', { ...TOKEN, qualifiedScanReady: false })

    expect(results[0]).toMatchObject({ scansCounted: false })
  })

  it('has no uncounted scans to explain on a portal that is not live', () => {
    render('draft', { ...TOKEN, qualifiedScanReady: false })

    expect(results[0]).toMatchObject({ scansCounted: true })
  })
})
