import { createServerFn } from '@tanstack/react-start'
import { command } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { toBrowserProperty } from '../application/dto/browser-property.dto'
import { updatePropertyInputSchema } from '../application/dto/update-property.dto'
import { propertyCommandErrors } from './property-shared'

export const updateProperty = createServerFn({ method: 'POST' })
  .validator(updatePropertyInputSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'property.updateProperty',
        action: 'property.update',
        propertyId: (data) => data.propertyId,
        errors: propertyCommandErrors,
      },
      async ({ data, actor }) => {
        const property = await getContainer().propertyPublicApi.management.updateProperty(
          data,
          actor,
        )
        return { property: toBrowserProperty(property) }
      },
    ),
  )

export { listProperties, getProperty, deleteProperty } from './property-read'
export {
  archiveProperty,
  disconnectPropertyGoogleBinding,
  restoreProperty,
} from './property-lifecycle'
