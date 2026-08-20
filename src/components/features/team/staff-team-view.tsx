import { ShieldCheck, UserRoundSearch } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { EmptyState } from '#/components/ui/empty-state'
import { TeamMemberList } from './team-members/team-member-list'
import type {
  StaffParticipationView,
  TeamMembershipView,
  TeamSummary,
} from './shared/types'

type Props = Readonly<{
  team: TeamSummary | null
  memberships: ReadonlyArray<TeamMembershipView>
  availableParticipations: ReadonlyArray<
    Pick<StaffParticipationView, 'id' | 'userId' | 'displayName'>
  >
  currentUserId: string
  addAction: Action<{ data: { teamId: string; staffParticipationId: string } }>
  removeAction: Action<{
    data: { teamId: string; staffParticipationId: string; reason?: string }
  }>
}>

export function StaffTeamView({
  team,
  memberships,
  availableParticipations,
  currentUserId,
  addAction,
  removeAction,
}: Props) {
  if (!team) {
    return (
      <PageShell>
        <PageHeader title="My team" description="Your current team and active members." />
        <EmptyState icon={UserRoundSearch} title="You are not assigned to a team">
          <p className="max-w-md text-sm text-muted-foreground">
            When a manager adds your property participation to a team, it will appear
            here.
          </p>
        </EmptyState>
      </PageShell>
    )
  }

  const currentMembership = memberships.find(
    (membership) => membership.userId === currentUserId && membership.effectiveTo == null,
  )
  const isLead = currentMembership?.role === 'lead'

  return (
    <PageShell>
      <PageHeader
        title={team.name}
        description={
          team.description ?? 'Your current team and its active property members.'
        }
      />
      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>{isLead ? 'You lead this team' : 'You are a team member'}</AlertTitle>
        <AlertDescription>
          {isLead
            ? 'You may add or remove non-lead members. Only a manager can appoint, replace, or clear the lead.'
            : 'Membership is read-only. A team lead or manager can update the member list.'}
        </AlertDescription>
      </Alert>
      <TeamMemberList
        teamId={team.id}
        memberships={memberships}
        availableParticipations={availableParticipations}
        canManageMembers={isLead}
        addAction={addAction}
        removeAction={removeAction}
      />
    </PageShell>
  )
}
