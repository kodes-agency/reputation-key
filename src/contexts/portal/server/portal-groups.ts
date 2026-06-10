// Portal context — portal group server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPortalGroupInputSchema } from '../application/dto/create-portal-group.dto'
import { updatePortalGroupInputSchema } from '../application/dto/update-portal-group.dto'
import { isPortalError } from '../domain/errors'
import type { PortalErrorCode } from '../domain/errors'

// ── Error → HTTP status mapping ───────────────────────────────────

const portalGroupErrorStatus = (code: PortalErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with(
      'portal_not_found',
      'property_not_found',
      'category_not_found',
      'link_not_found',
      'group_not_found',
      'portal_not_in_group',
      () => 404,
    )
    .with('slug_taken', 'group_name_taken', 'portal_already_grouped', () => 409)
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

// ── createPortalGroup ─────────────────────────────────────────────

export const createPortalGroup = createServerFn({ method: 'POST' })
  .inputValidator(createPortalGroupInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const group = await useCases.createPortalGroup(data, ctx)
          return { group }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalGroupErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portal-group.createPortalGroup',
    ),
  )

// ── updatePortalGroup ─────────────────────────────────────────────

export const updatePortalGroup = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalGroupInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const group = await useCases.updatePortalGroup(data, ctx)
          return { group }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalGroupErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portal-group.updatePortalGroup',
    ),
  )

// ── listPortalGroups ──────────────────────────────────────────────

const listPortalGroupsSchema = z.object({
  propertyId: z.string().min(1),
})

export const listPortalGroups = createServerFn({ method: 'GET' })
  .inputValidator(listPortalGroupsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const groups = await useCases.listPortalGroups(data, ctx)
          return { groups }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalGroupErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'portal-group.listPortalGroups',
    ),
  )

// ── getPortalGroup ────────────────────────────────────────────────

const portalGroupIdSchema = z.object({
  portalGroupId: z.string().min(1, 'Portal Group ID is required'),
})

export const getPortalGroup = createServerFn({ method: 'GET' })
  .inputValidator(portalGroupIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const group = await useCases.getPortalGroup(data, ctx)
          return { group }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalGroupErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'portal-group.getPortalGroup',
    ),
  )

// ── softDeletePortalGroup ─────────────────────────────────────────

export const softDeletePortalGroup = createServerFn({ method: 'POST' })
  .inputValidator(portalGroupIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          await useCases.softDeletePortalGroup(data, ctx)
          return { deleted: true, portalGroupId: data.portalGroupId }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalGroupErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portal-group.softDeletePortalGroup',
    ),
  )

// ── addPortalToGroup ──────────────────────────────────────────────

const portalGroupMemberSchema = z.object({
  portalGroupId: z.string().min(1),
  portalId: z.string().min(1),
})

export const addPortalToGroup = createServerFn({ method: 'POST' })
  .inputValidator(portalGroupMemberSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          await useCases.addPortalToGroup(data, ctx)
          return { added: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalGroupErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portal-group.addPortalToGroup',
    ),
  )

// ── removePortalFromGroup ─────────────────────────────────────────

export const removePortalFromGroup = createServerFn({ method: 'POST' })
  .inputValidator(portalGroupMemberSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          await useCases.removePortalFromGroup(data, ctx)
          return { removed: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalGroupErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portal-group.removePortalFromGroup',
    ),
  )
