import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { command } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { propertyCommandErrors } from './property-shared'

const listInput = z.object({ propertyId: z.uuid() })
const updateInput = z.object({
  propertyId: z.uuid(),
  managerUserIds: z.array(z.string().min(1).max(255)).max(500),
  expectedRevision: z.number().int().positive(),
})

export const listPropertyResponsibleManagers = createServerFn({ method: 'GET' })
  .validator(listInput)
  .handler(
    command(
      {
        method: 'GET',
        name: 'property.listPropertyResponsibleManagers',
        action: 'property.read',
        propertyId: (data) => data.propertyId,
        errors: propertyCommandErrors,
      },
      async ({ data, actor }) =>
        getContainer().propertyPublicApi.management.listPropertyResponsibleManagers(
          data,
          actor,
        ),
    ),
  )

export const updatePropertyResponsibleManagers = createServerFn({ method: 'POST' })
  .validator(updateInput)
  .handler(
    command(
      {
        method: 'POST',
        name: 'property.updatePropertyResponsibleManagers',
        action: 'property.update',
        propertyId: (data) => data.propertyId,
        errors: propertyCommandErrors,
      },
      async ({ data, actor }) =>
        getContainer().propertyPublicApi.management.updatePropertyResponsibleManagers(
          data,
          actor,
        ),
    ),
  )
