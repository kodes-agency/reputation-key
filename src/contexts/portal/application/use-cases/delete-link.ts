// Portal context — delete link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { canForContext } from '#/shared/domain/permissions'
import { portalLinkId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'
import { portalLinkDeleted } from '../../domain/events'

export type DeleteLinkInput = Readonly<{
  linkId: string
}>

export type DeleteLinkDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const deleteLink =
  (deps: DeleteLinkDeps) =>
  async (input: DeleteLinkInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot delete portal links')
    }

    const target = await deps.portalLinkRepo.findLinkCommandTarget(
      ctx.organizationId,
      portalLinkId(input.linkId),
    )
    if (!target) {
      throw portalError('link_not_found', 'link not found')
    }
    const existing = target.link
    // Enforce property-assignment scoping (D6-001.)
    const portal = await assertPortalPropertyAccess(
      deps.portalRepo,
      deps.staffPublicApi,
      ctx,
      'portal.update',
      existing.portalId,
    )

    const occurredAt = deps.clock()
    const expectedPortalUpdatedAt = target.portalUpdatedAt ?? portal.updatedAt
    const revision = nextPortalCommandAt(occurredAt, expectedPortalUpdatedAt)
    await deps.commandStore.deletePortalLink({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: existing.portalId,
      expectedPortalUpdatedAt,
      revision,
      occurredAt,
      linkId: existing.id,
      categoryId: existing.categoryId,
      event: portalLinkDeleted({
        portalId: existing.portalId,
        linkId: existing.id,
        categoryId: existing.categoryId,
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })
  }

export type DeleteLink = ReturnType<typeof deleteLink>
