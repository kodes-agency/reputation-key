// A refusal is drawn where the page it replaces stood: that page's width tier and
// trail, with the notice's own title as the last crumb.
import { describe, expect, it } from 'vitest'
import type { PageIdentity } from './page-identity'
import { pageTier, refusalFrame } from './refusal-frame'

const page = (identity: PageIdentity) => ({ page: identity })

/** A route chain as `useMatches()` lists it, root first. */
const chain = (...entries: ReadonlyArray<readonly [string, PageIdentity?]>) =>
  entries.map(([routeId, identity]) => ({
    routeId,
    staticData: identity ? page(identity) : {},
  }))

describe('refusalFrame', () => {
  const where = { propertyId: 'p1', propertyName: 'Hotel Elegance' } as const
  const people = { title: 'People', tier: 'dashboard', under: 'property' } as const

  it('keeps the width tier and the trail of the page that was refused', () => {
    const matches = chain(['__root__'], ['/_authenticated'], ['/people', people])

    expect(refusalFrame(matches, 'People', where)).toEqual({
      tier: 'dashboard',
      breadcrumbs: [
        { label: 'Properties', to: '/properties' },
        { label: 'Hotel Elegance', to: '/properties/p1' },
        { label: 'People' },
      ],
    })
  })

  it('ends the trail on the notice’s own title, which is what the page header says', () => {
    const matches = chain(
      ['__root__'],
      ['/settings', { title: 'Property settings', crumb: 'Settings', under: 'property' }],
      ['/settings/ai'],
    )

    expect(refusalFrame(matches, 'AI settings', where).breadcrumbs?.at(-1)).toEqual({
      label: 'AI settings',
    })
  })

  it('keeps the shorter crumb a page gives itself when the notice names the same page', () => {
    const matches = chain(
      ['__root__'],
      [
        '/google',
        { title: 'Google Business Profile', crumb: 'Google', under: 'property' },
      ],
    )

    expect(
      refusalFrame(matches, 'Google Business Profile', where).breadcrumbs?.at(-1),
    ).toEqual({ label: 'Google' })
  })

  it('keeps a refused settings page narrow', () => {
    const matches = chain(
      ['__root__'],
      ['/members', { title: 'Members', under: 'settings' }],
    )

    expect(refusalFrame(matches, 'Members', {}).tier).toBe('narrow')
  })

  it('has no frame to borrow when no route in the chain is a page', () => {
    expect(
      refusalFrame(chain(['__root__'], ['/_authenticated']), 'People', where),
    ).toEqual({})
  })
})

describe('pageTier', () => {
  it('is the tier the page names', () => {
    expect(pageTier({ title: 'Properties', tier: 'dashboard' })).toBe('dashboard')
  })

  it('is narrow for a page under the settings layout, which wraps it in a narrow shell', () => {
    expect(pageTier({ title: 'Members', under: 'settings' })).toBe('narrow')
  })

  it('leaves the standard width to a page that names none', () => {
    expect(pageTier({ title: 'Reviews', fullBleed: true })).toBeUndefined()
  })
})
