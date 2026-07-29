// Fleet overview — cross-property KPI landing. The component is a data-display
// surface (org-wide strip of totals + per-property rows that deep-link into the
// detail page). There is no `loading` prop on `FleetOverview`; loading/empty/
// error are rendered by sibling exports the route shell switches between, so
// they are shown here as separate variants via render functions.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { useState } from 'react'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
} from '@tanstack/react-router'
import {
  FleetOverview,
  FleetOverviewEmpty,
  FleetOverviewError,
  FleetOverviewLoading,
} from './fleet-overview'
import { entries, populatedData } from './fleet-overview-stories-data'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'

const meta: Meta<typeof FleetOverview> = {
  title: 'Dashboard/FleetOverview',
  component: FleetOverview,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-screen w-full bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof FleetOverview>

export const Default: Story = {
  args: { data: populatedData },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Properties')).toBeVisible()
    expect(canvas.getByText('Needs action')).toBeVisible()
    expect(canvas.getByText('Avg rating')).toBeVisible()
    expect(canvas.getByText(String(populatedData.totals.propertyCount))).toBeVisible()
    expect(canvas.getByText('Harborline Suites')).toBeVisible()
    expect(canvas.getByText('All clear')).toBeVisible()
    expect(canvas.getByText('17 needing action')).toBeVisible()
  },
}

// Minimum fleet (2 properties — the org tier that triggers the fleet view).
export const MinimumFleet: Story = {
  args: {
    data: {
      entries: entries.slice(0, 2),
      totals: {
        propertyCount: 2,
        totalAttention: 8 + 17,
        overallAvgRating: (4.2 + 3.4) / 2,
      },
    },
  },
}

// Every property healthy — no destructive strip / badges.
export const AllClear: Story = {
  args: {
    data: {
      entries: [entries[2]],
      totals: { propertyCount: 1, totalAttention: 0, overallAvgRating: 4.7 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Needs action')).toBeVisible()
    expect(canvas.getByText('0')).toBeVisible()
    expect(canvas.getByText('All clear')).toBeVisible()
  },
}

// BQC-6.8 content robustness: a very long property name (with emoji) must
// wrap/reflow inside the fleet row without horizontal overflow.
export const LongPropertyName: Story = {
  args: {
    data: {
      entries: [
        {
          ...entries[0],
          propertyId: 'prop-long',
          name:
            'The Meridian Grand Resort & Spa at Sunset Harbor Bay 🌅 — ' +
            'An Autograph Collection Property of the Northern Archipelago ' +
            'Islands Hospitality Group International',
        },
      ],
      totals: { propertyCount: 1, totalAttention: 8, overallAvgRating: 4.2 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/the meridian grand resort/i)).toBeVisible()
    expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

// Empty state — org has no properties yet (CTA: Create Property).
export const Empty: Story = {
  render: () => <FleetOverviewEmpty />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: /no properties yet/i })).toBeVisible()
    expect(canvas.getByRole('link', { name: /create property/i })).toBeVisible()
  },
}

// Loading state — route shell renders this while fetching.
export const Loading: Story = {
  render: () => <FleetOverviewLoading />,
}

// Error state — retry surfaces the route-invalidate path.
export const Error: Story = {
  render: () => <FleetOverviewError message="We couldn't load your fleet overview." />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/we couldn't load your fleet overview/i)).toBeVisible()
    expect(canvas.getByRole('button', { name: /try again/i })).toBeVisible()
  },
}

// Denied — the fleet dashboard is a manager surface (dashboard.fleet_read);
// Staff have dashboard.read but not fleet_read. The route guard
// (src/routes/_authenticated/dashboard.tsx:30-35) throws a redirect to /home,
// so the denied UX is: the fleet view never mounts and the user lands on
// Home. There is no denied UI component to story — this story drives the REAL
// permission decision (can() from shared/domain/permissions, the same call the
// route makes) in a two-route memory router and asserts the redirect. The
// 2-line beforeLoad mirrors the route's (the route file itself is not
// importable in Storybook — its server-fn imports are stubbed out of the
// preview, see .storybook/main.ts viteFinal).
function FleetGateHarness({ role }: { role: Role }) {
  const [router] = useState(() => {
    const rootRoute = createRootRouteWithContext<{ role: Role }>()({
      component: Outlet,
    })
    const dashboardRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/dashboard',
      beforeLoad: ({ context }) => {
        // Mirrors src/routes/_authenticated/dashboard.tsx:30-35.
        if (!can(context.role, 'dashboard.fleet_read')) throw redirect({ to: '/home' })
      },
      component: () => <FleetOverview data={populatedData} />,
    })
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/home',
      component: () => <p>Staff home (redirect target)</p>,
    })
    return createRouter({
      routeTree: rootRoute.addChildren([dashboardRoute, homeRoute]),
      context: { role },
      history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
    })
  })
  return <RouterProvider router={router} />
}

export const DeniedStaffRedirect: Story = {
  render: () => <FleetGateHarness role="Staff" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Staff is redirected away from the fleet dashboard to Home...
    await expect(await canvas.findByText(/staff home \(redirect target\)/i)).toBeVisible()
    // ...and the fleet UI never mounts.
    expect(canvas.queryByText('Properties')).toBeNull()
  },
}

// Control — a manager role clears the same gate and the fleet view mounts.
export const AllowedManager: Story = {
  render: () => <FleetGateHarness role="AccountAdmin" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Properties')).toBeVisible()
  },
}
