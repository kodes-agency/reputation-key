import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { command } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { toBrowserProperty } from '../application/dto/browser-property.dto'
import {
  archivePropertyInputSchema,
  propertyLifecycleTargetSchema,
  type ArchivePropertyDto,
  type PropertyLifecycleTargetDto,
} from '../application/dto/property-lifecycle.dto'
import { propertyCommandErrors } from './property-shared'

export const archivePropertyHandler = createServerOnlyFn(
  command(
    {
      method: 'POST',
      name: 'property.archiveProperty',
      action: 'property.archive',
      propertyId: (data: ArchivePropertyDto) => data.propertyId,
      errors: propertyCommandErrors,
    },
    async ({ data, actor }) => {
      const property = await getContainer().propertyPublicApi.management.archiveProperty(
        data,
        actor,
      )
      return { property: toBrowserProperty(property) }
    },
  ),
)

export const archiveProperty = createServerFn({ method: 'POST' })
  .validator(archivePropertyInputSchema)
  .handler(archivePropertyHandler)

export const restorePropertyHandler = createServerOnlyFn(
  command(
    {
      method: 'POST',
      name: 'property.restoreProperty',
      action: 'property.restore',
      propertyId: (data: PropertyLifecycleTargetDto) => data.propertyId,
      errors: propertyCommandErrors,
    },
    async ({ data, actor }) => {
      const restored = await getContainer().propertyPublicApi.management.restoreProperty(
        data,
        actor,
      )
      return { ...restored, property: toBrowserProperty(restored.property) }
    },
  ),
)

export const restoreProperty = createServerFn({ method: 'POST' })
  .validator(propertyLifecycleTargetSchema)
  .handler(restorePropertyHandler)

export const disconnectPropertyGoogleBindingHandler = createServerOnlyFn(
  command(
    {
      method: 'POST',
      name: 'property.disconnectPropertyGoogleBinding',
      action: 'property.disconnect',
      propertyId: (data: PropertyLifecycleTargetDto) => data.propertyId,
      errors: propertyCommandErrors,
    },
    async ({ data, actor }) => {
      const binding =
        await getContainer().propertyPublicApi.management.disconnectPropertyGoogleBinding(
          data,
          actor,
        )
      return { binding }
    },
  ),
)

export const disconnectPropertyGoogleBinding = createServerFn({ method: 'POST' })
  .validator(propertyLifecycleTargetSchema)
  .handler(disconnectPropertyGoogleBindingHandler)
