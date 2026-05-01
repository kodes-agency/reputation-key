// Portal context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPortalInputSchema } from '../application/dto/create-portal.dto'
import { updatePortalInputSchema } from '../application/dto/update-portal.dto'
import { isPortalError } from '../domain/errors'
import type { PortalErrorCode } from '../domain/errors'

// ── Error → HTTP status mapping ───────────────────────────────────

export const portalErrorStatus = (code: PortalErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with(
      'portal_not_found',
      'property_not_found',
      'category_not_found',
      'link_not_found',
      () => 404,
    )
    .with('slug_taken', () => 409)
    .with('upload_failed', () => 422)
    .with(
      'invalid_slug',
      'invalid_name',
      'invalid_description',
      'invalid_theme',
      'invalid_threshold',
      'invalid_url',
      'invalid_label',
      'invalid_title',
      () => 400,
    )
    .exhaustive()

// ── Shared Zod validators ──────────────────────────────────────────

const portalIdSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
})

const listPortalsSchema = z.object({
  propertyId: z.string().optional(),
})

// ── createPortal ───────────────────────────────────────────────────

export const createPortal = createServerFn({ method: 'POST' })
  .inputValidator(createPortalInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const portal = await useCases.createPortal(data, ctx)
      return { portal }
    } catch (e) {
      if (isPortalError(e)) throwContextError('PortalError', e, portalErrorStatus(e.code))
      throw e
    }
  })

// ── updatePortal ───────────────────────────────────────────────────

export const updatePortal = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const portal = await useCases.updatePortal(data, ctx)
      return { portal }
    } catch (e) {
      if (isPortalError(e)) throwContextError('PortalError', e, portalErrorStatus(e.code))
      throw e
    }
  })

// ── listPortals ────────────────────────────────────────────────────

export const listPortals = createServerFn({ method: 'GET' })
  .inputValidator(listPortalsSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const portals_list = await useCases.listPortals(data, ctx)
      return { portals: portals_list }
    } catch (e) {
      if (isPortalError(e)) throwContextError('PortalError', e, portalErrorStatus(e.code))
      throw e
    }
  })

// ── getPortal ──────────────────────────────────────────────────────

export const getPortal = createServerFn({ method: 'GET' })
  .inputValidator(portalIdSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const portal = await useCases.getPortal(data, ctx)
      return { portal }
    } catch (e) {
      if (isPortalError(e)) throwContextError('PortalError', e, portalErrorStatus(e.code))
      throw e
    }
  })

// ── deletePortal (soft-delete) ─────────────────────────────────────

export const deletePortal = createServerFn({ method: 'POST' })
  .inputValidator(portalIdSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      await useCases.softDeletePortal(data, ctx)
      return { deleted: true, portalId: data.portalId }
    } catch (e) {
      if (isPortalError(e)) throwContextError('PortalError', e, portalErrorStatus(e.code))
      throw e
    }
  })

// ── Upload schemas ─────────────────────────────────────────────────

const requestUploadSchema = z.object({
  portalId: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.number().min(1),
})

const finalizeUploadSchema = z.object({
  portalId: z.string().min(1),
  key: z.string().min(1),
})

// ── requestUploadUrl ───────────────────────────────────────────────

export const requestUploadUrl = createServerFn({ method: 'POST' })
  .inputValidator(requestUploadSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const result = await useCases.requestUploadUrl(data, ctx)
      return result
    } catch (e) {
      if (isPortalError(e)) throwContextError('PortalError', e, portalErrorStatus(e.code))
      const message = e instanceof Error ? e.message : 'Upload request failed'
      throwContextError('PortalError', { code: 'upload_failed', message }, 422)
    }
  })

// ── finalizeUpload ─────────────────────────────────────────────────

export const finalizeUpload = createServerFn({ method: 'POST' })
  .inputValidator(finalizeUploadSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const result = await useCases.finalizeUpload(data, ctx)
      return result
    } catch (e) {
      if (isPortalError(e)) throwContextError('PortalError', e, portalErrorStatus(e.code))
      const message = e instanceof Error ? e.message : 'Upload finalization failed'
      throwContextError('PortalError', { code: 'upload_failed', message }, 422)
    }
  })
