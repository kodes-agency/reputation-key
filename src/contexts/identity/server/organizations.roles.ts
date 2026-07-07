// Custom role management server functions (ADR 0001, app-owned role writes).
// The raw BA create-role endpoint is permanently blocked; this is the only write path.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { canForContext } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import { createCustomRoleInputSchema } from '../application/dto/custom-role.dto'

// ── Create custom role ────────────────────────────────────────────

export const createCustomRole = createServerFn({ method: 'POST' })
  .inputValidator(createCustomRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        // Defense-in-depth; the use case re-checks + enforces escalation.
        if (!canForContext(ctx, 'member.update')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'Insufficient permissions to manage roles' },
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          await useCases.createCustomRole(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.createCustomRole',
    ),
  )
