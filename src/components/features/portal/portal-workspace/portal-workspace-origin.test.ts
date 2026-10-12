import { describe, expect, it } from 'vitest'
import { workspaceBackTarget } from './portal-workspace-origin'

const PROPERTY = 'prop-1'
const groups = (id: string) => (id === 'g-1' ? 'Pool side' : null)

describe('workspaceBackTarget — where "Back to …" leads', () => {
  it('leads to the property’s Portals list on a first load', () => {
    expect(workspaceBackTarget(undefined, PROPERTY, groups)).toEqual({
      to: '/properties/prop-1/portals',
      label: 'Back to portals',
    })
  })

  it('returns to the property’s Portals list as the manager left it', () => {
    expect(
      workspaceBackTarget(
        { pathname: '/properties/prop-1/portals', search: { q: 'pool' } },
        PROPERTY,
        groups,
      ),
    ).toEqual({
      to: '/properties/prop-1/portals',
      search: { q: 'pool' },
      label: 'Back to portals',
    })
  })

  it('returns to All properties, with its filters, named for what it lists', () => {
    expect(
      workspaceBackTarget(
        { pathname: '/portals', search: { show: 'attention' } },
        PROPERTY,
        groups,
      ),
    ).toEqual({
      to: '/portals',
      search: { show: 'attention' },
      label: 'Back to all portals',
    })
  })

  it('returns to the group page by the group’s name', () => {
    expect(
      workspaceBackTarget(
        { pathname: '/properties/prop-1/portals/groups/g-1' },
        PROPERTY,
        groups,
      ),
    ).toEqual({ to: '/properties/prop-1/portals/groups/g-1', label: 'Back to Pool side' })
  })

  it('falls back when the group is not one of this property’s', () => {
    expect(
      workspaceBackTarget(
        { pathname: '/properties/prop-1/portals/groups/g-9' },
        PROPERTY,
        groups,
      ).label,
    ).toBe('Back to portals')
    expect(
      workspaceBackTarget(
        { pathname: '/properties/prop-2/portals/groups/g-1' },
        PROPERTY,
        groups,
      ).to,
    ).toBe('/properties/prop-1/portals')
  })

  it('falls back from anywhere else, without carrying that page’s search', () => {
    expect(
      workspaceBackTarget(
        { pathname: '/inbox', search: { queue: 'mine' } },
        PROPERTY,
        groups,
      ),
    ).toEqual({ to: '/properties/prop-1/portals', label: 'Back to portals' })
    // The workspace itself (a reload) is not a list to go back to.
    expect(
      workspaceBackTarget(
        { pathname: '/properties/prop-1/portals/p-1', search: { tab: 'share' } },
        PROPERTY,
        groups,
      ),
    ).toEqual({ to: '/properties/prop-1/portals', label: 'Back to portals' })
  })
})
