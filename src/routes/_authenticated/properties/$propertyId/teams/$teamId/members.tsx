// Team members — view and manage team membership
import { createFileRoute } from '@tanstack/react-router'
import {
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { TeamMemberList } from '#/components/features/team'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { teamKeys, identityKeys, staffKeys } from '#/shared/queries/query-keys'
import { useTeamLayout } from '../$teamId'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId/members',
)({
  component: TeamMembersPage,
})

function TeamMembersPage() {
  const { team, memberOptions, assignments, propertyId, teamId } = useTeamLayout()

  const addMemberMutation = useActionMutation(createStaffAssignment, {
    successMessage: 'Member added to team',
    invalidateKeys: [
      teamKeys.list(propertyId),
      identityKeys.members(),
      staffKeys.assignments(propertyId),
    ],
  })
  const removeMemberMutation = useActionMutation(removeStaffAssignment, {
    successMessage: 'Member removed from team',
    invalidateKeys: [
      teamKeys.list(propertyId),
      identityKeys.members(),
      staffKeys.assignments(propertyId),
    ],
  })

  return (
    <TeamMemberList
      teamId={teamId}
      propertyId={propertyId}
      assignments={assignments}
      members={memberOptions}
      teamLeadId={team.teamLeadId}
      addAction={addMemberMutation}
      removeAction={removeMemberMutation}
    />
  )
}
