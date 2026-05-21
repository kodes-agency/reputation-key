// Portal context — get portal QR URL use case.
// Resolves portal slug + org slug through the repository, builds the public URL.

import type { PortalRepository } from '../ports/portal.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'

export type GetPortalQrUrlDeps = Readonly<{
  portalRepo: PortalRepository
  baseUrl: string
}>

export const getPortalQrUrl =
  (deps: GetPortalQrUrlDeps) =>
  async (
    input: { portalId: string },
    ctx: AuthContext,
  ): Promise<{ portalUrl: string; slug: string }> => {
    // 1. Load portal QR info (tenant-isolated)
    const info = await deps.portalRepo.getPortalQrInfo(
      ctx.organizationId,
      portalId(input.portalId),
    )
    if (!info) {
      throw portalError('portal_not_found', 'Portal not found in this organization')
    }

    // 2. Build public URL
    const portalUrl = `${deps.baseUrl}/p/${info.propertySlug}/${info.slug}?source=qr`

    return { portalUrl, slug: info.slug }
  }

export type GetPortalQrUrl = ReturnType<typeof getPortalQrUrl>
