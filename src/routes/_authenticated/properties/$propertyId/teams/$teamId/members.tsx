// Team members — view and manage team membership
import { createFileRoute } from '@tanstack/react-router'
import {
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { TeamMemberList } from '#/components/features/team/TeamMemberList'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { useTeamLayout } from '../$teamId'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId/members',
)({
  component: TeamMembersPage,
})

function TeamMembersPage() {
  const { team, memberOptions, assignments, propertyId, teamId } = useTeamLayout()

  const addMemberMutation = useMutationAction(createStaffAssignment, {
    successMessage: 'Member added to team',
  })
  const removeMemberMutation = useMutationAction(removeStaffAssignment, {
    successMessage: 'Member removed from team',
  })

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Team Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage who belongs to {team.name}.
        </p>
      </div>

      <TeamMemberList
        teamId={teamId}
        propertyId={propertyId}
        assignments={assignments}
        members={memberOptions}
        teamLeadId={team.teamLeadId}
        addAction={addMemberMutation}
        removeAction={removeMemberMutation}
      />
    </>
  )
}
