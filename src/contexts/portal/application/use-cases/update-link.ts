// Portal context — update link use case

import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalLink } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { validateLinkLabel, validateUrl } from '../../domain/rules'
import { can } from '#/shared/domain/permissions'
import { portalLinkId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type UpdateLinkDeps = Readonly<{
  portalLinkRepo: PortalLinkRepository
  clock: () => Date
}>

export const updateLink =
  (deps: UpdateLinkDeps) =>
  async (
    input: {
      linkId: string
      label?: string
      url?: string
      iconKey?: string | null
    },
    ctx: AuthContext,
  ): Promise<PortalLink> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot update portal links')
    }

    const existing = await deps.portalLinkRepo.findLinkById(
      ctx.organizationId,
      portalLinkId(input.linkId),
    )
    if (!existing) {
      throw portalError('link_not_found', 'link not found')
    }

    let newLabel = existing.label
    let newUrl = existing.url
    let newIconKey = existing.iconKey
    let needsUpdate = false

    if (input.label !== undefined) {
      const r = validateLinkLabel(input.label)
      if (r.isErr()) throw r.error
      newLabel = r.value
      needsUpdate = true
    }

    if (input.url !== undefined) {
      const r = validateUrl(input.url)
      if (r.isErr()) throw r.error
      newUrl = r.value
      needsUpdate = true
    }

    if (input.iconKey !== undefined) {
      newIconKey = input.iconKey
      needsUpdate = true
    }

    if (!needsUpdate) return existing

    const updatedAt = deps.clock()
    await deps.portalLinkRepo.updateLink(ctx.organizationId, portalLinkId(input.linkId), {
      label: newLabel,
      url: newUrl,
      iconKey: newIconKey,
      updatedAt,
    })

    return { ...existing, label: newLabel, url: newUrl, iconKey: newIconKey, updatedAt }
  }

// fallow-ignore-next-line unused-type
export type UpdateLink = ReturnType<typeof updateLink>
