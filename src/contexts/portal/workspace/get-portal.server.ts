// Portal context — get portal use case

import type { PortalRepository } from '../publication/portal-repository.port.server'
import type { PortalTokenRepository } from '../addresses/portal-token-repository.port.server'
import type { Portal } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../domain/errors'
import { portalId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { assertPropertyAccess } from '../publication/assert-property-access.server'
import {
  toPortalTokenStatus,
  type PortalTokenStatus,
} from '../addresses/portal-token-status.server'
import type { PortalAddressCipher } from '../addresses/portal-address-cipher.port.server'
import type { PortalActorDirectory } from './portal-actor-directory.port.server'
import { resolveVersionActors, versionActor } from './portal-version-actors.server'

export type GetPortalInput = Readonly<{
  portalId: string
}>

export type GetPortalResult = Readonly<{
  portal: Portal
  tokenStatus: PortalTokenStatus
}>

export type GetPortalDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummaryForPortal'>
  staffPublicApi: StaffPublicApi
  /** Names the person who made the live code. */
  actorDirectory: PortalActorDirectory
  /** Says whether the live code can be downloaded again; null when no keyring is configured. */
  addressCipher: Pick<PortalAddressCipher, 'canOpen'> | null
  clock: () => Date
}>

async function nameCodeMaker(
  directory: PortalActorDirectory,
  ctx: AuthContext,
  issuedBy: string | null,
): Promise<string | null> {
  if (issuedBy === null) return null
  const names = await resolveVersionActors(directory, ctx.organizationId, [issuedBy])
  return versionActor(issuedBy, names)?.displayName ?? null
}

export const getPortal =
  (deps: GetPortalDeps) =>
  async (input: GetPortalInput, ctx: AuthContext): Promise<GetPortalResult> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'Insufficient permissions to view portal')
    }
    const pid = portalId(input.portalId)
    const portal = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // D6-001: verify caller's staff_assignment includes this portal's property
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.read', portal.propertyId)

    const token = await deps.portalTokenRepo.findResolvableSummaryForPortal(
      ctx.organizationId,
      pid,
      deps.clock(),
    )
    const madeBy = await nameCodeMaker(deps.actorDirectory, ctx, token?.issuedBy ?? null)
    return {
      portal,
      tokenStatus: toPortalTokenStatus(
        token,
        (version) => deps.addressCipher?.canOpen(version) ?? false,
        madeBy,
      ),
    }
  }

export type GetPortal = ReturnType<typeof getPortal>
