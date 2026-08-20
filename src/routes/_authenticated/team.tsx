import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { StaffTeamView } from '#/components/features/team'
import { addTeamMember, listMyTeam, removeTeamMember } from '#/contexts/team/server/teams'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

const myTeamQueryKey = ['my-team'] as const
const myTeamQuery = queryOptions({
  queryKey: myTeamQueryKey,
  queryFn: () => listMyTeam({ data: {} }),
  staleTime: 30_000,
})

export const Route = createFileRoute('/_authenticated/team')({
  beforeLoad: async () => {
    await gateControlledRoute({ data: { capability: 'team.use', featureLabel: 'Teams' } })
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(myTeamQuery),
  pendingComponent: StaffTeamLoading,
  errorComponent: StaffTeamError,
  component: StaffTeamPage,
})

function StaffTeamLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading your team" />
    </PageShell>
  )
}

function StaffTeamError({ error }: { error: Error }) {
  return (
    <PageShell>
      <PageHeader title="My team" description="Your current team and active members." />
      <ErrorState message={error.message || 'Your team could not be loaded.'} />
    </PageShell>
  )
}

function StaffTeamPage() {
  const { user } = Route.useRouteContext()
  const { data } = useSuspenseQuery(myTeamQuery)
  const addMemberMutation = useActionMutation(addTeamMember, {
    successMessage: 'Member added to team',
    invalidateKeys: [myTeamQueryKey],
  })
  const removeMemberMutation = useActionMutation(removeTeamMember, {
    successMessage: 'Member removed from team',
    invalidateKeys: [myTeamQueryKey],
  })

  return (
    <StaffTeamView
      team={data.team}
      memberships={data.memberships}
      availableParticipations={data.availableParticipations}
      currentUserId={user.id}
      addAction={addMemberMutation}
      removeAction={removeMemberMutation}
    />
  )
}
