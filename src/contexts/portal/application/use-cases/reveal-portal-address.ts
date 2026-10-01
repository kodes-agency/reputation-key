// Portal context — "Download again" (round 4, slice 33; ADR 0064).
//
// Hands a manager the address of the Portal's live code, decrypted from the
// sealed copy made when the code was issued or replaced. The order is the
// point: authorise, find the sealed copy, record the disclosure, and only then
// decrypt. A disclosure therefore never happens without its row, and a request
// that cannot disclose (no keyring, no sealed copy, a retired key, a stopped
// code) writes no row. The rate limit is the server function's, at the trust
// boundary, like every other limiter in the tree.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalAddressCipher } from '../ports/portal-address-cipher.port'
import type {
  AddressDownloadPurpose,
  PortalAddressRepository,
} from '../ports/portal-address.repository'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { buildPortalPublicUrls, type PortalPublicUrls } from '../portal-address-urls'
import { portalError } from '../../domain/errors'

export type RevealPortalAddressDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  portalAddressRepo: PortalAddressRepository
  /** Null when no keyring is configured: nothing can be revealed. */
  addressCipher: PortalAddressCipher | null
  clock: () => Date
  baseUrl: string
}>

export type RevealedPortalAddress = Readonly<{
  publicUrl: string
  publicUrls: PortalPublicUrls
  version: number
  issuedAt: Date
}>

const unavailable = () =>
  portalError(
    'address_unavailable',
    'This code cannot be downloaded again. Replace the code to get a new set.',
  )

export const revealPortalAddress =
  (deps: RevealPortalAddressDeps) =>
  async (
    input: Readonly<{ portalId: string; purpose: AddressDownloadPurpose }>,
    ctx: AuthContext,
  ): Promise<RevealedPortalAddress> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to download portal codes',
    })
    const { addressCipher } = deps
    if (addressCipher === null) throw unavailable()

    const live = await deps.portalAddressRepo.findRevealable(
      ctx.organizationId,
      portal.id,
    )
    if (live === null || !addressCipher.canOpen(live.sealed.keyVersion)) {
      throw unavailable()
    }

    const recorded = await deps.portalAddressRepo.recordDownload({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenId: live.tokenId,
      downloadedBy: ctx.userId,
      purpose: input.purpose,
      at: deps.clock(),
    })
    if (!recorded) throw unavailable()

    let rawToken: string
    try {
      rawToken = addressCipher.open(live.sealed, {
        organizationId: ctx.organizationId,
        propertyId: live.propertyId,
        portalId: portal.id,
        tokenId: live.tokenId,
        version: live.version,
      })
    } catch {
      throw unavailable()
    }
    const publicUrls = buildPortalPublicUrls(
      deps.baseUrl,
      rawToken,
      live.accessArtifactIds,
    )
    return {
      publicUrl: publicUrls.qr,
      publicUrls,
      version: live.version,
      issuedAt: live.issuedAt,
    }
  }

export type RevealPortalAddress = ReturnType<typeof revealPortalAddress>
