// Property context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.
//
// Error handling: throws Error objects (not Response) so TanStack Start can serialize
// them with seroval and re-throw on the client. This ensures mutations actually fail
// and mutation.error is populated.

import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPropertyInputSchema } from '../application/dto/create-property.dto'
import { updatePropertyInputSchema } from '../application/dto/update-property.dto'
import { isPropertyError } from '../domain/errors'
import type { PropertyErrorCode } from '../domain/errors'

// ── Error → HTTP status mapping ───────────────────────────────────

export const propertyErrorStatus = (code: PropertyErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('property_not_found', () => 404)
    .with('slug_taken', () => 409)
    .with('invalid_slug', 'invalid_name', 'invalid_timezone', () => 400)
    .exhaustive()

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

    try {
      const { useCases } = getContainer()
      const property = await useCases.createProperty(data, ctx)
      return { property }
    } catch (e) {
      if (isPropertyError(e))
        throwContextError('PropertyError', e, propertyErrorStatus(e.code))
      throw e
    }
  })

// ── updateProperty ─────────────────────────────────────────────────

export const updateProperty = createServerFn({ method: 'POST' })
  .inputValidator(updatePropertyInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const property = await useCases.updateProperty(data, ctx)
      return { property }
    } catch (e) {
      if (isPropertyError(e))
        throwContextError('PropertyError', e, propertyErrorStatus(e.code))
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
    if (isPropertyError(e))
      throwContextError('PropertyError', e, propertyErrorStatus(e.code))
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
      if (isPropertyError(e))
        throwContextError('PropertyError', e, propertyErrorStatus(e.code))
      throw e
    }
  })

// ── deleteProperty (soft-delete) ───────────────────────────────────

export const deleteProperty = createServerFn({ method: 'POST' })
  .inputValidator(propertyIdSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      await useCases.softDeleteProperty(data, ctx)
      return { deleted: true, propertyId: data.propertyId }
    } catch (e) {
      if (isPropertyError(e))
        throwContextError('PropertyError', e, propertyErrorStatus(e.code))
      throw e
    }
  })
