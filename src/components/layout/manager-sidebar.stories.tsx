// Storybook stories for ManagerSidebar — the PropertyManager+ app chrome.
// ManagerSidebar does not check the role itself (the authenticated route picks
// it for PropertyManager+ via hasRole), but it is stateful: usePropertyId()
// resolves the active property from the URL (a /properties/$id segment OR a
// ?propertyId= search param) and useActiveSection() highlights the matching
// nav entry. With no property selected, the property-scoped entries render
// disabled, Reviews opens the organization-wide Inbox, and the switcher shows
// the "Select property" prompt.
//
// To exercise the property-selected state we park the memory router on
// /?propertyId=<id> — usePropertyId's search-param fallback resolves it, so the
// index route still mounts the story (no splat route needed).
//
// getNewCount is a prop (Phase-1 fn-as-prop channel) consumed by InboxNewBadge
// via useAction(useServerFn(...)). useServerFn just invokes the fn directly, so
// a plain callable cast to the fn brand resolves without RPC — the same
// double-cast every inbox story uses. No value import from #/contexts/*/server/**.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Role } from '#/shared/domain/roles'
import { SidebarProvider, useSidebar } from '#/components/ui/sidebar'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { ManagerSidebar } from './manager-sidebar'

const organizationName = 'Avela Hospitality'

const acmeHotelId = '10000000-0000-4000-8000-000000000001'

const properties = [
  {
    id: acmeHotelId,
    name: 'Acme Hotel',
    slug: 'acme-hotel',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Globex HQ',
    slug: 'globex-hq',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Initech Offices',
    slug: 'initech-offices',
  },
]

// InboxNewBadge calls useAction(useServerFn(getNewCount)); a plain callable cast
// to the server-fn brand resolves identically to the inbox page story.
const lastVisitCountWithBadge = (async () => 5) as unknown as typeof getLastVisitCountFn
const lastVisitCountZero = (async () => 0) as unknown as typeof getLastVisitCountFn

const meta: Meta<typeof ManagerSidebar> = {
  title: 'Layout/ManagerSidebar',
  component: ManagerSidebar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story, context) => (
      <SidebarProvider
        defaultOpen={context.parameters.sidebarDefaultOpen !== false}
        style={{ minHeight: '100vh' }}
      >
        <Story />
      </SidebarProvider>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof ManagerSidebar>

// withRole, but the memory router boots on a custom URL — lets usePropertyId()
// resolve a property via the ?propertyId= search param while the index route
// still mounts the story. Identical structure to withRole (only initialEntries
// differs), so it composes with the global RouterDecorator the same way.
function withRoleAt(role: Role, initialUrl: string) {
  return function AuthedRouterAt(Story: () => ReactNode) {
    const storyRef = useRef(Story)
    storyRef.current = Story
    const [router] = useState(() => {
      const root = createRootRouteWithContext<{ role: Role }>()({
        component: Outlet,
      })
      const authed = createRoute({
        getParentRoute: () => root,
        id: '/_authenticated',
        component: Outlet,
      })
      function StorySurface() {
        const location = useRouterState({
          select: (state) => `${state.location.pathname}${state.location.searchStr}`,
        })
        return (
          <>
            <output data-testid="story-location" className="sr-only">
              {location}
            </output>
            {storyRef.current()}
          </>
        )
      }
      const index = createRoute({
        getParentRoute: () => authed,
        path: '/',
        component: StorySurface,
      })
      const inbox = createRoute({
        getParentRoute: () => authed,
        path: '/inbox',
        component: StorySurface,
      })
      const reviews = createRoute({
        getParentRoute: () => authed,
        path: '/properties/$propertyId/reviews',
        component: StorySurface,
      })
      const portals = createRoute({
        getParentRoute: () => authed,
        path: '/portals',
        component: StorySurface,
      })
      const propertyList = createRoute({
        getParentRoute: () => authed,
        path: '/properties',
        component: StorySurface,
      })
      const propertyPortals = createRoute({
        getParentRoute: () => authed,
        path: '/properties/$propertyId/portals',
        component: StorySurface,
      })
      const propertyPeople = createRoute({
        getParentRoute: () => authed,
        path: '/properties/$propertyId/people',
        component: StorySurface,
      })
      const tree = root.addChildren([
        authed.addChildren([
          index,
          inbox,
          reviews,
          portals,
          propertyList,
          propertyPortals,
          propertyPeople,
        ]),
      ])
      return createRouter({
        routeTree: tree,
        history: createMemoryHistory({ initialEntries: [initialUrl] }),
        context: { role },
      })
    })
    return <RouterProvider router={router} />
  }
}

// A property is selected (?propertyId=) → switcher shows it, nav enabled, and
// the new-count badge (mocked to 5) mounts on the Reviews entry.
export const AsPropertyManager: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountWithBadge },
  decorators: [withRoleAt('PropertyManager', `/?propertyId=${properties[0].id}`)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Property switcher shows the active property.
    expect(await canvas.findByText(/acme hotel/i)).toBeInTheDocument()
    // Nav entries render enabled (propertyId is set). Use findBy to tolerate async render.
    expect(await canvas.findByText(/^dashboard$/i)).toBeInTheDocument()
    expect(await canvas.findByText(/^reviews$/i)).toBeInTheDocument()
    expect(await canvas.findByText(/^people$/i)).toBeInTheDocument()
    expect(await canvas.findByText(/^portals$/i)).toBeInTheDocument()
    expect(await canvas.findByText(/^goals$/i)).toBeInTheDocument()
    expect(canvas.queryByText(/^leaderboard$/i)).toBeNull()
    // New-count badge resolves from the mock (async) → "5".
    expect(await canvas.findByText(/^5$/)).toBeInTheDocument()
  },
}

// AccountAdmin also sees this sidebar (route renders it for PropertyManager+).
// Identical chrome — documents the role reaches the same nav.
export const AsAccountAdmin: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('AccountAdmin', `/?propertyId=${properties[0].id}`)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/acme hotel/i)).toBeInTheDocument()
    expect(await canvas.findByText(/^dashboard$/i)).toBeInTheDocument()
  },
}

/** No property in the URL: the switcher prompts for one and Dashboard is inert. */
async function expectNoPropertyChrome(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  expect(await canvas.findByText(/^select property$/i)).toBeInTheDocument()
  expect(await canvas.findByText(/^dashboard$/i)).toBeInTheDocument()
  return canvas
}

// Landed without a property in the URL (e.g. on /properties index) → switcher
// shows "Select property", the property-scoped entries are disabled, and
// Reviews opens the Inbox at the only scope there is: All properties.
export const NoPropertySelected: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', '/')],
  play: async ({ canvasElement }) => {
    const canvas = await expectNoPropertyChrome(canvasElement)
    const reviews = await canvas.findByRole('link', { name: /^reviews$/i })
    expect(reviews).toHaveAttribute('href', '/inbox')
    expect(canvas.queryByRole('link', { name: /^people$/i })).toBeNull()
    // Portals opens All properties, the Organization's Portals grouped by Property.
    expect(await canvas.findByRole('link', { name: /^portals$/i })).toHaveAttribute(
      'href',
      '/portals',
    )
  },
}

// The All properties page has no property id by design. Portals is the active
// entry and links to itself; the entries that need one stay disabled. The tile
// names the Organization with "All properties" under it (board 10).
export const PortalsAllProperties: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', '/portals')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^dashboard$/i)).toBeInTheDocument()
    expect(
      await canvas.findByRole('button', {
        name: 'Avela Hospitality, all properties. Switch to a property',
      }),
    ).toBeInTheDocument()
    expect(canvas.getByText('Avela Hospitality')).toBeInTheDocument()
    expect(canvas.getByText('All properties')).toBeInTheDocument()
    expect(canvas.queryByText(/^select property$/i)).toBeNull()
    const portals = await canvas.findByRole('link', { name: /^portals$/i })
    expect(portals).toHaveAttribute('data-active', 'true')
    expect(portals).toHaveAttribute('href', '/portals')
    expect(await canvas.findByRole('link', { name: /^reviews$/i })).not.toHaveAttribute(
      'data-active',
      'true',
    )
    expect(canvas.queryByRole('link', { name: /^people$/i })).toBeNull()
    expect(canvas.queryByRole('link', { name: /^goals$/i })).toBeNull()

    // The scope in view is marked, and the property list stays one click away.
    await userEvent.click(canvas.getByRole('button', { name: /all properties/i }))
    const page = within(canvasElement.ownerDocument.body)
    const all = await page.findByRole('menuitem', { name: /^all properties/i })
    expect(all).toHaveTextContent('Active')
    expect(page.getByRole('menuitem', { name: /view all properties/i })).toBeVisible()
  },
}

// Reaching All properties from inside a property: the Portals section opens the
// Portals of the whole Organization. Before this the page was reachable only
// when no property was in scope.
export const PortalsReachAllProperties: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', `/properties/${acmeHotelId}/portals`)],
  play: async ({ canvasElement }) => {
    const { canvas } = await chooseFromTile(
      canvasElement,
      /acme hotel/i,
      /^all properties/i,
    )

    await waitFor(() =>
      expect(canvas.getByTestId('story-location')).toHaveTextContent(/^\/portals$/),
    )
    expect(
      await canvas.findByRole('button', {
        name: 'Avela Hospitality, all properties. Switch to a property',
      }),
    ).toBeInTheDocument()
  },
}

// A section with no view over the whole Organization falls back to the one place
// "all my properties" lives, the property list. The tile there still names the
// Organization, and the menu does not offer the same destination twice.
export const DashboardReachAllProperties: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', `/properties/${acmeHotelId}/people`)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /acme hotel/i }))
    const page = within(canvasElement.ownerDocument.body)
    expect(page.queryByRole('menuitem', { name: /view all properties/i })).toBeNull()
    await userEvent.click(await page.findByRole('menuitem', { name: /^all properties/i }))

    await waitFor(() =>
      expect(canvas.getByTestId('story-location')).toHaveTextContent(/^\/properties$/),
    )
    expect(
      await canvas.findByRole('button', {
        name: 'Avela Hospitality, all properties. Switch to a property',
      }),
    ).toBeInTheDocument()
  },
}

// No properties at all (new account) → switcher prompt + fully disabled nav.
export const EmptyProperties: Story = {
  args: { properties: [], organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRole('PropertyManager')],
  play: ({ canvasElement }) =>
    expectNoPropertyChrome(canvasElement).then(() => undefined),
}

// The organization-wide inbox has no property id by design. The app tile names
// the Organization with "All properties", and Reviews stays the active entry.
export const InboxAllProperties: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', '/inbox')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reviews = await canvas.findByRole('link', { name: /^reviews$/i })
    expect(reviews).toHaveAttribute('data-active', 'true')

    await userEvent.click(
      await canvas.findByRole('button', {
        name: 'Avela Hospitality, all properties. Switch to a property',
      }),
    )
    const page = within(canvasElement.ownerDocument.body)
    expect(await page.findByRole('menuitem', { name: /globex hq/i })).toBeInTheDocument()
    expect(
      await page.findByRole('menuitem', { name: /^all properties/i }),
    ).toHaveTextContent('Active')
  },
}

// All properties from inside a property's Inbox goes to the organization-wide
// Inbox through the same hook as the rail: queue and filters stay, the opened
// item does not.
export const InboxReachAllProperties: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [
    withRoleAt(
      'PropertyManager',
      `/properties/${acmeHotelId}/reviews?queue=closed&itemId=20000000-0000-4000-8000-000000000001`,
    ),
  ],
  play: async ({ canvasElement }) => {
    const { canvas } = await chooseFromTile(
      canvasElement,
      /acme hotel/i,
      /^all properties/i,
    )

    await waitFor(() =>
      expect(canvas.getByTestId('story-location')).toHaveTextContent(
        '/inbox?queue=closed',
      ),
    )
    expect(canvas.getByTestId('story-location')).not.toHaveTextContent('itemId=')
  },
}

// Icon mode keeps the property identity visible without exposing Dashboard's
// sub-list until the user asks for it.
export const Collapsed: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', `/?propertyId=${properties[0].id}`)],
  parameters: { sidebarDefaultOpen: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^ah$/i)).toBeInTheDocument()
    expect(await canvas.findByRole('button', { name: /^dashboard$/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}

// Dashboard's hidden sub-list becomes a stable menu beside the collapsed rail.
export const CollapsedDashboardMenuOpen: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', `/?propertyId=${properties[0].id}`)],
  parameters: { sidebarDefaultOpen: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^dashboard$/i }))
    const page = within(canvasElement.ownerDocument.body)
    for (const label of ['Overview', 'Ratings', 'Google', 'Guest voice']) {
      expect(await page.findByRole('menuitem', { name: label })).toBeInTheDocument()
    }
    expect(page.getByRole('menuitem', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
}

/** Opens the app tile (named by the property in view) and chooses a property. */
async function chooseFromTile(
  canvasElement: HTMLElement,
  tile: RegExp,
  property: RegExp,
) {
  const canvas = within(canvasElement)
  await userEvent.click(await canvas.findByRole('button', { name: tile }))
  const page = within(canvasElement.ownerDocument.body)
  await userEvent.click(await page.findByRole('menuitem', { name: property }))
  return { canvas, page }
}

// Changing scope inside the inbox stays in the same work surface. It keeps the
// queue/filter state, but an item opened under the old scope cannot survive.
export const InboxPropertySwitch: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [
    withRoleAt(
      'PropertyManager',
      `/inbox?queue=closed&itemId=20000000-0000-4000-8000-000000000001&propertyId=${properties[0].id}`,
    ),
  ],
  play: async ({ canvasElement }) => {
    const { canvas } = await chooseFromTile(canvasElement, /acme hotel/i, /globex hq/i)

    await waitFor(() =>
      expect(canvas.getByTestId('story-location')).toHaveTextContent(
        `/properties/${properties[1].id}/reviews?queue=closed`,
      ),
    )
    expect(canvas.getByTestId('story-location')).not.toHaveTextContent('itemId=')
    expect(canvas.getByTestId('story-location')).not.toHaveTextContent('propertyId=')
  },
}

// Choosing the property already in view changes no scope, so it keeps the open
// item and the URL exactly as they are — the same rule the queue rail and the
// compact scope menu follow, because all three go through one navigation hook.
export const InboxActivePropertyKeepsTheOpenItem: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [
    withRoleAt(
      'PropertyManager',
      `/properties/${properties[0].id}/reviews?queue=closed&itemId=20000000-0000-4000-8000-000000000001`,
    ),
  ],
  play: async ({ canvasElement }) => {
    const location = within(canvasElement).getByTestId('story-location')
    const before = location.textContent

    const { page } = await chooseFromTile(canvasElement, /acme hotel/i, /^acme hotel/i)
    await waitFor(() => expect(page.queryByRole('menu')).toBeNull())
    // A navigation would have committed by the next task.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(location.textContent).toBe(before)
    expect(location).toHaveTextContent('itemId=')
  },
}

// The router matches a link by prefix, so every link above the open page used to
// announce itself as the current one while one row was drawn active. One row is
// the current page, and it is the one that is drawn.
export const OneCurrentPage: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', `/properties/${acmeHotelId}/reviews`)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reviews = await canvas.findByRole('link', { name: /^reviews$/i })
    const nav = canvas.getByRole('navigation', { name: 'Primary navigation' })
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(current).toEqual([reviews])
    expect(reviews).toHaveAttribute('data-active', 'true')
    expect(
      within(nav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('data-active') === 'true'),
    ).toEqual([reviews])
  },
}

/** Opens the phone drawer, which is closed until a person asks for it. */
function OpenDrawer() {
  const { setOpenMobile } = useSidebar()
  useEffect(() => setOpenMobile(true), [setOpenMobile])
  return null
}

// On a phone the sidebar is a sheet over the page. Choosing a link changes the
// page behind it, so the sheet leaves with the click instead of hiding the page
// the person just chose.
export const MobileDrawerClosesOnNavigation: Story = {
  args: { properties, organizationName, getLastVisitCount: lastVisitCountZero },
  decorators: [
    (Story) => (
      <>
        <OpenDrawer />
        <Story />
      </>
    ),
    withRoleAt('PropertyManager', `/?propertyId=${acmeHotelId}`),
  ],
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const drawer = await page.findByRole('dialog')

    await userEvent.click(within(drawer).getByRole('link', { name: /^reviews$/i }))

    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    await waitFor(() =>
      expect(page.getByTestId('story-location')).toHaveTextContent(/reviews$/),
    )
  },
}
