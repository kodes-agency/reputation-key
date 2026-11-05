import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { command } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { toBrowserProperty } from '../application/dto/browser-property.dto'
import { PROPERTY_DELETION_UNAVAILABLE_MESSAGE, propertyError } from '../domain/errors'
import { propertyCommandErrors } from './property-shared'

const propertyIdSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

export const listProperties = createServerFn({ method: 'GET' }).handler(
  command(
    {
      method: 'GET',
      name: 'property.listProperties',
      action: 'property.read',
      errors: propertyCommandErrors,
    },
    async ({ actor }) => {
      const properties =
        await getContainer().propertyPublicApi.management.listProperties(actor)
      return { properties: properties.map(toBrowserProperty) }
    },
  ),
)

export const getProperty = createServerFn({ method: 'GET' })
  .validator(propertyIdSchema)
  .handler(
    command(
      {
        method: 'GET',
        name: 'property.getProperty',
        action: 'property.read',
        propertyId: (data) => data.propertyId,
        errors: propertyCommandErrors,
      },
      async ({ data, actor }) => {
        const property = await getContainer().propertyPublicApi.management.getProperty(
          data,
          actor,
        )
        return { property: toBrowserProperty(property) }
      },
    ),
  )

export const deleteProperty = createServerFn({ method: 'POST' })
  .validator(propertyIdSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'property.deleteProperty',
        action: 'property.delete',
        propertyId: (data) => data.propertyId,
        errors: propertyCommandErrors,
      },
      async () => {
        // Keep the stale-client refusal without any edge to destructive services.
        throw propertyError('forbidden', PROPERTY_DELETION_UNAVAILABLE_MESSAGE)
      },
    ),
  )
