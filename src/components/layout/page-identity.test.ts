// A page is named once, on its route: the title its fallbacks print, the
// breadcrumbs above it, the tier it sits in and the tab title. These rules decide
// which route's name a fallback prints (a layout that draws no header borrows its
// page's; a page below a layout that does draw one prints no second header) and
// what the tab says, without a router.
import { describe, expect, it } from 'vitest'
import {
  documentTitle,
  fallbackIdentity,
  pageHead,
  resolveCrumbs,
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

  it('puts a Settings page under Settings', () => {
    expect(resolveCrumbs({ title: 'Profile', under: 'settings' }, {})).toEqual([
      { label: 'Settings', to: '/settings' },
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
