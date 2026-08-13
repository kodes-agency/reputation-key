import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { clearTeamLead, setTeamLead, updateTeam } from '#/contexts/team/server/teams'
import { EditTeamForm, TeamLeadControls } from '#/components/features/team'
import { useTeamLayout, teamMembershipsQueryKey } from '../$teamId'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { teamKeys } from '#/shared/queries/query-keys'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId/',
)({
  component: TeamSettingsPage,
})

function TeamSettingsPage() {
  const { team, memberships, propertyId, teamId } = useTeamLayout()
  const navigate = useNavigate()
  const invalidationKeys = [teamKeys.list(propertyId), teamMembershipsQueryKey(teamId)]

  const updateMutation = useActionMutation(updateTeam, {
    successMessage: 'Team updated',
    invalidateKeys: invalidationKeys,
  })
  const setLeadMutation = useActionMutation(setTeamLead, {
    successMessage: 'Team lead updated',
    invalidateKeys: invalidationKeys,
  })
  const clearLeadMutation = useActionMutation(clearTeamLead, {
    successMessage: 'Team lead cleared',
    invalidateKeys: invalidationKeys,
  })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <EditTeamForm
        teamId={team.id}
        initialName={team.name}
        initialDescription={team.description}
        mutation={updateMutation}
        onCancel={() =>
          navigate({ to: '/properties/$propertyId/people', params: { propertyId } })
        }
      />
      <TeamLeadControls
        teamId={teamId}
        memberships={memberships}
        setLeadAction={setLeadMutation}
        clearLeadAction={clearLeadMutation}
      />
    </div>
  )
}
