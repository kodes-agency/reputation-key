import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { isPropertyError } from '../domain/errors'
import { propertyErrorStatus } from './property-shared'

const listInput = z.object({ propertyId: z.uuid() })
const updateInput = z.object({
  propertyId: z.uuid(),
  managerUserIds: z.array(z.string().min(1).max(255)).max(500),
  expectedRevision: z.number().int().positive(),
})

function rethrow(error: unknown): never {
  if (isPropertyError(error)) {
    throwContextError('PropertyError', error, propertyErrorStatus(error.code))
  }
  throw catchUntagged(error)
}

export const listPropertyResponsibleManagers = createServerFn({ method: 'GET' })
  .validator(listInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await requireExecutionAllowed({
            actor: ctx,
            action: 'property.read',
            propertyId: data.propertyId,
          })
          return await getContainer().useCases.listPropertyResponsibleManagers(data, ctx)
        } catch (error) {
          rethrow(error)
        }
      },
      'GET',
      'property.listPropertyResponsibleManagers',
    ),
  )

export const updatePropertyResponsibleManagers = createServerFn({ method: 'POST' })
  .validator(updateInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await requireExecutionAllowed({
            actor: ctx,
            action: 'property.update',
            propertyId: data.propertyId,
          })
          return await getContainer().useCases.updatePropertyResponsibleManagers(
            data,
            ctx,
          )
        } catch (error) {
          rethrow(error)
        }
      },
      'POST',
      'property.updatePropertyResponsibleManagers',
    ),
  )
