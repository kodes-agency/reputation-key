// Update organization server function.
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import { getAuth } from '#/shared/auth/auth'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import { updateOrganization as updateOrganizationUseCase } from '../application/use-cases/update-organization'

// ── Update organization ──────────────────────────────────────────────
// Updates organization metadata exposed by the beta application.
// Per architecture: authorization lives in the use case, not the server function.

const nullableEmailInput = z
  .union([z.email(), z.literal('')])
  .nullable()
  .optional()
  .transform((value) => (value === '' ? null : value))

export const updateOrganizationInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    logo: z.string().nullable().optional(),
    contactEmail: nullableEmailInput,
  })
  .strict()

export const updateOrganization = createServerFn({ method: 'POST' })
  .validator(updateOrganizationInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'organization.update' })

        try {
          const useCase = updateOrganizationUseCase({
            updateOrg: async (data) => {
              const auth = getAuth()
              await auth.api.updateOrganization({ headers, body: { data } })
            },
          })
          await useCase(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.updateOrganization',
    ),
  )
