// Dormant custom-role management server functions (ADR 0001).
// Both the raw Better Auth endpoints and this app-owned write surface are
// hard-blocked for beta. Retained implementation exists only so historical
// definitions can be reconciled without inventing a second write contract.
//
// BQC-5.8 classification: B — catalogued, deliberately dormant entry points.
// Reported as an unused file by fallow and suppressed via .fallowrc.json.
//
// DELIBERATELY UNEXPOSED — reviewed 2026-08-20, decision: keep, do not build UI.
//
// The state of it, so nobody re-derives this:
//   - The dormant write implementation is complete and tested: these three
//     server functions, the create/update/delete use cases, the DTOs, and a
//     transactional adapter that keeps `organizationRole` and
//     `organization_role_policy` in one unit of work.
//   - The table is NOT write-only. `identity-command-store` reads it when
//     validating that an invitation names a real role, so deleting the feature
//     would mean unpicking that check too.
//   - Invitation and member-role DTOs accept beta built-in roles only.
//   - There is no UI. Direct server-function calls still encounter the
//     permanently blocked identity.custom_roles capability before persistence.

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
  .validator(createCustomRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        // The beta-disabled capability denies before the dormant use case can
        // persist. Its permission/escalation checks remain defense-in-depth.
        await requireExecutionAllowed({
          actor: ctx,
          action: 'member.update',
          capability: 'identity.custom_roles',
        })

        try {
          await getContainer().identityPublicApi.requests.createCustomRole(data, ctx)
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
  .validator(updateCustomRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'member.update',
          capability: 'identity.custom_roles',
        })
        try {
          await getContainer().identityPublicApi.requests.updateCustomRole(data, ctx)
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
  .validator(deleteCustomRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'member.update',
          capability: 'identity.custom_roles',
        })
        try {
          await getContainer().identityPublicApi.requests.deleteCustomRole(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.deleteCustomRole',
    ),
  )
