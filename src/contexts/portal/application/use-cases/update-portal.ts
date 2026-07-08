// Portal context — update portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { Portal, PortalTheme } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdatePortalInput } from '../dto/update-portal.dto'
export type { UpdatePortalInput }
import { canForContext } from '#/shared/domain/permissions'
import { portalId as toPortalId, type OrganizationId } from '#/shared/domain/ids'
import {
  validatePortalName,
  validateSlug,
  validateDescription,
  validatePortalTheme,
  validateSmartRoutingThreshold,
} from '../../domain/rules'
import { portalError } from '../../domain/errors'
import { portalUpdated } from '../../domain/events'
import type { Result } from '#/shared/domain'
import type { PortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type UpdatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
}>

type PortalPatch = {
  name: string
  slug: string
  description: string | null
  theme: PortalTheme
  smartRoutingEnabled: boolean
  smartRoutingThreshold: number
  isActive: boolean
}

function unwrap<T>(r: Result<T, PortalError>): T {
  if (r.isErr()) throw r.error
  return r.value
}

async function buildPortalPatch(
  input: UpdatePortalInput,
  existing: Portal,
  repo: PortalRepository,
  orgId: OrganizationId,
): Promise<PortalPatch> {
  const patch: PortalPatch = {
    name:
      input.name !== undefined ? unwrap(validatePortalName(input.name)) : existing.name,
    slug: existing.slug,
    description:
      input.description !== undefined
        ? unwrap(validateDescription(input.description))
        : existing.description,
    theme:
      input.theme !== undefined
        ? unwrap(validatePortalTheme(input.theme))
        : existing.theme,
    smartRoutingEnabled: input.smartRoutingEnabled ?? existing.smartRoutingEnabled,
    smartRoutingThreshold:
      input.smartRoutingThreshold !== undefined
        ? unwrap(validateSmartRoutingThreshold(input.smartRoutingThreshold))
        : existing.smartRoutingThreshold,
    isActive: input.isActive ?? existing.isActive,
  }

  if (input.slug !== undefined && input.slug !== existing.slug) {
    patch.slug = unwrap(validateSlug(input.slug))
    if (
      await repo.slugExists(orgId, existing.propertyId as string, patch.slug, existing.id)
    ) {
      throw portalError('slug_taken', 'a portal with this slug already exists')
    }
  }

  return patch
}

function hasPortalChanges(existing: Portal, patch: PortalPatch): boolean {
  return (
    patch.name !== existing.name ||
    patch.slug !== existing.slug ||
    patch.description !== existing.description ||
    JSON.stringify(patch.theme) !== JSON.stringify(existing.theme) ||
    patch.smartRoutingEnabled !== existing.smartRoutingEnabled ||
    patch.smartRoutingThreshold !== existing.smartRoutingThreshold ||
    patch.isActive !== existing.isActive
  )
}

function buildUpdatedPortal(
  existing: Portal,
  patch: PortalPatch,
  updatedAt: Date,
): Portal {
  return {
    ...existing,
    ...patch,
    updatedAt,
  }
}

export const updatePortal =
  (deps: UpdatePortalDeps) =>
  async (input: UpdatePortalInput, ctx: AuthContext): Promise<Portal> => {
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot edit portals')
    }

    const pid = toPortalId(input.portalId)
    const existing = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!existing) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(
      deps.staffPublicApi,
      ctx,
      'portal.update',
      existing.propertyId,
    )

    const patch = await buildPortalPatch(
      input,
      existing,
      deps.portalRepo,
      ctx.organizationId,
    )

    if (!hasPortalChanges(existing, patch)) {
      return existing
    }

    const updatedAt = deps.clock()
    await deps.portalRepo.update(ctx.organizationId, pid, {
      ...patch,
      updatedAt,
    })

    await deps.events.emit(
      portalUpdated({
        portalId: pid,
        organizationId: ctx.organizationId,
        name: patch.name,
        slug: patch.slug,
        occurredAt: updatedAt,
      }),
    )

    return buildUpdatedPortal(existing, patch, updatedAt)
  }

// fallow-ignore-next-line unused-type
export type UpdatePortal = ReturnType<typeof updatePortal>
