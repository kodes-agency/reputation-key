// A page is named once, on its route: the title its fallbacks print, the
// breadcrumbs above it, the tier it sits in and the tab title. These rules decide
// which route's name a fallback prints (a layout that draws no header borrows its
// page's; a page below a layout that does draw one prints no second header) and
// what the tab says, without a router.
import { describe, expect, it } from 'vitest'
import { NAV_LABEL } from './nav-labels'
import {
  documentTitle,
  fallbackIdentity,
  pageHead,
  resolveCrumbs,
  trailCrumbs,
  type PageIdentity,
} from './page-identity'

const page = (identity: PageIdentity) => ({ page: identity })

/** A route chain as `useMatches()` lists it, root first. */
const chain = (...entries: ReadonlyArray<readonly [string, PageIdentity?]>) =>
  entries.map(([routeId, identity]) => ({
    routeId,
    staticData: identity ? page(identity) : {},
  }))

describe('documentTitle', () => {
  it('writes the tab title the way the legal pages do', () => {
    expect(documentTitle('People')).toBe('People | Reputation Key')
  })
})

describe('fallbackIdentity', () => {
  const people = { title: 'People', tier: 'dashboard', under: 'property' } as const

  it('prints the identity of the route that is pending, failed or missing', () => {
    const matches = chain(['__root__'], ['/_authenticated'], ['/people', people])
    expect(fallbackIdentity(matches, '/people')).toEqual(people)
  })

  it('lets a layout with no header of its own borrow the page below it', () => {
    const matches = chain(
      ['__root__'],
      ['/_authenticated'],
      ['/$propertyId'],
      ['/$propertyId/people', people],
    )
    expect(fallbackIdentity(matches, '/$propertyId')).toEqual(people)
  })

  it('draws no second header for a route inside a page that already has one', () => {
    const settings = { title: 'Property settings', under: 'property' } as const
    const matches = chain(['__root__'], ['/settings', settings], ['/settings/profile'])
    expect(fallbackIdentity(matches, '/settings/profile')).toBeNull()
  })

  it('keeps a page its own name even below a layout that has one', () => {
    const workspace = { title: 'Portal', fullBleed: true } as const
    const review = { title: 'Review' } as const
    const matches = chain(['__root__'], ['/$portalId', workspace], ['/review', review])
    expect(fallbackIdentity(matches, '/review')).toEqual(review)
  })

  it('has nothing to print when no route in the chain is a page', () => {
    const matches = chain(['__root__'], ['/_authenticated'])
    expect(fallbackIdentity(matches, '/_authenticated')).toBeNull()
  })

  it('has nothing to print for a route the chain does not list', () => {
    expect(fallbackIdentity(chain(['__root__']), '/elsewhere')).toBeNull()
  })
})

describe('resolveCrumbs', () => {
  const where = { propertyId: 'p1', propertyName: 'Hotel Elegance' } as const

  it('draws no trail for a page that sits at the top of the app', () => {
    expect(resolveCrumbs({ title: 'Notifications' }, {})).toBeUndefined()
  })

  it('puts a page of the Properties area under Properties', () => {
    expect(resolveCrumbs({ title: 'Import', under: 'properties' }, {})).toEqual([
      { label: 'Properties', to: '/properties' },
      { label: 'Import' },
    ])
  })

  it('puts a Property page under Properties and the Property', () => {
    expect(resolveCrumbs({ title: 'People', under: 'property' }, where)).toEqual([
      { label: 'Properties', to: '/properties' },
      { label: 'Hotel Elegance', to: '/properties/p1' },
      { label: 'People' },
    ])
  })

  it('names the Property crumb generically while the Property is not loaded', () => {
    expect(
      resolveCrumbs({ title: 'People', under: 'property' }, { propertyId: 'p1' }),
    ).toEqual([
      { label: 'Properties', to: '/properties' },
      { label: 'Property', to: '/properties/p1' },
      { label: 'People' },
    ])
  })

  it('keeps going through the Portals and Goals lists', () => {
    expect(resolveCrumbs({ title: 'Property look', under: 'portals' }, where)).toEqual([
      { label: 'Properties', to: '/properties' },
      { label: 'Hotel Elegance', to: '/properties/p1' },
      { label: 'Portals', to: '/properties/p1/portals' },
      { label: 'Property look' },
    ])
    expect(resolveCrumbs({ title: 'New Goal', under: 'goals' }, where)).toEqual([
      { label: 'Properties', to: '/properties' },
      { label: 'Hotel Elegance', to: '/properties/p1' },
      { label: 'Goals', to: '/properties/p1/goals' },
      { label: 'New Goal' },
    ])
  })

  it('puts a Property settings page under the settings hub, named as the sidebar names it', () => {
    expect(resolveCrumbs({ title: 'Profile', under: 'propertySettings' }, where)).toEqual(
      [
        { label: 'Properties', to: '/properties' },
        { label: 'Hotel Elegance', to: '/properties/p1' },
        { label: 'Property settings', to: '/properties/p1/settings' },
        { label: 'Profile' },
      ],
    )
  })

  it('puts a Settings page under Settings', () => {
    expect(resolveCrumbs({ title: 'Profile', under: 'settings' }, {})).toEqual([
      { label: 'Settings', to: '/settings/profile' },
      { label: 'Profile' },
    ])
  })

  it('uses the shorter crumb a page gives for itself', () => {
    expect(
      resolveCrumbs(
        { title: 'Google Business Profile', crumb: 'Google', under: 'property' },
        where,
      )?.at(-1),
    ).toEqual({ label: 'Google' })
  })

  it('drops the Property crumb when the route has no Property in its address', () => {
    expect(resolveCrumbs({ title: 'People', under: 'property' }, {})).toEqual([
      { label: 'Properties', to: '/properties' },
      { label: 'People' },
    ])
  })
})

// A loaded page spells its own trail through `trailCrumbs`, so the Property crumb
// links on Overview, Ratings, Google and Guest voice as it does on the pages whose
// trail was always a link (People, Goals, Portals), and a fallback draws what the page does.
describe('trailCrumbs', () => {
  const where = { propertyId: 'p1', propertyName: 'Hotel Elegance' } as const

  it.each(['Overview', 'Ratings', 'Google', 'Guest voice'])(
    'links the Property crumb above %s',
    (current) => {
      expect(trailCrumbs('property', where, current)).toEqual([
        { label: 'Properties', to: '/properties' },
        { label: 'Hotel Elegance', to: '/properties/p1' },
        { label: current },
      ])
    },
  )

  it('links every crumb above the page, so the page is the only one without an address', () => {
    for (const under of [
      'properties',
      'property',
      'portals',
      'goals',
      'settings',
    ] as const) {
      const trail = trailCrumbs(under, where, 'Here')
      expect(trail.slice(0, -1).every((crumb) => crumb.to !== undefined)).toBe(true)
      expect(trail.at(-1)).toEqual({ label: 'Here' })
    }
  })

  it('is the trail a fallback draws for the same page', () => {
    const identity = { title: 'Ratings', under: 'property' } as const
    expect(trailCrumbs('property', where, 'Ratings')).toEqual(
      resolveCrumbs(identity, where),
    )
  })

  it('names the places a trail passes through as the sidebar names them', () => {
    const labels = (under: Parameters<typeof trailCrumbs>[0]) =>
      trailCrumbs(under, where, 'Here')
        .slice(0, -1)
        .map((crumb) => crumb.label)

    expect(labels('properties')).toEqual([NAV_LABEL.properties])
    expect(labels('portals')).toEqual([
      NAV_LABEL.properties,
      'Hotel Elegance',
      NAV_LABEL.portals,
    ])
    expect(labels('goals')).toEqual([
      NAV_LABEL.properties,
      'Hotel Elegance',
      NAV_LABEL.goals,
    ])
    expect(labels('propertySettings')).toEqual([
      NAV_LABEL.properties,
      'Hotel Elegance',
      NAV_LABEL.propertySettings,
    ])
    expect(labels('settings')).toEqual([NAV_LABEL.settings])
  })
})

describe('pageHead', () => {
  it('titles the tab after the page that is open', () => {
    const matches = chain(
      ['__root__'],
      ['/_authenticated'],
      ['/people', { title: 'People' }],
    )
    expect(pageHead(matches)).toEqual({ meta: [{ title: 'People | Reputation Key' }] })
  })

  it('prefers the deepest page, so a page below a layout names itself', () => {
    const matches = chain(
      ['__root__'],
      ['/settings', { title: 'Property settings' }],
      ['/settings/profile', { title: 'Profile' }],
    )
    expect(pageHead(matches).meta?.[0]).toEqual({ title: 'Profile | Reputation Key' })
  })

  it('lets a route with no name of its own take its layout’s', () => {
    const matches = chain(
      ['__root__'],
      ['/settings', { title: 'Property settings' }],
      ['/settings/profile'],
    )
    expect(pageHead(matches).meta?.[0]).toEqual({
      title: 'Property settings | Reputation Key',
    })
  })

  it('leaves the root title alone when no route names the page', () => {
    expect(pageHead(chain(['__root__'], ['/_authenticated']))).toEqual({})
  })
})
