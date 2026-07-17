// Property context — property read & delete server functions (split from properties.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { isPropertyError } from '../domain/errors'
import { propertyErrorStatus } from './property-shared'

// ── Shared Zod validators ──────────────────────────────────────────

const propertyIdSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

// ── listProperties ─────────────────────────────────────────────────

export const listProperties = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      // All authenticated roles can list properties (BQC-2.4: policy-wired)
      await requireExecutionAllowed({ actor: ctx, action: 'property.read' })

      try {
        const { useCases } = getContainer()
        const properties = await useCases.listProperties(ctx)
        return { properties }
      } catch (e) {
        if (isPropertyError(e))
          throwContextError('PropertyError', e, propertyErrorStatus(e.code))
        throw catchUntagged(e)
      }
    },
    'GET',
    'property.listProperties',
  ),
)

// ── getProperty ────────────────────────────────────────────────────

export const getProperty = createServerFn({ method: 'GET' })
  .inputValidator(propertyIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'property.read',
          propertyId: data.propertyId,
        })

        try {
          const { useCases } = getContainer()
          const property = await useCases.getProperty(data, ctx)
          return { property }
        } catch (e) {
          if (isPropertyError(e))
            throwContextError('PropertyError', e, propertyErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'property.getProperty',
    ),
  )

// ── deleteProperty ──────────────────────────────────────────────────

export const deleteProperty = createServerFn({ method: 'POST' })
  .inputValidator(propertyIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'property.delete',
          propertyId: data.propertyId,
        })

        try {
          const { useCases } = getContainer()
          await useCases.softDeleteProperty(data, ctx)
          return { deleted: true, propertyId: data.propertyId }
        } catch (e) {
          if (isPropertyError(e))
            throwContextError('PropertyError', e, propertyErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'property.deleteProperty',
    ),
  )
