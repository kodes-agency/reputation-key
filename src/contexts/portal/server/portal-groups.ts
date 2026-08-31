// Portal context — portal group server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPortalGroupInputSchema } from '../application/dto/create-portal-group.dto'
import { updatePortalGroupInputSchema } from '../application/dto/update-portal-group.dto'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  portalGroupId as toPortalGroupId,
  portalId as toPortalId,
} from '#/shared/domain/ids'
import {
  requireMatchingPortalResourceScopes,
  requirePortalResourceScope,
} from './property-scope'

async function authorizePortalGroupResource(
  ctx: AuthContext,
  rawGroupId: string,
  action: 'portal.read' | 'portal.update' | 'portal.delete',
): Promise<void> {
  try {
    await requirePortalResourceScope({
      actor: ctx,
      action,
      capability: action === 'portal.read' ? 'portal.read' : 'portal.write',
      notFound: portalError('group_not_found', 'portal group not found'),
      lookup: () =>
        getContainer().portalPublicApi.management.resolvePortalGroupManagementScope(
          toPortalGroupId(rawGroupId),
        ),
    })
  } catch (error) {
    if (isPortalError(error))
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    throw error
  }
}

async function authorizePortalGroupMembership(
  ctx: AuthContext,
  input: Readonly<{ portalGroupId: string; portalId: string }>,
): Promise<void> {
  try {
    await requireMatchingPortalResourceScopes({
      actor: ctx,
      action: 'portal.update',
      capability: 'portal.write',
      notFound: portalError('portal_not_in_group', 'portal and group do not match'),
      lookups: [
        () =>
          getContainer().portalPublicApi.management.resolvePortalGroupManagementScope(
            toPortalGroupId(input.portalGroupId),
          ),
        () =>
          getContainer().portalPublicApi.management.resolvePortalManagementScope(
            toPortalId(input.portalId),
          ),
      ],
    })
  } catch (error) {
    if (isPortalError(error))
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    throw error
  }
}

// ── createPortalGroup ─────────────────────────────────────────────

export const createPortalGroup = createServerFn({ method: 'POST' })
  .validator(createPortalGroupInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.create',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })

        try {
          const { management: useCases } = getContainer().portalPublicApi
          const group = await useCases.createPortalGroup(data, ctx)
          return { group }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portal-group.createPortalGroup',
    ),
  )

// ── updatePortalGroup ─────────────────────────────────────────────

export const updatePortalGroup = createServerFn({ method: 'POST' })
  .validator(updatePortalGroupInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupResource(ctx, data.portalGroupId, 'portal.update')

        try {
          const { management: useCases } = getContainer().portalPublicApi
          const group = await useCases.updatePortalGroup(data, ctx)
          return { group }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
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
  .validator(listPortalGroupsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.read',
          capability: 'portal.read',
          propertyId: data.propertyId,
        })

        try {
          const { management: useCases } = getContainer().portalPublicApi
          const groups = await useCases.listPortalGroups(data, ctx)
          return { groups }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
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
  .validator(portalGroupIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupResource(ctx, data.portalGroupId, 'portal.read')

        try {
          const { management: useCases } = getContainer().portalPublicApi
          const group = await useCases.getPortalGroup(data, ctx)
          return { group }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'portal-group.getPortalGroup',
    ),
  )

// ── softDeletePortalGroup ─────────────────────────────────────────

export const softDeletePortalGroup = createServerFn({ method: 'POST' })
  .validator(portalGroupIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupResource(ctx, data.portalGroupId, 'portal.delete')

        try {
          const { management: useCases } = getContainer().portalPublicApi
          await useCases.softDeletePortalGroup(data, ctx)
          return { deleted: true, portalGroupId: data.portalGroupId }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
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
  .validator(portalGroupMemberSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupMembership(ctx, data)

        try {
          const { management: useCases } = getContainer().portalPublicApi
          await useCases.addPortalToGroup(data, ctx)
          return { added: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portal-group.addPortalToGroup',
    ),
  )

// ── removePortalFromGroup ─────────────────────────────────────────

export const removePortalFromGroup = createServerFn({ method: 'POST' })
  .validator(portalGroupMemberSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupMembership(ctx, data)

        try {
          const { management: useCases } = getContainer().portalPublicApi
          await useCases.removePortalFromGroup(data, ctx)
          return { removed: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portal-group.removePortalFromGroup',
    ),
  )
