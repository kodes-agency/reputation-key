import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  archivePropertyInputSchema,
  propertyLifecycleTargetSchema,
} from '../application/dto/property-lifecycle.dto'
import { isPropertyError } from '../domain/errors'
import { propertyErrorStatus } from './property-shared'

export const archivePropertyHandler = createServerOnlyFn(
  async ({
    data,
  }: {
    data: import('../application/dto/property-lifecycle.dto').ArchivePropertyDto
  }) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    await requireExecutionAllowed({
      actor: ctx,
      action: 'property.archive',
      propertyId: data.propertyId,
    })
    try {
      const property = await getContainer().propertyPublicApi.management.archiveProperty(
        data,
        ctx,
      )
      return { property }
    } catch (error) {
      if (isPropertyError(error)) {
        throwContextError('PropertyError', error, propertyErrorStatus(error.code))
      }
      throw catchUntagged(error)
    }
  },
)

export const archiveProperty = createServerFn({ method: 'POST' })
  .validator(archivePropertyInputSchema)
  .handler(tracedHandler(archivePropertyHandler, 'POST', 'property.archiveProperty'))

export const restorePropertyHandler = createServerOnlyFn(
  async ({
    data,
  }: {
    data: import('../application/dto/property-lifecycle.dto').PropertyLifecycleTargetDto
  }) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    await requireExecutionAllowed({
      actor: ctx,
      action: 'property.restore',
      propertyId: data.propertyId,
    })
    try {
      return await getContainer().propertyPublicApi.management.restoreProperty(data, ctx)
    } catch (error) {
      if (isPropertyError(error)) {
        throwContextError('PropertyError', error, propertyErrorStatus(error.code))
      }
      throw catchUntagged(error)
    }
  },
)

export const restoreProperty = createServerFn({ method: 'POST' })
  .validator(propertyLifecycleTargetSchema)
  .handler(tracedHandler(restorePropertyHandler, 'POST', 'property.restoreProperty'))

export const disconnectPropertyGoogleBindingHandler = createServerOnlyFn(
  async ({
    data,
  }: {
    data: import('../application/dto/property-lifecycle.dto').PropertyLifecycleTargetDto
  }) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    await requireExecutionAllowed({
      actor: ctx,
      action: 'property.disconnect',
      propertyId: data.propertyId,
    })
    try {
      const binding =
        await getContainer().propertyPublicApi.management.disconnectPropertyGoogleBinding(
          data,
          ctx,
        )
      return { binding }
    } catch (error) {
      if (isPropertyError(error)) {
        throwContextError('PropertyError', error, propertyErrorStatus(error.code))
      }
      throw catchUntagged(error)
    }
  },
)

export const disconnectPropertyGoogleBinding = createServerFn({ method: 'POST' })
  .validator(propertyLifecycleTargetSchema)
  .handler(
    tracedHandler(
      disconnectPropertyGoogleBindingHandler,
      'POST',
      'property.disconnectPropertyGoogleBinding',
    ),
  )
