// Team context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { can } from '#/shared/domain/permissions'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createTeamInputSchema } from '../application/dto/create-team.dto'
import { updateTeamInputSchema } from '../application/dto/update-team.dto'
import { isTeamError } from '../domain/errors'
import type { TeamErrorCode } from '../domain/errors'
import { propertyId as toPropertyId, teamId as toTeamId } from '#/shared/domain/ids'

const teamErrorStatus = (code: TeamErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('team_not_found', 'property_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('name_taken', () => HTTP_STATUS.CONFLICT)
    .with('invalid_name', () => HTTP_STATUS.BAD_REQUEST)
    .with('team_has_assignments', () => HTTP_STATUS.CONFLICT)
    .exhaustive()

const teamIdSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
})

const propertyIdSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

// ── createTeam ──────────────────────────────────────────────────────

export const createTeam = createServerFn({ method: 'POST' })
  .inputValidator(createTeamInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'team.create')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No team create permission' },
            403,
          )
        }

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
        if (!can(ctx.role, 'team.update')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No team update permission' },
            403,
          )
        }

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
        if (!can(ctx.role, 'team.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No team read permission' },
            403,
          )
        }

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
        if (!can(ctx.role, 'team.delete')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No team delete permission' },
            403,
          )
        }

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
