// Team context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createTeamInputSchema } from '../application/dto/create-team.dto'
import { updateTeamInputSchema } from '../application/dto/update-team.dto'
import { isTeamError } from '../domain/errors'
import type { TeamErrorCode } from '../domain/errors'
import { propertyId as toPropertyId, teamId as toTeamId } from '#/shared/domain/ids'

const teamErrorStatus = (code: TeamErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('team_not_found', 'property_not_found', () => 404)
    .with('name_taken', () => 409)
    .with('invalid_name', () => 400)
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
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const team = await useCases.createTeam(data, ctx)
      return { team }
    } catch (e) {
      if (isTeamError(e)) throwContextError('TeamError', e, teamErrorStatus(e.code))
      throw e
    }
  })

// ── updateTeam ──────────────────────────────────────────────────────

export const updateTeam = createServerFn({ method: 'POST' })
  .inputValidator(updateTeamInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const team = await useCases.updateTeam(data, ctx)
      return { team }
    } catch (e) {
      if (isTeamError(e)) throwContextError('TeamError', e, teamErrorStatus(e.code))
      throw e
    }
  })

// ── listTeams ───────────────────────────────────────────────────────

export const listTeams = createServerFn({ method: 'GET' })
  .inputValidator(propertyIdSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const teams_list = await useCases.listTeams(
        { propertyId: toPropertyId(data.propertyId) },
        ctx,
      )
      return { teams: teams_list }
    } catch (e) {
      if (isTeamError(e)) throwContextError('TeamError', e, teamErrorStatus(e.code))
      throw e
    }
  })

// ── deleteTeam (soft-delete) ────────────────────────────────────────

export const deleteTeam = createServerFn({ method: 'POST' })
  .inputValidator(teamIdSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      await useCases.softDeleteTeam({ teamId: toTeamId(data.teamId) }, ctx)
      return { deleted: true, teamId: data.teamId }
    } catch (e) {
      if (isTeamError(e)) throwContextError('TeamError', e, teamErrorStatus(e.code))
      throw e
    }
  })
