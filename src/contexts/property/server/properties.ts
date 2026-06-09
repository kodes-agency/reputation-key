// Property context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.
//
// Error handling: throws Error objects (not Response) so TanStack Start can serialize
// them with seroval and re-throw on the client. This ensures mutations actually fail
// and mutation.error is populated.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPropertyInputSchema } from '../application/dto/create-property.dto'
import { updatePropertyInputSchema } from '../application/dto/update-property.dto'
import { isPropertyError } from '../domain/errors'
import type { PropertyErrorCode } from '../domain/errors'

// ── Error → HTTP status mapping ───────────────────────────────────

export const propertyErrorStatus = (code: PropertyErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('property_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('slug_taken', () => HTTP_STATUS.CONFLICT)
    .with(
      'invalid_slug',
      'invalid_name',
      'invalid_timezone',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .exhaustive()

// ── createProperty ─────────────────────────────────────────────────

export const createProperty = createServerFn({ method: 'POST' })
  .inputValidator(createPropertyInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const property = await useCases.createProperty(data, ctx)
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
  .inputValidator(updatePropertyInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const property = await useCases.updateProperty(data, ctx)
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
