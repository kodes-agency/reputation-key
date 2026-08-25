import type { ComponentProps } from 'react'
import type { Action } from '#/components/hooks/use-action'
import type {
  ArchiveStaffParticipationMutationInput,
  CreateStaffParticipationMutationInput,
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
  portals: [
    { id: 'p1', name: 'Main Portal' },
    { id: 'p2', name: 'Guest Portal' },
  ],
  portalsDenied: false,
  tab: 'staff',
  onTabChange: () => {},
  createParticipationMutation,
  archiveParticipationMutation,
  updateResponsibilitiesMutation,
} satisfies Props
