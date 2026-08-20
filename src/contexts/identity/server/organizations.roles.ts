// Custom role management server functions (ADR 0001, app-owned role writes).
// The raw BA create-role endpoint is permanently blocked; this is the only write path.
//
// BQC-5.8 classification: B — catalogued entry points (entry-point-catalogue)
// awaiting UI wiring. Reported as an unused file by fallow and suppressed via
// .fallowrc.json ignoreFindings. Owner: BQC-6/7. Expiry: BQC-7 close.
//
// DELIBERATELY UNEXPOSED — reviewed 2026-08-20, decision: keep, do not build UI.
//
// The state of it, so nobody re-derives this:
//   - The write path is complete and tested: these two server functions, the
//     create/delete use cases, the DTOs, and a transactional adapter that keeps
//     `organizationRole` and `organization_role_policy` in one unit of work.
//   - The table is NOT write-only. `identity-command-store` reads it when
//     validating that an invitation names a real role, so deleting the feature
//     would mean unpicking that check too.
//   - There is no UI anywhere. Nothing under src/components or src/routes
//     references custom roles, so the only way to reach this today is calling
//     the server function directly.
//
// It is therefore a reachable, authorized, unadvertised capability rather than
// dead code — which is why fallow flags it and why the suppression is correct.
// Exposing it is a product decision (custom role management under settings),
// not a cleanup task, and it is not scheduled.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import {
  createCustomRoleInputSchema,
  updateCustomRoleInputSchema,
  deleteCustomRoleInputSchema,
} from '../application/dto/custom-role.dto'

// ── Create custom role ────────────────────────────────────────────

export const createCustomRole = createServerFn({ method: 'POST' })
  .inputValidator(createCustomRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        // Defense-in-depth; the use case re-checks + enforces escalation.
        await requireExecutionAllowed({ actor: ctx, action: 'member.update' })

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

export const updateCustomRole = createServerFn({ method: 'POST' })
  .inputValidator(updateCustomRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'member.update' })
        try {
          const { useCases } = getContainer()
          await useCases.updateCustomRole(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.updateCustomRole',
    ),
  )

export const deleteCustomRole = createServerFn({ method: 'POST' })
  .inputValidator(deleteCustomRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'member.update' })
        try {
          const { useCases } = getContainer()
          await useCases.deleteCustomRole(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.deleteCustomRole',
    ),
  )
