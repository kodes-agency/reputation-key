// Portal context — get portal QR URL use case.
// Resolves portal slug + org slug through the repository, builds the public URL.

import type { PortalRepository } from '../ports/portal.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPortalPropertyAccess } from '../assert-property-access'

export type GetPortalQrUrlInput = Readonly<{
  portalId: string
}>

export type GetPortalQrUrlDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  baseUrl: string
}>

export const getPortalQrUrl =
  (deps: GetPortalQrUrlDeps) =>
  async (
    input: GetPortalQrUrlInput,
    ctx: AuthContext,
  ): Promise<{ portalUrl: string; slug: string }> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'Insufficient permissions to view portal QR URL')
    }

    // D6-001: verify caller can access this portal's property
    await assertPortalPropertyAccess(
      deps.portalRepo,
      deps.staffPublicApi,
      ctx,
      'portal.read',
      portalId(input.portalId),
    )

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
