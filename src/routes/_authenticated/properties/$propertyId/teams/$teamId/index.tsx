// Team settings — edit name, description, and team lead
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { updateTeam } from '#/contexts/team/server/teams'
import { EditTeamForm } from '#/components/features/team'
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
    invalidateRoutes: ['/_authenticated/properties/$propertyId/teams/$teamId'],
  })

  return (
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
        navigate({ to: '/properties/$propertyId/people', params: { propertyId } })
      }
    />
  )
}
