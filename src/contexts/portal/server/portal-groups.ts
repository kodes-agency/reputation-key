// Portal context — PortalGroup server functions
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import {
  createPortalGroupSchema,
  updatePortalGroupSchema,
  deletePortalGroupSchema,
  listPortalGroupsSchema,
} from '../application/dto/portal-group.dto'
import { isPortalError, portalErrorStatus } from '../domain/errors'

// ── createPortalGroup ───────────────────────────────────────────────

export const createPortalGroup = createServerFn({ method: 'POST' })
  .inputValidator(createPortalGroupSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const group = await useCases.createPortalGroup(data, ctx)
          return { group }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portal.createPortalGroup',
    ),
  )

// ── updatePortalGroup ───────────────────────────────────────────────

export const updatePortalGroup = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalGroupSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const group = await useCases.updatePortalGroup(data, ctx)
          return { group }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portal.updatePortalGroup',
    ),
  )

// ── deletePortalGroup ───────────────────────────────────────────────

export const deletePortalGroup = createServerFn({ method: 'POST' })
  .inputValidator(deletePortalGroupSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          await useCases.deletePortalGroup(data, ctx)
          return { deleted: true, groupId: data.groupId }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portal.deletePortalGroup',
    ),
  )

// ── listPortalGroups ────────────────────────────────────────────────

export const listPortalGroups = createServerFn({ method: 'GET' })
  .inputValidator(listPortalGroupsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const groups = await useCases.listPortalGroups(data, ctx)
          return { groups }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'portal.listPortalGroups',
    ),
  )
