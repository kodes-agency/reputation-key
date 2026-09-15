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
import { useRef, useState, type ReactNode } from 'react'
import type { Role } from '#/shared/domain/roles'
import { SidebarProvider } from '#/components/ui/sidebar'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { ManagerSidebar } from './manager-sidebar'

const properties = [
  {
    id: '10000000-0000-4000-8000-000000000001',
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
      const tree = root.addChildren([authed.addChildren([index, inbox, reviews])])
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
  args: { properties, getLastVisitCount: lastVisitCountWithBadge },
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
  args: { properties, getLastVisitCount: lastVisitCountZero },
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
  args: { properties, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', '/')],
  play: async ({ canvasElement }) => {
    const canvas = await expectNoPropertyChrome(canvasElement)
    const reviews = await canvas.findByRole('link', { name: /^reviews$/i })
    expect(reviews).toHaveAttribute('href', '/inbox')
    expect(canvas.queryByRole('link', { name: /^people$/i })).toBeNull()
  },
}

// No properties at all (new account) → switcher prompt + fully disabled nav.
export const EmptyProperties: Story = {
  args: { properties: [], getLastVisitCount: lastVisitCountZero },
  decorators: [withRole('PropertyManager')],
  play: ({ canvasElement }) =>
    expectNoPropertyChrome(canvasElement).then(() => undefined),
}

// The organization-wide inbox has no property id by design. The app tile is the
// app's property context, the same on every page, so it offers no inbox-only
// "All properties" — the inbox's own rail does. Reviews stays the active entry.
export const InboxAllProperties: Story = {
  args: { properties, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('PropertyManager', '/inbox')],
  play: async ({ canvasElement }) => {
    const canvas = await expectNoPropertyChrome(canvasElement)
    const reviews = await canvas.findByRole('link', { name: /^reviews$/i })
    expect(reviews).toHaveAttribute('data-active', 'true')

    await userEvent.click(canvas.getByRole('button', { name: /select property/i }))
    const page = within(canvasElement.ownerDocument.body)
    expect(await page.findByRole('menuitem', { name: /globex hq/i })).toBeInTheDocument()
    expect(page.queryByRole('menuitem', { name: /^all properties$/i })).toBeNull()
  },
}

// Icon mode keeps the property identity visible without exposing Dashboard's
// sub-list until the user asks for it.
export const Collapsed: Story = {
  args: { properties, getLastVisitCount: lastVisitCountZero },
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
  args: { properties, getLastVisitCount: lastVisitCountZero },
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

// Changing scope inside the inbox stays in the same work surface. It keeps the
// queue/filter state, but an item opened under the old scope cannot survive.
export const InboxPropertySwitch: Story = {
  args: { properties, getLastVisitCount: lastVisitCountZero },
  decorators: [
    withRoleAt(
      'PropertyManager',
      `/inbox?queue=closed&itemId=20000000-0000-4000-8000-000000000001&propertyId=${properties[0].id}`,
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /acme hotel/i }))
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(await page.findByRole('menuitem', { name: /globex hq/i }))

    await waitFor(() =>
      expect(canvas.getByTestId('story-location')).toHaveTextContent(
        `/properties/${properties[1].id}/reviews?queue=closed`,
      ),
    )
    expect(canvas.getByTestId('story-location')).not.toHaveTextContent('itemId=')
    expect(canvas.getByTestId('story-location')).not.toHaveTextContent('propertyId=')
  },
}
