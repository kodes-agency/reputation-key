// The tab panel forwards what the route loaded to the Share and Results tabs.
// Both tabs are correct on their own (they have stories), so a prop the panel
// forgot to pass fails no other test: the Share tab went without its notice, its
// time zone and the managers' names, and Results without whether the page is
// live. The two tabs are recorded here rather than rendered.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalPublicationState } from '../shared/types'
import { PortalDetailTabPanel } from './portal-detail-tab-panel'

type Recorded = Readonly<Record<string, unknown>>

const { shares, results } = vi.hoisted(() => ({
  shares: [] as Recorded[],
  results: [] as Recorded[],
}))

vi.mock('../portal-share/portal-share', () => ({
  PortalShare: (props: Recorded) => {
    shares.push(props)
    return null
  },
}))
vi.mock('../portal-analytics/portal-analytics-tab', () => ({
  PortalAnalyticsTab: (props: Recorded) => {
    results.push(props)
    return null
  },
}))

type Props = Parameters<typeof PortalDetailTabPanel>[0]

const TOKEN = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 1,
  issuedAt: '2026-03-12T09:30:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: true,
  madeBy: null,
}

const MEMBERS = [
  { userId: 'u1', name: 'Ana Petrova', email: 'ana@example.com', role: 'AccountAdmin' },
  { userId: 'u2', name: 'Boris Ivanov', email: 'boris@example.com', role: null },
]

function propsFor(
  tab: 'share' | 'results',
  overrides: Readonly<Record<string, unknown>> = {},
  publicationState: PortalPublicationState = 'draft',
): Props {
  return {
    tab,
    portal: { id: 'portal-1', name: 'Pool', propertyId: 'property-1', publicationState },
    propertyId: 'property-1',
    propertyTimeZone: 'Europe/Sofia',
    tokenStatus: TOKEN,
    responsibleManagers: {
      assignments: [{ userId: 'u1' }],
      eligibleManagers: [
        { userId: 'u1', role: 'AccountAdmin' },
        { userId: 'u2', role: 'PropertyManager' },
      ],
      revision: 1,
      responsibilityNeeded: false,
      responsibilityNeededSince: null,
    },
    responsibleManagerMembers: MEMBERS,
    issuedLink: null,
    linksRevoked: false,
    ...overrides,
  } as unknown as Props
}

function render(props: Props): void {
  renderToStaticMarkup(createElement(PortalDetailTabPanel, props))
}

beforeEach(() => {
  shares.length = 0
  results.length = 0
})

describe('the Share tab', () => {
  it('is told where the portal stands, so a draft gets its notice and its link', () => {
    render(propsFor('share'))

    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({
      portalId: 'portal-1',
      propertyId: 'property-1',
      publicationState: 'draft',
    })
  })

  it('is given the property’s zone, so the old code’s cutoff is in its time', () => {
    render(propsFor('share'))

    expect(shares[0]).toMatchObject({ timeZone: 'Europe/Sofia' })
  })

  it('names the responsible managers for someone who can only look', () => {
    render(propsFor('share'))

    expect(shares[0]?.managerNames).toEqual(['Ana Petrova'])
  })

  it('names the managers who could be made responsible when none is yet', () => {
    const assigned = propsFor('share')
    render({
      ...assigned,
      responsibleManagers: {
        ...assigned.responsibleManagers!,
        assignments: [],
      },
    })

    expect(shares[0]?.managerNames).toEqual(['Ana Petrova', 'Boris Ivanov'])
  })

  it('leaves the names out when the route has not loaded them', () => {
    render(
      propsFor('share', {
        responsibleManagers: undefined,
        responsibleManagerMembers: undefined,
      }),
    )

    expect(shares[0]?.managerNames).toBeUndefined()
  })
})

describe('the Results tab', () => {
  it.each<PortalPublicationState>(['draft', 'disabled', 'archived'])(
    'knows the portal is not live when it is %s, so its results say to publish',
    (state) => {
      render(propsFor('results', {}, state))

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ pageIsLive: false })
    },
  )

  it('knows a published portal is live', () => {
    render(propsFor('results', {}, 'published'))

    expect(results[0]).toMatchObject({ pageIsLive: true })
  })

  it('counts scans for a live portal whose code counts them', () => {
    render(propsFor('results', {}, 'published'))

    expect(results[0]).toMatchObject({ scansCounted: true })
  })

  it('says its scans are not counted when the live code predates scan counting, as the overview does', () => {
    render(
      propsFor(
        'results',
        { tokenStatus: { ...TOKEN, qualifiedScanReady: false } },
        'published',
      ),
    )

    expect(results[0]).toMatchObject({ scansCounted: false })
  })

  it('has no uncounted scans to explain on a portal that is not live', () => {
    render(
      propsFor(
        'results',
        { tokenStatus: { ...TOKEN, qualifiedScanReady: false } },
        'draft',
      ),
    )

    expect(results[0]).toMatchObject({ scansCounted: true })
  })
})
