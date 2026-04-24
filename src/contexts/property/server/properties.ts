// Property context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.
//
// Error handling: throws Error objects (not Response) so TanStack Start can serialize
// them with seroval and re-throw on the client. This ensures mutations actually fail
// and mutation.error is populated. The error code → HTTP status mapping is kept for
// documentation and future use (e.g., logging/monitoring).

import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext, roleGuard } from '#/shared/auth/middleware'
import { getContainer } from '#/composition'
import { createPropertyInputSchema } from '../application/dto/create-property.dto'
import { updatePropertyInputSchema } from '../application/dto/update-property.dto'
import { isPropertyError } from '../domain/errors'
import type { PropertyError, PropertyErrorCode } from '../domain/errors'

// ── Error → HTTP status mapping ───────────────────────────────────
// Maps domain error codes to HTTP status codes. Used for logging and monitoring.
// The actual HTTP status sent to the client is always 500 for server-thrown Errors
// (TanStack Start's default), but the code is embedded in the Error for the client.

const propertyErrorStatus = (code: PropertyErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('property_not_found', () => 404)
    .with('slug_taken', () => 409)
    .with('invalid_slug', 'invalid_name', 'invalid_timezone', () => 400)
    .exhaustive()

// ── Error throwing ─────────────────────────────────────────────────
// Throws an Error (not Response) so TanStack Start's seroval serialization
// can transport it to the client, where it re-throws and the mutation fails.

const throwPropertyError = (e: PropertyError): never => {
  const status = propertyErrorStatus(e.code)
  const error = new Error(e.message)
  error.name = 'PropertyError'
  ;(error as unknown as Record<string, unknown>).code = e.code
  ;(error as unknown as Record<string, unknown>).status = status
  throw error
}

// ── Shared Zod validators ──────────────────────────────────────────

const propertyIdSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

// ── createProperty ─────────────────────────────────────────────────

export const createProperty = createServerFn({ method: 'POST' })
  .inputValidator(createPropertyInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)
    roleGuard('PropertyManager')(ctx)

    try {
      const { useCases } = getContainer()
      const property = await useCases.createProperty(data, ctx)
      return { property }
    } catch (e) {
      if (isPropertyError(e)) throwPropertyError(e)
      throw e
    }
  })

// ── updateProperty ─────────────────────────────────────────────────

export const updateProperty = createServerFn({ method: 'POST' })
  .inputValidator(updatePropertyInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)
    roleGuard('PropertyManager')(ctx)

    try {
      const { useCases } = getContainer()
      const property = await useCases.updateProperty(data, ctx)
      return { property }
    } catch (e) {
      if (isPropertyError(e)) throwPropertyError(e)
      throw e
    }
  })

// ── listProperties ─────────────────────────────────────────────────

export const listProperties = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = headersFromContext()
  const ctx = await resolveTenantContext(headers)
  // All authenticated roles can list properties

  try {
    const { useCases } = getContainer()
    const properties_list = await useCases.listProperties(ctx)
    return { properties: properties_list }
  } catch (e) {
    if (isPropertyError(e)) throwPropertyError(e)
    throw e
  }
})

// ── getProperty ────────────────────────────────────────────────────

export const getProperty = createServerFn({ method: 'GET' })
  .inputValidator(propertyIdSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const property = await useCases.getProperty(data, ctx)
      return { property }
    } catch (e) {
      if (isPropertyError(e)) throwPropertyError(e)
      throw e
    }
  })

// ── deleteProperty (soft-delete) ───────────────────────────────────

export const deleteProperty = createServerFn({ method: 'POST' })
  .inputValidator(propertyIdSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)
    roleGuard('AccountAdmin')(ctx)

    try {
      const { useCases } = getContainer()
      await useCases.softDeleteProperty(data, ctx)
      return { deleted: true, propertyId: data.propertyId }
    } catch (e) {
      if (isPropertyError(e)) throwPropertyError(e)
      throw e
    }
  })
