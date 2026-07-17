// Identity context — policy administration server functions (BQC-2.7).
//
// Authenticated, least-privilege policy operations for org admins
// (AccountAdmin via the policy.admin permission — owner-only by default).
// Every mutation requires reason (and ticket/reference where applicable)
// and writes a content-free audit outcome. The diagnostic is read-only and
// explains decisions without PII or secret configuration.
//
// Global kill switches stay env-managed (BQC-0.4); BQC-7 owns general
// runtime/redrive/repair operator commands — this surface is policy
// administration only.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { listAllCapabilities, type Capability } from '#/shared/auth/beta-capabilities'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import type { Permission } from '#/shared/domain/permissions'

// ── Validation error mapping ─────────────────────────────────────────

const VALIDATION_PATTERN =
  /required|unknown capability|is core|is blocked|not a member|in the future/

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

// ── getPolicyState (read) ────────────────────────────────────────────

export const getPolicyStateFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      await requireExecutionAllowed({ actor: ctx, action: 'policy.admin' })

      try {
        const { policyAdmin } = getContainer()
        return await policyAdmin.getOrgPolicyState(ctx.organizationId as string)
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.getPolicyState',
  ),
)

// ── setOrgCapability ─────────────────────────────────────────────────

export const setOrgCapabilityFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      capability: z
        .string()
        .refine(
          (c) => listAllCapabilities().includes(c as Capability),
          'unknown capability',
        ),
      enabled: z.boolean(),
      reason: reasonSchema,
    }),
  )
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'policy.admin' })

        try {
          const { policyAdmin } = getContainer()
          await policyAdmin.setOrgCapability({
            organizationId: ctx.organizationId as string,
            capability: data.capability as Capability,
            enabled: data.enabled,
            reason: data.reason,
            actorUserId: ctx.userId as string,
            now: new Date(),
          })
          return { ok: true }
        } catch (e) {
          mapPolicyAdminError(e)
        }
      },
      'POST',
      'identity.setOrgCapability',
    ),
  )

// ── setOrgSuspension ─────────────────────────────────────────────────

export const setOrgSuspensionFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ suspend: z.boolean(), reason: reasonSchema, ticketRef: ticketSchema }),
  )
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'policy.admin' })

        try {
          const { policyAdmin } = getContainer()
          await policyAdmin.setOrgSuspension({
            organizationId: ctx.organizationId as string,
            suspend: data.suspend,
            reason: data.reason,
            ticketRef: data.ticketRef,
            actorUserId: ctx.userId as string,
            now: new Date(),
          })
          return { ok: true }
        } catch (e) {
          mapPolicyAdminError(e)
        }
      },
      'POST',
      'identity.setOrgSuspension',
    ),
  )

// ── setPropertySuspension ────────────────────────────────────────────

export const setPropertySuspensionFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      propertyId: z.string().min(1),
      suspend: z.boolean(),
      reason: reasonSchema,
      ticketRef: ticketSchema,
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
          await policyAdmin.setPropertySuspension({
            organizationId: ctx.organizationId as string,
            propertyId: data.propertyId,
            suspend: data.suspend,
            reason: data.reason,
            ticketRef: data.ticketRef,
            actorUserId: ctx.userId as string,
            now: new Date(),
          })
          return { ok: true }
        } catch (e) {
          mapPolicyAdminError(e)
        }
      },
      'POST',
      'identity.setPropertySuspension',
    ),
  )

// ── grantPropertyAccess ──────────────────────────────────────────────

export const grantPropertyAccessFn = createServerFn({ method: 'POST' })
  .inputValidator(
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
          const { policyAdmin } = getContainer()
          await policyAdmin.grantPropertyAccessOp({
            organizationId: ctx.organizationId as string,
            propertyId: data.propertyId,
            userId: data.userId,
            reason: data.reason,
            ticketRef: data.ticketRef,
            expiresAt: data.expiresAt,
            actorUserId: ctx.userId as string,
            now: new Date(),
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
  .inputValidator(
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
            now: new Date(),
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
  .inputValidator(
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
          const { policyAdmin } = getContainer()
          return await policyAdmin.explainPolicyDecision({
            organizationId: ctx.organizationId as string,
            action: data.action as Permission,
            propertyId: data.propertyId,
            userId: data.userId ?? (ctx.userId as string),
            now: new Date(),
          })
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'identity.explainPolicyDecision',
    ),
  )
