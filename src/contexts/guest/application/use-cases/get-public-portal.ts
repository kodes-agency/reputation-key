import type { PublicPortalLookup } from '../ports/public-portal-lookup.port'
import { guestError } from '../../domain/errors'

export type GetPublicPortalDeps = Readonly<{
  publicPortalLookup: PublicPortalLookup
}>

export type GetPublicPortalInput = Readonly<{
  orgSlug: string
  portalSlug: string
}>

export const getPublicPortal =
  (deps: GetPublicPortalDeps) => async (input: GetPublicPortalInput) => {
    const result = await deps.publicPortalLookup.findBySlug(
      input.orgSlug,
      input.portalSlug,
    )
    if (!result) {
      throw guestError('portal_not_found', 'Portal not found')
    }
    return result
  }

export type GetPublicPortal = ReturnType<typeof getPublicPortal>
