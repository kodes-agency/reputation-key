import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { TeamRepository } from '../ports/team.repository'
import type {
  TeamMembershipCommandError,
  TeamMembershipCommandResult,
  TeamMembershipRepository,
  TeamMembershipView,
} from '../ports/team-membership.repository'
import { teamError } from '../../domain/errors'
import { teamId as toTeamId } from '#/shared/domain/ids'

export type TeamMembershipDeps = Readonly<{
  teamRepo: TeamRepository
  membershipRepo: TeamMembershipRepository
  staffApi: StaffPublicApi
  clock: () => Date
}>

async function loadScopedTeam(
  deps: TeamMembershipDeps,
  ctx: AuthContext,
  rawTeamId: string,
  action: 'team.read' | 'team.update' | 'team.membership.manage',
) {
  if (!canForContext(ctx, action)) {
    throw teamError('forbidden', 'team action is not permitted')
  }
  const team = await deps.teamRepo.findById(ctx.organizationId, toTeamId(rawTeamId))
  if (!team) throw teamError('team_not_found', 'team not found')
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, userId, orgWide) =>
      deps.staffApi.getAccessiblePropertyIds(orgId, userId, orgWide),
    ctx,
    action,
    team.propertyId,
  )
  if (!accessible) throw teamError('forbidden', 'no access to this property')
  return team
}

async function requireMembershipManager(
  deps: TeamMembershipDeps,
  ctx: AuthContext,
  rawTeamId: string,
) {
  const team = await loadScopedTeam(deps, ctx, rawTeamId, 'team.membership.manage')
  if (ctx.role === 'Staff') {
    const role = await deps.membershipRepo.findActiveRoleForUser(
      ctx.organizationId,
      rawTeamId,
      ctx.userId,
    )
    if (role !== 'lead') {
      throw teamError('forbidden', 'only the active team lead may manage members')
    }
  }
  return team
}

function commandValue(result: TeamMembershipCommandResult): TeamMembershipView {
  if (result.ok) return result.membership
  const messages: Readonly<Record<TeamMembershipCommandError, string>> = {
    team_not_found: 'team not found',
    participation_not_found: 'staff participation not found',
    participation_not_active: 'staff participation is not active',
    membership_not_found: 'active team membership not found',
    membership_is_lead: 'lead membership must be changed by a manager lead command',
    already_on_team: 'staff participation is already on this team',
    already_on_another_team: 'staff participation already belongs to another team',
  }
  const code =
    result.code === 'team_not_found'
      ? 'team_not_found'
      : result.code === 'participation_not_found'
        ? 'participation_not_found'
        : result.code === 'participation_not_active'
          ? 'participation_not_active'
          : result.code === 'membership_not_found'
            ? 'membership_not_found'
            : result.code === 'membership_is_lead'
              ? 'membership_is_lead'
              : 'membership_conflict'
  throw teamError(code, messages[result.code])
}

export const listTeamMemberships =
  (deps: TeamMembershipDeps) =>
  async (
    input: Readonly<{ teamId: string }>,
    ctx: AuthContext,
  ): Promise<
    Readonly<{
      memberships: readonly TeamMembershipView[]
      availableParticipations: readonly Readonly<{
        id: string
        propertyId: string
        userId: string
        displayName: string
      }>[]
    }>
  > => {
    await loadScopedTeam(deps, ctx, input.teamId, 'team.read')
    const [memberships, availableParticipations] = await Promise.all([
      deps.membershipRepo.listByTeam(ctx.organizationId, input.teamId),
      deps.membershipRepo.listAvailableForTeam(ctx.organizationId, input.teamId),
    ])
    return { memberships, availableParticipations }
  }

export const addTeamMember =
  (deps: TeamMembershipDeps) =>
  async (
    input: Readonly<{ teamId: string; staffParticipationId: string }>,
    ctx: AuthContext,
  ): Promise<TeamMembershipView> => {
    await requireMembershipManager(deps, ctx, input.teamId)
    return commandValue(
      await deps.membershipRepo.addMember({
        organizationId: ctx.organizationId,
        teamId: input.teamId,
        staffParticipationId: input.staffParticipationId,
        actorId: ctx.userId,
        at: deps.clock(),
      }),
    )
  }

export const removeTeamMember =
  (deps: TeamMembershipDeps) =>
  async (
    input: Readonly<{
      teamId: string
      staffParticipationId: string
      reason?: string
    }>,
    ctx: AuthContext,
  ): Promise<TeamMembershipView> => {
    await requireMembershipManager(deps, ctx, input.teamId)
    return commandValue(
      await deps.membershipRepo.removeMember({
        organizationId: ctx.organizationId,
        teamId: input.teamId,
        staffParticipationId: input.staffParticipationId,
        reason: input.reason?.trim() || 'removed_from_team',
        at: deps.clock(),
      }),
    )
  }

export const setTeamLead =
  (deps: TeamMembershipDeps) =>
  async (
    input: Readonly<{ teamId: string; staffParticipationId: string }>,
    ctx: AuthContext,
  ): Promise<TeamMembershipView> => {
    if (ctx.role === 'Staff') {
      throw teamError('forbidden', 'Staff cannot appoint a team lead')
    }
    await loadScopedTeam(deps, ctx, input.teamId, 'team.update')
    return commandValue(
      await deps.membershipRepo.setLead({
        organizationId: ctx.organizationId,
        teamId: input.teamId,
        staffParticipationId: input.staffParticipationId,
        actorId: ctx.userId,
        at: deps.clock(),
      }),
    )
  }

export const clearTeamLead =
  (deps: TeamMembershipDeps) =>
  async (
    input: Readonly<{ teamId: string; reason?: string }>,
    ctx: AuthContext,
  ): Promise<void> => {
    if (ctx.role === 'Staff') {
      throw teamError('forbidden', 'Staff cannot clear a team lead')
    }
    await loadScopedTeam(deps, ctx, input.teamId, 'team.update')
    const result = await deps.membershipRepo.clearLead({
      organizationId: ctx.organizationId,
      teamId: input.teamId,
      reason: input.reason?.trim() || 'lead_cleared',
      actorId: ctx.userId,
      at: deps.clock(),
    })
    if (!result.ok) commandValue(result)
  }

export const listMyTeam =
  (deps: TeamMembershipDeps) =>
  async (
    input: Readonly<{
      authorizedScopes?: readonly Readonly<{
        teamId: string
        role: 'member' | 'lead'
      }>[]
    }>,
    ctx: AuthContext,
  ) => {
    if (!canForContext(ctx, 'team.read')) {
      throw teamError('forbidden', 'team read is not permitted')
    }
    const active = input.authorizedScopes
      ? null
      : await deps.membershipRepo.listActiveByUser(ctx.organizationId, ctx.userId)
    const scopes = input.authorizedScopes ?? active ?? []
    if (scopes.length === 0) {
      return { team: null, memberships: [], availableParticipations: [] }
    }
    const teamIds = [...new Set(scopes.map((membership) => membership.teamId))]
    if (teamIds.length !== 1) {
      throw teamError(
        'ambiguous_membership',
        'multiple active teams require an explicit property selection',
      )
    }
    const team = await loadScopedTeam(deps, ctx, teamIds[0], 'team.read')
    const memberships = await deps.membershipRepo.listByTeam(
      ctx.organizationId,
      teamIds[0],
    )
    const actorIsLead = scopes.some(
      (membership) => membership.teamId === teamIds[0] && membership.role === 'lead',
    )
    const availableParticipations = actorIsLead
      ? await deps.membershipRepo.listAvailableForTeam(ctx.organizationId, teamIds[0])
      : []
    return { team, memberships, availableParticipations }
  }
