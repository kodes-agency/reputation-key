import { createFileRoute } from '@tanstack/react-router'
import { addTeamMember, removeTeamMember } from '#/contexts/team/server/teams'
import { TeamMemberList } from '#/components/features/team'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { teamKeys } from '#/shared/queries/query-keys'
import { teamMembershipsQueryKey, useTeamLayout } from '../$teamId'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId/members',
)({
  component: TeamMembersPage,
})

function TeamMembersPage() {
  const { memberships, availableParticipations, propertyId, teamId } = useTeamLayout()
  const addMemberMutation = useActionMutation(addTeamMember, {
    successMessage: 'Member added to team',
    invalidateKeys: [teamMembershipsQueryKey(teamId), teamKeys.list(propertyId)],
  })
  const removeMemberMutation = useActionMutation(removeTeamMember, {
    successMessage: 'Member removed from team',
    invalidateKeys: [teamMembershipsQueryKey(teamId), teamKeys.list(propertyId)],
  })

  return (
    <TeamMemberList
      teamId={teamId}
      memberships={memberships}
      availableParticipations={availableParticipations}
      canManageMembers
      addAction={addMemberMutation}
      removeAction={removeMemberMutation}
    />
  )
}
