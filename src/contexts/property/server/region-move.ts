// Property context — region move server functions (BQC-4.5 / ADR 0048).
//
// Operator-only region move requests, gated by the policy.admin permission
// (mirrors the BQC-2.7 policy-admin surface). The use case returns a TYPED
// RESULT — a denial is data ({ ok: false, reason }), never an exception:
// beta has one approved cell ('us'), so every real request today resolves to
// a typed denial + operator audit, with no region_moves row written.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { propertyErrorStatus } from './property-shared'
import { isPropertyError } from '../domain/errors'

// ── requestRegionMove (BQC-4.5) ──────────────────────────────────────

export const requestRegionMoveFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      propertyId: z.string().min(1),
      toRegion: z.string().min(1),
      reason: z.string().trim().min(3, 'reason is required'),
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
          const { useCases } = getContainer()
          return await useCases.requestRegionMove(
            {
              propertyId: data.propertyId,
              toRegion: data.toRegion,
              reason: data.reason,
            },
            ctx,
          )
        } catch (e) {
          if (isPropertyError(e))
            throwContextError('PropertyError', e, propertyErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'property.requestRegionMove',
    ),
  )
