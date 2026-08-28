// LIF-01-T21 — leave-Organization server functions.
//
// Leaving is a normal, capability-gated operation, so unlike the Closure
// Center these DO pass through `requireExecutionAllowed`: `identity.leave_org`
// is a real Permission and a suspended Organization should not be losing
// members while its closure is pending.
//
// The session invalidation contract is what makes this more than a delete: the
// command store removes every Better Auth session row for the leaver in the
// same transaction as the membership deletion, so the very next request
// carrying the old cookie resolves no session and is rejected rather than
// served from a cached tenant context. `resetTenantCache()` closes the
// in-process memo that would otherwise keep answering for a few seconds.

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resetTenantCache, resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import { OFFBOARDING_RESPONSIBILITY_KINDS } from '../application/ports/member-offboarding.port'
import { OutstandingResponsibilitiesError } from '../application/use-cases/leave-organization'

export const leaveOrganizationInputSchema = z.object({
  transfers: z
    .array(
      z.object({
        kind: z.enum(OFFBOARDING_RESPONSIBILITY_KINDS),
        resourceId: z.string().min(1).max(200),
        toUserId: z.string().min(1).max(255),
      }),
    )
    .max(500),
})
export type LeaveOrganizationDto = z.infer<typeof leaveOrganizationInputSchema>

/**
 * The transfer worklist the dialog renders. Kinds and identifiers only; the
 * client resolves display names through the surfaces that already own them.
 */
export const listOutstandingResponsibilitiesHandler = createServerOnlyFn(async () => {
  const ctx = await resolveTenantContext(await headersFromContext())
  await requireExecutionAllowed({ actor: ctx, action: 'identity.leave_org' })
  try {
    return {
      outstanding:
        await getContainer().identityPublicApi.offboardingFacts.listOutstanding(
          ctx.organizationId as string,
          ctx.userId as string,
        ),
    }
  } catch (error) {
    if (isIdentityError(error)) throwIdentityError(error)
    throw catchUntagged(error)
  }
})

export const listOutstandingResponsibilitiesFn = createServerFn({
  method: 'GET',
}).handler(
  tracedHandler(
    listOutstandingResponsibilitiesHandler,
    'GET',
    'identity.listOutstandingResponsibilities',
  ),
)

export const leaveOrganizationHandler = createServerOnlyFn(
  async ({ data }: Readonly<{ data: LeaveOrganizationDto }>) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    await requireExecutionAllowed({ actor: ctx, action: 'identity.leave_org' })
    try {
      const result = await getContainer().identityPublicApi.requests.leaveOrganization(
        data,
        ctx,
      )
      // The durable sessions are already gone. Drop the per-process tenant memo
      // too, so no in-flight request in this process answers from stale
      // authority for the remainder of the cache TTL.
      resetTenantCache()
      return result
    } catch (error) {
      if (error instanceof OutstandingResponsibilitiesError) {
        // Surfaced as data-bearing validation rather than a 500: the dialog
        // needs the exact worklist to render the transfer step.
        throwIdentityError({
          _tag: 'IdentityError',
          code: 'validation_error',
          message: error.message,
          context: { outstanding: error.outstanding },
        })
      }
      if (isIdentityError(error)) throwIdentityError(error)
      throw catchUntagged(error)
    }
  },
)

export const leaveOrganizationFn = createServerFn({ method: 'POST' })
  .validator(leaveOrganizationInputSchema)
  .handler(tracedHandler(leaveOrganizationHandler, 'POST', 'identity.leaveOrganization'))
