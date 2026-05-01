// Team settings — edit name, description, and team lead
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { updateTeam } from '#/contexts/team/server/teams'
import { EditTeamForm } from '#/components/features/team/EditTeamForm'
import { useTeamLayout } from '../$teamId'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/teams/$teamId/',
)({
  component: TeamSettingsPage,
})

function TeamSettingsPage() {
  const { team, memberOptions, propertyId } = useTeamLayout()
  const navigate = useNavigate()

  const mutation = useMutationAction(updateTeam, {
    successMessage: 'Team updated',
  })

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Team Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update team name, description, and assign a team lead.
        </p>
      </div>

      <EditTeamForm
        teamId={team.id}
        initialName={team.name}
        initialDescription={team.description}
        initialTeamLeadId={team.teamLeadId}
        members={memberOptions.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
        }))}
        mutation={mutation}
        onCancel={() =>
          navigate({ to: '/properties/$propertyId/teams', params: { propertyId } })
        }
      />
    </>
  )
}
