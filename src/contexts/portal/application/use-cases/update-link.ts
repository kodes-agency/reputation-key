// Portal context — update link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLink } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { validateLinkLabel, isValidExternalUrl } from '../../domain/rules'
import { canForContext } from '#/shared/domain/permissions'
import { portalLinkId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'
import { portalLinkUpdated } from '../../domain/events'

export type UpdateLinkInput = Readonly<{
  linkId: string
  label?: string
  url?: string
  iconKey?: string | null
}>

export type UpdateLinkDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const updateLink =
  (deps: UpdateLinkDeps) =>
  async (input: UpdateLinkInput, ctx: AuthContext): Promise<PortalLink> => {
    // 1. Authorize
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot update portal links')
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

    let validatedLabel: string | undefined
    let needsUpdate = false

    if (input.label !== undefined) {
      const r = validateLinkLabel(input.label)
      if (r.isErr()) throw r.error
      validatedLabel = r.value
      needsUpdate = true
    }

    if (input.url !== undefined) {
      if (!isValidExternalUrl(input.url)) {
        throw portalError('invalid_url', 'Link URL must use https:// scheme')
      }
      needsUpdate = true
    }

    if (input.iconKey !== undefined) {
      needsUpdate = true
    }

    if (!needsUpdate) return existing

    const expectedPortalUpdatedAt = target.portalUpdatedAt ?? portal.updatedAt
    const newLabel = validatedLabel ?? existing.label
    const newUrl = input.url ?? existing.url
    const newIconKey = input.iconKey !== undefined ? input.iconKey : existing.iconKey

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, expectedPortalUpdatedAt)
    await deps.commandStore.updatePortalLink({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: existing.portalId,
      expectedPortalUpdatedAt,
      revision,
      occurredAt,
      linkId: existing.id,
      categoryId: existing.categoryId,
      patch: { label: newLabel, url: newUrl, iconKey: newIconKey },
      event: portalLinkUpdated({
        portalId: existing.portalId,
        linkId: existing.id,
        categoryId: existing.categoryId,
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })

    return {
      ...existing,
      label: newLabel,
      url: newUrl,
      iconKey: newIconKey,
      updatedAt: occurredAt,
    }
  }

export type UpdateLink = ReturnType<typeof updateLink>
