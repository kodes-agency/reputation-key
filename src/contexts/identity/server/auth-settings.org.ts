// Create organization server function (auth-settings context).
// Extracted from auth-settings.ts to keep each file ≤150 lines.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { requireAuth } from '#/shared/auth/middleware'
import { assertGlobalCapability } from '#/shared/auth/beta-capabilities'
import { z } from 'zod/v4'
import { validateSlug } from '../domain/rules'
import { handleAuthError } from './auth-settings.helpers'

// ── Create organization ────────────────────────────────────────────
// F045 NOTE: No rate limiting on createOrganization. If abuse is detected
// (e.g., automated org spamming), add a per-IP or per-user rate limit here.

const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .superRefine((s, ctx) => {
      // Route through the domain rule so this server fn cannot persist slugs
      // the domain rejects (the old inline regex accepted single-char slugs
      // and leading/trailing hyphens — weaker than validateSlug).
      const result = validateSlug(s)
      if (result.isErr()) {
        ctx.addIssue({ code: 'custom', message: result.error.message })
      }
    }),
})

export const createOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(createOrganizationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        await requireAuth(headers)
        // organization.create is non-core (ADR 0032): creating another org
        // while authenticated follows the same global posture as
        // registerUserAndOrg — previously unchecked (F045).
        assertGlobalCapability('organization.create')
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
