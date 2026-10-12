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
  .validator(createOrganizationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const user = await requireAuth(headers)
        // organization.create is permanently blocked for beta. Keep the
        // dormant implementation behind this server-side boundary.
        assertGlobalCapability('organization.create')
        const auth = getAuth()

        try {
          // The provider refuses every session-bound creation
          // (allowUserToCreateOrganization: false, shared/auth/auth.ts), so
          // this path creates as a system action: it names the signed-in user
          // and passes no session. A system action has no session to switch,
          // so the new Organization is made active for the caller here.
          const created = await auth.api.createOrganization({
            body: {
              name: data.name,
              slug: data.slug,
              userId: user.id,
            },
          })
          await auth.api.setActiveOrganization({
            headers,
            body: { organizationId: created.id },
          })
        } catch (e) {
          const { getContainer } = await import('#/composition')
          handleAuthError(
            getContainer().logger,
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
