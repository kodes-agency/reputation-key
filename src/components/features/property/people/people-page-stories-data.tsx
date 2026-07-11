import type { ComponentProps, ReactNode } from 'react'
import { useRef, useState } from 'react'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type { Role } from '#/shared/domain/roles'
import { PeoplePage } from './people-page'
import type { Action } from '#/components/hooks/use-action'
import type { CreateStaffAssignmentInput } from '#/contexts/staff/application/dto/staff-assignment.dto'
import type { CreateTeamInput } from '#/contexts/team/application/dto/create-team.dto'

// Fixtures for people-page.stories.tsx — extracted for line-count compliance.
// Now provides wrapped Action objects (per QRY-04/05 route pattern) instead of raw server fns.
type Props = ComponentProps<typeof PeoplePage>

const assignMutation: Action<{ data: CreateStaffAssignmentInput }> = Object.assign(
  async (_input: { data: CreateStaffAssignmentInput }) => ({
    assignment: { id: 'a-new' },
  }),
  { isPending: false, error: null, isSuccess: false, data: null },
)

const removeMutation: Action<{ data: { assignmentId: string } }> = Object.assign(
  async (_input: { data: { assignmentId: string } }) => ({}),
  { isPending: false, error: null, isSuccess: false, data: null },
)

const updatePortalsMutation: Action<{
  data: { userId: string; propertyId: string; portalIds: string[] }
}> = Object.assign(async (_input: { data: unknown }) => ({}), {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
})

const createTeamMutation: Action<{ data: CreateTeamInput }> = Object.assign(
  async (_input: { data: CreateTeamInput }) => ({
    team: { id: 't-new', name: 'New Team' },
  }),
  { isPending: false, error: null, isSuccess: false, data: null },
)

const deleteTeamMutation: Action<{ data: { teamId: string } }> = Object.assign(
  async (_input: { data: { teamId: string } }) => ({}),
  { isPending: false, error: null, isSuccess: false, data: null },
)

// Seeded data: 2 members, 1 team, 2 portals, 2 assignments (one team-scoped,
// one direct). Plain literals cast to the component's prop contract — branded
// ids / Date fields make a literal-only assignment impossible, so one boundary
// cast lands the fixtures.
export const seededArgs = {
  propertyId: 'prop-1',
  propertyName: 'Acme Hotel',
  assignments: [
    {
      id: 'a1',
      organizationId: 'org-1',
      userId: 'u1',
      propertyId: 'prop-1',
      teamId: 't1',
      portalId: 'p1',
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'a2',
      organizationId: 'org-1',
      userId: 'u2',
      propertyId: 'prop-1',
      teamId: null,
      portalId: 'p2',
      createdAt: '2024-02-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
      deletedAt: null,
    },
  ],
  members: [
    {
      id: 'm1',
      userId: 'u1',
      role: 'admin',
      email: 'alice@acme.com',
      name: 'Alice Adams',
      image: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'm2',
      userId: 'u2',
      role: 'member',
      email: 'bob@acme.com',
      name: 'Bob Baker',
      image: null,
      createdAt: '2024-02-01T00:00:00.000Z',
    },
  ],
  teams: [{ id: 't1', name: 'Front Desk' }],
  portals: [
    { id: 'p1', name: 'Main Portal' },
    { id: 'p2', name: 'Guest Portal' },
  ],
  tab: 'staff',
  onTabChange: () => {},
  assignMutation,
  removeMutation,
  createTeamMutation,
  deleteTeamMutation,
  updatePortalsMutation,
} as unknown as Props

// Decorator: provide `/_authenticated` route context with an owner role.
// Used only by stories whose subtree calls `usePermissions()` (Teams tab).
// AccountAdmin (the owner role) is granted every permission, so `can(...)`
// returns true for team.create / team.delete / portal.update etc.
export function AuthRoleDecorator(Story: () => ReactNode) {
  const storyRef = useRef(Story)
  storyRef.current = Story
  const [router] = useState(() => {
    const rootRoute = createRootRouteWithContext<{ role: Role }>()({
      component: Outlet,
    })
    const authRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '_authenticated',
      component: Outlet,
    })
    const indexRoute = createRoute({
      getParentRoute: () => authRoute,
      path: '/',
      component: () => <>{storyRef.current()}</>,
    })
    return createRouter({
      routeTree: rootRoute.addChildren([authRoute.addChildren([indexRoute])]),
      context: { role: 'AccountAdmin' },
      history: createMemoryHistory({ initialEntries: ['/_authenticated/'] }),
    })
  })
  return <RouterProvider router={router} />
}
