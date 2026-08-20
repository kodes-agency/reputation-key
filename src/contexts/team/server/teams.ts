// Team context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import {
  getExecutionPolicy,
  requireExecutionAllowed,
} from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createTeamInputSchema } from '../application/dto/create-team.dto'
import { updateTeamInputSchema } from '../application/dto/update-team.dto'
import { isTeamError, teamError } from '../domain/errors'
import type { TeamErrorCode } from '../domain/errors'
import { propertyId as toPropertyId, teamId as toTeamId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  requireMatchingTeamResourceScopes,
  requireTeamResourceScope,
} from './property-scope'

export const teamErrorStatus = (code: TeamErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with(
      'team_not_found',
      'property_not_found',
      'participation_not_found',
      'membership_not_found',
      () => HTTP_STATUS.NOT_FOUND,
    )
    .with(
      'name_taken',
      'team_has_assignments',
      'membership_conflict',
      'membership_is_lead',
      'ambiguous_membership',
      'participation_not_active',
      () => HTTP_STATUS.CONFLICT,
    )
    .with('invalid_name', () => HTTP_STATUS.BAD_REQUEST)
    .exhaustive()

const teamIdSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
})

const propertyIdSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

const membershipInputSchema = z.object({
  teamId: z.string().uuid(),
  staffParticipationId: z.string().uuid(),
})

const removeMembershipInputSchema = membershipInputSchema.extend({
  reason: z.string().trim().min(1).max(500).optional(),
})

const clearLeadInputSchema = z.object({
  teamId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
})

const emptyInputSchema = z.object({})
async function authorizeTeamResource(
  ctx: AuthContext,
  rawTeamId: string,
  action: 'team.read' | 'team.update' | 'team.delete' | 'team.membership.manage',
): Promise<void> {
  const { useCases } = getContainer()
  try {
    await requireTeamResourceScope({
      actor: ctx,
      action,
      notFound: teamError('team_not_found', 'team not found'),
      lookup: () => useCases.resolveTeamContext(toTeamId(rawTeamId)),
    })
  } catch (error) {
    if (isTeamError(error))
      throwContextError('TeamError', error, teamErrorStatus(error.code))
    throw error
  }
}

async function authorizeTeamParticipation(
  ctx: AuthContext,
  input: Readonly<{ teamId: string; staffParticipationId: string }>,
  action: 'team.update' | 'team.membership.manage',
): Promise<void> {
  const { useCases } = getContainer()
  try {
    await requireMatchingTeamResourceScopes({
      actor: ctx,
      action,
      notFound: teamError('participation_not_found', 'participation not found'),
      lookups: [
        () => useCases.resolveTeamContext(toTeamId(input.teamId)),
        () => useCases.resolveStaffParticipationContext(input.staffParticipationId),
      ],
    })
  } catch (error) {
    if (isTeamError(error))
      throwContextError('TeamError', error, teamErrorStatus(error.code))
    throw error
  }
}

async function resolveAuthorizedMyTeamScopes(
  ctx: AuthContext,
): Promise<readonly Readonly<{ teamId: string; role: 'member' | 'lead' }>[]> {
  const { useCases } = getContainer()
  const scopes = await useCases.listActiveTeamScopesByUser(ctx.organizationId, ctx.userId)
  const allowed = await Promise.all(
    scopes.map(async (scope) => {
      const decision = await getExecutionPolicy().decide({
        principal: { kind: 'user', ctx },
        action: 'team.read',
        organizationId: ctx.organizationId,
        propertyId: scope.propertyId,
        executionKind: 'interactive',
        now: new Date(),
      })
      return decision.allowed ? { teamId: scope.teamId, role: scope.role } : null
    }),
  )
  return allowed.filter(
    (scope): scope is { teamId: string; role: 'member' | 'lead' } => scope !== null,
  )
}

// ── createTeam ──────────────────────────────────────────────────────

export const createTeam = createServerFn({ method: 'POST' })
  .inputValidator(createTeamInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'team.create',
          propertyId: data.propertyId,
        })

        try {
          const { useCases } = getContainer()
          const team = await useCases.createTeam(data, ctx)
          return { team }
        } catch (e) {
          if (isTeamError(e)) throwContextError('TeamError', e, teamErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'team.createTeam',
    ),
  )

// ── updateTeam ──────────────────────────────────────────────────────

export const updateTeam = createServerFn({ method: 'POST' })
  .inputValidator(updateTeamInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizeTeamResource(ctx, data.teamId, 'team.update')

        try {
          const { useCases } = getContainer()
          const team = await useCases.updateTeam(data, ctx)
          return { team }
        } catch (e) {
          if (isTeamError(e)) throwContextError('TeamError', e, teamErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'team.updateTeam',
    ),
  )

// ── listTeams ───────────────────────────────────────────────────────

export const listTeams = createServerFn({ method: 'GET' })
  .inputValidator(propertyIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'team.read',
          propertyId: data.propertyId,
        })

        try {
          const { useCases } = getContainer()
          const teams_list = await useCases.listTeams(
            { propertyId: toPropertyId(data.propertyId) },
            ctx,
          )
          return { teams: teams_list }
        } catch (e) {
          if (isTeamError(e)) throwContextError('TeamError', e, teamErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'team.listTeams',
    ),
  )

// ── deleteTeam (soft-delete) ────────────────────────────────────────

export const deleteTeam = createServerFn({ method: 'POST' })
  .inputValidator(teamIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizeTeamResource(ctx, data.teamId, 'team.delete')

        try {
          const { useCases } = getContainer()
          await useCases.softDeleteTeam({ teamId: toTeamId(data.teamId) }, ctx)
          return { deleted: true, teamId: data.teamId }
        } catch (e) {
          if (isTeamError(e)) throwContextError('TeamError', e, teamErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'team.deleteTeam',
    ),
  )

export const listTeamMemberships = createServerFn({ method: 'GET' })
  .inputValidator(teamIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizeTeamResource(ctx, data.teamId, 'team.read')
        try {
          return await getContainer().useCases.listTeamMemberships(data, ctx)
        } catch (error) {
          if (isTeamError(error))
            throwContextError('TeamError', error, teamErrorStatus(error.code))
          throw catchUntagged(error)
        }
      },
      'GET',
      'team.listTeamMemberships',
    ),
  )

export const addTeamMember = createServerFn({ method: 'POST' })
  .inputValidator(membershipInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizeTeamParticipation(ctx, data, 'team.membership.manage')
        try {
          const membership = await getContainer().useCases.addTeamMember(data, ctx)
          return { membership }
        } catch (error) {
          if (isTeamError(error))
            throwContextError('TeamError', error, teamErrorStatus(error.code))
          throw catchUntagged(error)
        }
      },
      'POST',
      'team.addTeamMember',
    ),
  )

export const removeTeamMember = createServerFn({ method: 'POST' })
  .inputValidator(removeMembershipInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizeTeamParticipation(ctx, data, 'team.membership.manage')
        try {
          await getContainer().useCases.removeTeamMember(data, ctx)
          return { removed: true as const }
        } catch (error) {
          if (isTeamError(error))
            throwContextError('TeamError', error, teamErrorStatus(error.code))
          throw catchUntagged(error)
        }
      },
      'POST',
      'team.removeTeamMember',
    ),
  )

export const setTeamLead = createServerFn({ method: 'POST' })
  .inputValidator(membershipInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizeTeamParticipation(ctx, data, 'team.update')
        try {
          const membership = await getContainer().useCases.setTeamLead(data, ctx)
          return { membership }
        } catch (error) {
          if (isTeamError(error))
            throwContextError('TeamError', error, teamErrorStatus(error.code))
          throw catchUntagged(error)
        }
      },
      'POST',
      'team.setTeamLead',
    ),
  )

export const clearTeamLead = createServerFn({ method: 'POST' })
  .inputValidator(clearLeadInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizeTeamResource(ctx, data.teamId, 'team.update')
        try {
          await getContainer().useCases.clearTeamLead(data, ctx)
          return { cleared: true as const }
        } catch (error) {
          if (isTeamError(error))
            throwContextError('TeamError', error, teamErrorStatus(error.code))
          throw catchUntagged(error)
        }
      },
      'POST',
      'team.clearTeamLead',
    ),
  )

export const listMyTeam = createServerFn({ method: 'GET' })
  .inputValidator(emptyInputSchema)
  .handler(
    tracedHandler(
      async () => {
        const ctx = await resolveTenantContext(await headersFromContext())
        const authorizedScopes = await resolveAuthorizedMyTeamScopes(ctx)
        try {
          return await getContainer().useCases.listMyTeam({ authorizedScopes }, ctx)
        } catch (error) {
          if (isTeamError(error))
            throwContextError('TeamError', error, teamErrorStatus(error.code))
          throw catchUntagged(error)
        }
      },
      'GET',
      'team.listMyTeam',
    ),
  )
