// Storybook stories for ManagerSidebar — the PropertyManager+ app chrome.
// ManagerSidebar does not check the role itself (the authenticated route picks
// it for PropertyManager+ via hasRole), but it is stateful: usePropertyId()
// resolves the active property from the URL (a /properties/$id segment OR a
// ?propertyId= search param) and useActiveSection() highlights the matching
// nav entry. With no property selected, every nav entry renders disabled and
// the switcher shows the "Select property" prompt.
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
import { expect, within } from 'storybook/test'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { useRef, useState, type ReactNode } from 'react'
import type { Role } from '#/shared/domain/roles'
import { SidebarProvider } from '#/components/ui/sidebar'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { ManagerSidebar } from './manager-sidebar'

const properties = [
  { id: 'prop-acme', name: 'Acme Hotel', slug: 'acme-hotel' },
  { id: 'prop-globex', name: 'Globex HQ', slug: 'globex-hq' },
  { id: 'prop-initech', name: 'Initech Offices', slug: 'initech-offices' },
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
    (Story) => (
      <SidebarProvider style={{ minHeight: '100vh' }}>
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
      const index = createRoute({
        getParentRoute: () => authed,
        path: '/',
        component: () => <>{storyRef.current()}</>,
      })
      const tree = root.addChildren([authed.addChildren([index])])
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
  decorators: [withRoleAt('PropertyManager', '/?propertyId=prop-acme')],
  parameters: { a11y: { disable: true } },
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
    // New-count badge resolves from the mock (async) → "5".
    expect(await canvas.findByText(/^5$/)).toBeInTheDocument()
  },
}

// AccountAdmin also sees this sidebar (route renders it for PropertyManager+).
// Identical chrome — documents the role reaches the same nav.
export const AsAccountAdmin: Story = {
  args: { properties, getLastVisitCount: lastVisitCountZero },
  decorators: [withRoleAt('AccountAdmin', '/?propertyId=prop-acme')],
  parameters: { a11y: { disable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/acme hotel/i)).toBeInTheDocument()
    expect(await canvas.findByText(/^dashboard$/i)).toBeInTheDocument()
  },
}

// Landed without a property in the URL (e.g. on /properties index) → switcher
// shows "Select property" and every nav entry is disabled.
export const NoPropertySelected: Story = {
  args: { properties, getLastVisitCount: lastVisitCountZero },
  decorators: [withRole('PropertyManager')],
  parameters: { a11y: { disable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/select property/i)).toBeInTheDocument()
    expect(await canvas.findByText(/^dashboard$/i)).toBeInTheDocument()
  },
}

// No properties at all (new account) → switcher prompt + fully disabled nav.
export const EmptyProperties: Story = {
  args: { properties: [], getLastVisitCount: lastVisitCountZero },
  decorators: [withRole('PropertyManager')],
  parameters: { a11y: { disable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/select property/i)).toBeInTheDocument()
    expect(await canvas.findByText(/^dashboard$/i)).toBeInTheDocument()
  },
}
