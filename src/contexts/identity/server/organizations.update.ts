// Update organization server function.
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { getAuth } from '#/shared/auth/auth'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.shared'
import { updateOrganization as updateOrganizationUseCase } from '../application/use-cases/update-organization'

// ── Update organization ──────────────────────────────────────────────
// Updates organization metadata including billing fields.
// Per architecture: authorization lives in the use case, not the server function.

const updateOrganizationInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    logo: z.string().nullable().optional(),
    contactEmail: z.string().email().nullable().optional(),
    billingCompanyName: z.string().nullable().optional(),
    billingAddress: z.string().nullable().optional(),
    billingCity: z.string().nullable().optional(),
    billingPostalCode: z.string().nullable().optional(),
    billingCountry: z.string().nullable().optional(),
  })
  .strict()

export const updateOrganization = createServerFn({ method: 'POST' })
  .inputValidator(updateOrganizationInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const useCase = updateOrganizationUseCase({
            updateOrg: async (h, d) => {
              const auth = getAuth()
              await auth.api.updateOrganization({ headers: h, body: { data: d } })
            },
            getHeaders: () => headers,
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
