// Property context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.
//
// Error handling: throws Error objects (not Response) so TanStack Start can serialize
// them with seroval and re-throw on the client. This ensures mutations actually fail
// and mutation.error is populated.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { propertyErrorStatus } from './property-shared'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPropertyInputSchema } from '../application/dto/create-property.dto'
import { updatePropertyInputSchema } from '../application/dto/update-property.dto'
import { isPropertyError } from '../domain/errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'

// ── createProperty ─────────────────────────────────────────────────

export const createProperty = createServerFn({ method: 'POST' })
  .validator(createPropertyInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        await requireExecutionAllowed({ actor: ctx, action: 'property.create' })

        try {
          const { management } = getContainer().propertyPublicApi
          const property = await management.createProperty(data, ctx)
          return { property }
        } catch (e) {
          if (isPropertyError(e))
            throwContextError('PropertyError', e, propertyErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'property.createProperty',
    ),
  )

// ── updateProperty ─────────────────────────────────────────────────

export const updateProperty = createServerFn({ method: 'POST' })
  .validator(updatePropertyInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        await requireExecutionAllowed({
          actor: ctx,
          action: 'property.update',
          propertyId: data.propertyId,
        })

        try {
          const { management } = getContainer().propertyPublicApi
          const property = await management.updateProperty(data, ctx)
          return { property }
        } catch (e) {
          if (isPropertyError(e))
            throwContextError('PropertyError', e, propertyErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'property.updateProperty',
    ),
  )

// ── Re-exports from split files ────────────────────────────────────

export { listProperties, getProperty, deleteProperty } from './property-read'
export {
  archiveProperty,
  disconnectPropertyGoogleBinding,
  restoreProperty,
} from './property-lifecycle'
