import type { TeamMembership, MembershipRole } from '../../domain/team-membership'
export type TeamMembershipView = Readonly<
  TeamMembership & {
    userId: string
    displayName: string
  }
>

export type TeamMembershipCommandError =
  | 'team_not_found'
  | 'participation_not_found'
  | 'participation_not_active'
  | 'membership_not_found'
  | 'membership_is_lead'
  | 'already_on_team'
  | 'already_on_another_team'

export type TeamMembershipCommandResult =
  | Readonly<{ ok: true; membership: TeamMembershipView }>
  | Readonly<{ ok: false; code: TeamMembershipCommandError }>

export type TeamMembershipRepository = Readonly<{
  listByTeam: (
    organizationId: string,
    teamId: string,
  ) => Promise<readonly TeamMembershipView[]>
  listActiveByUser: (
    organizationId: string,
    userId: string,
  ) => Promise<readonly TeamMembershipView[]>
  listAvailableForTeam: (
    organizationId: string,
    teamId: string,
  ) => Promise<
    readonly Readonly<{
      id: string
      propertyId: string
      userId: string
      displayName: string
    }>[]
  >
  findActiveRoleForUser: (
    organizationId: string,
    teamId: string,
    userId: string,
  ) => Promise<MembershipRole | null>
  addMember: (
    input: Readonly<{
      organizationId: string
      teamId: string
      staffParticipationId: string
      actorId: string
      at: Date
    }>,
  ) => Promise<TeamMembershipCommandResult>
  removeMember: (
    input: Readonly<{
      organizationId: string
      teamId: string
      staffParticipationId: string
      reason: string
      at: Date
    }>,
  ) => Promise<TeamMembershipCommandResult>
  setLead: (
    input: Readonly<{
      organizationId: string
      teamId: string
      staffParticipationId: string
      actorId: string
      at: Date
    }>,
  ) => Promise<TeamMembershipCommandResult>
  clearLead: (
    input: Readonly<{
      organizationId: string
      teamId: string
      reason: string
      actorId: string
      at: Date
    }>,
  ) => Promise<TeamMembershipCommandResult | Readonly<{ ok: true; membership: null }>>
  closeForTeam: (
    organizationId: string,
    teamId: string,
    at: Date,
    reason: string,
  ) => Promise<number>
}>
