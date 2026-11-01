import type { PropertyLifecyclePublicApi } from '#/contexts/property/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import {
  revealLoadedPortalAddress,
  type RevealPortalAddressDeps,
} from './reveal-portal-address'

export const getOwnPersonalCode =
  (
    deps: RevealPortalAddressDeps &
      Readonly<{ propertyLifecycleApi: PropertyLifecyclePublicApi }>,
  ) =>
  async (input: Readonly<{ portalId: string }>, ctx: AuthContext) => {
    if (!canForContext(ctx, 'staff.self'))
      throw portalError('forbidden', 'This account has no staff code access')
    const portal = await deps.portalRepo.findById(
      ctx.organizationId,
      portalId(input.portalId),
    )
    if (!portal || portal.kind !== 'personal')
      throw portalError('forbidden', 'Choose your own personal Portal')
    const owned = await deps.staffPublicApi.getAssignedPortals(
      { userId: ctx.userId, propertyId: portal.propertyId },
      ctx,
    )
    if (!owned.includes(portal.id))
      throw portalError('forbidden', 'Choose your own personal Portal')
    if (
      portal.publicationState !== 'published' ||
      !(await deps.propertyLifecycleApi.isPropertyActive(
        ctx.organizationId,
        portal.propertyId,
      ))
    )
      return { state: 'paused' as const }
    const address = await revealLoadedPortalAddress(
      deps,
      { purpose: 'show', oncePerUserToken: true },
      portal,
      ctx,
    ).catch((error: unknown) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'address_unavailable'
      )
        return null
      throw error
    })
    if (!address) return { state: 'paused' as const }
    return {
      state: 'live' as const,
      qr: address.publicUrls.qr,
      wordingKey: portal.primaryGuestLocale,
    }
  }
