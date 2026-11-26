// Update organization server function.
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { command } from '#/shared/commands/command.server'
import { identityCommandErrors } from './organizations.errors.server'

// ── Update organization ──────────────────────────────────────────────
// Updates organization metadata exposed by the beta application.
// Per architecture: authorization lives in the use case, not the server function.
// The use case is the one the build publishes (`requests.updateOrganization`);
// this function adapts the call to it and composes nothing.

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
    command(
      {
        method: 'POST',
        name: 'identity.updateOrganization',
        action: 'organization.update',
        errors: identityCommandErrors,
      },
      async ({ data, actor }) => {
        const { getContainer } = await import('#/composition')
        await getContainer().identityPublicApi.requests.updateOrganization(data, actor)
      },
    ),
  )
