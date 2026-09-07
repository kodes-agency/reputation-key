// Identity context — audited PropertyAccessGrant administration.
//
// The capability configuration is static. This surface retains only grant,
// revocation, and content-free decision diagnostics for AccountAdmins.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { capabilityForPermission } from '#/shared/auth/capability-for-permission'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import type { Permission } from '#/shared/domain/permissions'

// ── Validation error mapping ─────────────────────────────────────────

const VALIDATION_PATTERN = /required|not a member|not found in organization|in the future/

function mapPolicyAdminError(e: unknown): never {
  if (e instanceof Error && VALIDATION_PATTERN.test(e.message)) {
    throwContextError(
      'PolicyAdminError',
      { code: 'invalid_operation', message: e.message },
      400,
    )
  }
  throw catchUntagged(e)
}

const reasonSchema = z.string().trim().min(3, 'reason is required')
const ticketSchema = z.string().trim().min(2, 'ticket/reference is required')

// ── grantPropertyAccess ──────────────────────────────────────────────

export const grantPropertyAccessFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      userId: z.string().min(1),
      propertyId: z.string().min(1),
      reason: reasonSchema,
      ticketRef: ticketSchema,
      expiresAt: z.coerce.date().optional(),
    }),
  )
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'policy.admin',
          propertyId: data.propertyId,
        })

        try {
          const { policyAdmin, clock } = getContainer()
          await policyAdmin.grantPropertyAccessOp({
            organizationId: ctx.organizationId as string,
            propertyId: data.propertyId,
            userId: data.userId,
            reason: data.reason,
            ticketRef: data.ticketRef,
            expiresAt: data.expiresAt,
            actorUserId: ctx.userId as string,
            now: clock(),
          })
          return { ok: true }
        } catch (e) {
          mapPolicyAdminError(e)
        }
      },
      'POST',
      'identity.grantPropertyAccess',
    ),
  )

// ── revokePropertyAccess ─────────────────────────────────────────────

export const revokePropertyAccessFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      userId: z.string().min(1),
      propertyId: z.string().min(1),
      reason: reasonSchema,
    }),
  )
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'policy.admin',
          propertyId: data.propertyId,
        })

        try {
          const { policyAdmin } = getContainer()
          await policyAdmin.revokePropertyAccessOp({
            organizationId: ctx.organizationId as string,
            propertyId: data.propertyId,
            userId: data.userId,
            reason: data.reason,
            actorUserId: ctx.userId as string,
          })
          return { ok: true }
        } catch (e) {
          mapPolicyAdminError(e)
        }
      },
      'POST',
      'identity.revokePropertyAccess',
    ),
  )

// ── explainPolicyDecision (read-only diagnostic) ─────────────────────

export const explainPolicyDecisionFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      action: z.string(),
      propertyId: z.string().optional(),
      userId: z.string().optional(),
    }),
  )
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'policy.admin',
          propertyId: data.propertyId,
        })

        try {
          const { policyAdmin, clock } = getContainer()
          const action = data.action as Permission
          const organizationId = ctx.organizationId as string
          const userId = data.userId ?? (ctx.userId as string)
          const explanation = await policyAdmin.explainPolicyDecision({
            organizationId,
            action,
            propertyId: data.propertyId,
            userId,
            now: clock(),
          })
          const capabilityRefusal = await policyAdmin.explainCapabilityRefusal({
            capability: capabilityForPermission(action),
            organizationId,
            propertyId: data.propertyId,
            role: ctx.role,
            userId,
            permissionScope: {
              allowed: explanation.checks.permission.allowed,
              scopeOutcome: explanation.checks.scope.outcome,
            },
          })
          return { ...explanation, capabilityRefusal }
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'identity.explainPolicyDecision',
    ),
  )
