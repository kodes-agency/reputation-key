// Portal context — portal group server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { commandHandler } from '#/shared/commands/command.server'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { z } from 'zod/v4'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { getContainer } from '#/composition'
import { createPortalGroupInputSchema } from '../application/dto/create-portal-group.dto'
import { updatePortalGroupInputSchema } from '../application/dto/update-portal-group.dto'
import { portalGroupMemberSchema } from '../application/dto/portal-group-membership.dto'
import { portalError } from '../domain/errors'
import { portalCommandErrors } from './portal-command-errors'
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
}

async function authorizePortalGroupMembership(
  ctx: AuthContext,
  input: Readonly<{ portalGroupId: string; portalId: string }>,
): Promise<void> {
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
}

// ── createPortalGroup ─────────────────────────────────────────────

export const createPortalGroup = createServerFn({ method: 'POST' })
  .validator(createPortalGroupInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal-group.createPortalGroup',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.create',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })

        const { management: useCases } = getContainer().portalPublicApi
        const group = await useCases.createPortalGroup(data, ctx)
        return { group }
      },
    ),
  )

// ── updatePortalGroup ─────────────────────────────────────────────

export const updatePortalGroup = createServerFn({ method: 'POST' })
  .validator(updatePortalGroupInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal-group.updatePortalGroup',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupResource(ctx, data.portalGroupId, 'portal.update')

        const { management: useCases } = getContainer().portalPublicApi
        const group = await useCases.updatePortalGroup(data, ctx)
        return { group }
      },
    ),
  )

// ── listPortalGroups ──────────────────────────────────────────────

const listPortalGroupsSchema = z.object({
  propertyId: z.string().min(1),
})

export const listPortalGroups = createServerFn({ method: 'GET' })
  .validator(listPortalGroupsSchema)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal-group.listPortalGroups',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.read',
          capability: 'portal.read',
          propertyId: data.propertyId,
        })

        const { management: useCases } = getContainer().portalPublicApi
        const groups = await useCases.listPortalGroups(data, ctx)
        return { groups }
      },
    ),
  )

const portalGroupIdSchema = z.object({
  portalGroupId: z.string().min(1, 'Portal Group ID is required'),
})

// ── softDeletePortalGroup ─────────────────────────────────────────

export const softDeletePortalGroup = createServerFn({ method: 'POST' })
  .validator(portalGroupIdSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal-group.softDeletePortalGroup',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupResource(ctx, data.portalGroupId, 'portal.delete')

        const { management: useCases } = getContainer().portalPublicApi
        await useCases.softDeletePortalGroup(data, ctx)
        return { deleted: true, portalGroupId: data.portalGroupId }
      },
    ),
  )

// ── addPortalToGroup ──────────────────────────────────────────────

export const addPortalToGroup = createServerFn({ method: 'POST' })
  .validator(portalGroupMemberSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal-group.addPortalToGroup',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupMembership(ctx, data)

        const { management: useCases } = getContainer().portalPublicApi
        await useCases.addPortalToGroup(data, ctx)
        return { added: true }
      },
    ),
  )

// ── removePortalFromGroup ─────────────────────────────────────────

export const removePortalFromGroup = createServerFn({ method: 'POST' })
  .validator(portalGroupMemberSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal-group.removePortalFromGroup',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupMembership(ctx, data)

        const { management: useCases } = getContainer().portalPublicApi
        await useCases.removePortalFromGroup(data, ctx)
        return { removed: true }
      },
    ),
  )

// ── movePortalToGroup ─────────────────────────────────────────────

// A Portal in another group leaves it in the same commit, so it is never in two
// groups; the results it earned stay with the group it left. A Portal in no
// group simply joins.
export const movePortalToGroup = createServerFn({ method: 'POST' })
  .validator(portalGroupMemberSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal-group.movePortalToGroup',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupMembership(ctx, data)

        const { management: useCases } = getContainer().portalPublicApi
        await useCases.movePortalToGroup(data, ctx)
        return { moved: true }
      },
    ),
  )

// ── listPortalGroupHistory ────────────────────────────────────────

export const listPortalGroupHistory = createServerFn({ method: 'GET' })
  .validator(portalGroupIdSchema)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal-group.listPortalGroupHistory',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalGroupResource(ctx, data.portalGroupId, 'portal.read')

        const { management: useCases } = getContainer().portalPublicApi
        const entries = await useCases.listPortalGroupHistory(data, ctx)
        return { entries }
      },
    ),
  )
