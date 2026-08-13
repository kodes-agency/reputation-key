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
import type { Action } from '#/components/hooks/use-action'
import type { Role } from '#/shared/domain/roles'
import type {
  ArchiveStaffParticipationMutationInput,
  CreateStaffParticipationMutationInput,
  CreateTeamMutationInput,
  UpdatePortalResponsibilitiesMutationInput,
} from '#/components/features/team/shared/types'
import { PeoplePage } from './people-page'

type Props = ComponentProps<typeof PeoplePage>

const idle = { isPending: false, error: null, isSuccess: false, data: null }

const createParticipationMutation: Action<{
  data: CreateStaffParticipationMutationInput
}> = Object.assign(
  async ({ data }: { data: CreateStaffParticipationMutationInput }) => ({
    participation: {
      id: `sp-${data.userId}`,
      propertyId: data.propertyId,
      userId: data.userId,
    },
  }),
  idle,
)

const archiveParticipationMutation: Action<{
  data: ArchiveStaffParticipationMutationInput
}> = Object.assign(async () => ({ archived: true }), idle)

const updateResponsibilitiesMutation: Action<{
  data: UpdatePortalResponsibilitiesMutationInput
}> = Object.assign(async () => ({ updated: true }), idle)

const createTeamMutation: Action<{ data: CreateTeamMutationInput }> = Object.assign(
  async ({ data }: { data: CreateTeamMutationInput }) => ({
    team: { id: 't-new', ...data },
  }),
  idle,
)

const archiveTeamMutation: Action<{ data: { teamId: string } }> = Object.assign(
  async () => ({ archived: true }),
  idle,
)

export const seededArgs = {
  propertyId: 'prop-1',
  propertyName: 'Acme Hotel',
  participations: [
    {
      id: 'sp-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      userId: 'u1',
      displayName: 'Alice Adams',
      status: 'active',
      startedAt: '2024-01-15T00:00:00.000Z',
      endedAt: null,
    },
    {
      id: 'sp-2',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      userId: 'u2',
      displayName: 'Bob Baker',
      status: 'active',
      startedAt: '2024-02-01T00:00:00.000Z',
      endedAt: null,
    },
  ],
  responsibilities: [
    {
      staffParticipationId: 'sp-1',
      primaryPortalId: 'p1',
      supportingPortalIds: ['p2'],
    },
  ],
  memberships: [
    {
      id: 'tm-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      teamId: 't1',
      staffParticipationId: 'sp-1',
      userId: 'u1',
      displayName: 'Alice Adams',
      role: 'lead',
      effectiveFrom: '2024-01-15T00:00:00.000Z',
      effectiveTo: null,
    },
    {
      id: 'tm-2',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      teamId: 't1',
      staffParticipationId: 'sp-2',
      userId: 'u2',
      displayName: 'Bob Baker',
      role: 'member',
      effectiveFrom: '2024-02-01T00:00:00.000Z',
      effectiveTo: null,
    },
  ],
  members: [
    {
      userId: 'u1',
      role: 'admin',
      email: 'alice@acme.com',
      name: 'Alice Adams',
    },
    {
      userId: 'u2',
      role: 'member',
      email: 'bob@acme.com',
      name: 'Bob Baker',
    },
    {
      userId: 'u3',
      role: 'member',
      email: 'chris@acme.com',
      name: 'Chris Chen',
    },
  ],
  teams: [
    {
      id: 't1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      name: 'Front Desk',
      description: 'Guest arrival and service',
    },
  ],
  portals: [
    { id: 'p1', name: 'Main Portal' },
    { id: 'p2', name: 'Guest Portal' },
  ],
  portalsDenied: false,
  tab: 'staff',
  onTabChange: () => {},
  createParticipationMutation,
  archiveParticipationMutation,
  createTeamMutation,
  archiveTeamMutation,
  updateResponsibilitiesMutation,
} satisfies Props

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
