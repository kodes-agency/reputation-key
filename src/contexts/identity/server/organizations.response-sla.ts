// Identity context — response-SLA server functions.
// Read + update the organization's response_sla_hours setting, which feeds the
// dashboard attention band (unanswered-reviews past SLA). Per architecture:
// server/ contains TanStack Start server functions; tenant context is resolved
// from the authenticated session, not from client input.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { can } from '#/shared/domain/permissions'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getAuth } from '#/shared/auth/auth'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import {
  extractResponseSlaHours,
  DEFAULT_RESPONSE_SLA_HOURS,
} from './organizations.shared'
import { updateOrganization as updateOrganizationUseCase } from '../application/use-cases/update-organization'

// ── Read ────────────────────────────────────────────────────────────

export const getOrgResponseSlaFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'dashboard.read')) {
          throwContextError(
            'AuthError',
            {
              code: 'forbidden',
              message: 'Insufficient permissions to read organization settings',
            },
            403,
          )
        }
        const auth = getAuth()
        const org = await auth.api.getFullOrganization({ headers })
        // No active org is a valid state — fall back to the default SLA.
        return { responseSlaHours: extractResponseSlaHours(org) }
      } catch (e) {
        if (
          e instanceof Error &&
          'code' in e &&
          (e as { code: string }).code === 'no_active_org'
        ) {
          return { responseSlaHours: DEFAULT_RESPONSE_SLA_HOURS }
        }
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.getOrgResponseSla',
  ),
)

// ── Update ──────────────────────────────────────────────────────────

const updateResponseSlaInputSchema = z
  .object({
    responseSlaHours: z.number().int().min(1).max(720),
  })
  .strict()

export const updateOrgResponseSlaFn = createServerFn({ method: 'POST' })
  .inputValidator(updateResponseSlaInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const useCase = updateOrganizationUseCase({
            updateOrg: async (updateData) => {
              const auth = getAuth()
              await auth.api.updateOrganization({ headers, body: { data: updateData } })
            },
          })
          await useCase({ responseSlaHours: data.responseSlaHours }, ctx)
          return { responseSlaHours: data.responseSlaHours }
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.updateOrgResponseSla',
    ),
  )
