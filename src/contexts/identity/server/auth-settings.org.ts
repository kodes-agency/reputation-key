// Create organization server function (auth-settings context).
// Extracted from auth-settings.ts to keep each file ≤150 lines.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { requireAuth } from '#/shared/auth/middleware'
import { z } from 'zod/v4'
import { handleAuthError } from './auth-settings.helpers'

// ── Create organization ────────────────────────────────────────────
// F045 NOTE: No rate limiting on createOrganization. If abuse is detected
// (e.g., automated org spamming), add a per-IP or per-user rate limit here.

const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
})

export const createOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(createOrganizationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        await requireAuth(headers)
        const auth = getAuth()

        try {
          await auth.api.createOrganization({
            headers,
            body: {
              name: data.name,
              slug: data.slug,
            },
          })
        } catch (e) {
          handleAuthError(
            e,
            'IdentityError',
            'org_setup_failed',
            'Failed to create organization.',
          )
        }
      },
      'POST',
      'identity.createOrganization',
    ),
  )
