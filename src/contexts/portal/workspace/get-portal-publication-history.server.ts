import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { PortalRepository } from '../publication/portal-repository.port.server'
import type { PortalPublicationRepository } from '../publication/portal-publication-repository.port.server'
import { workingCopyMatchesSnapshot } from '../publication/portal-working-copy-match.server'
import { loadPortalOrThrow } from '../publication/load-accessible-portal.server'
import { portalError } from '../domain/errors'

export type PortalPublicationHistory = Readonly<{
  /** The version guests see, or null when the Portal is not Published. */
  liveVersion: number | null
  pendingChangeCount: number
  hasPendingChanges: boolean
}>

type Deps = Readonly<{
  portalRepo: PortalRepository
  publicationRepo: PortalPublicationRepository
  staffPublicApi: StaffPublicApi
}>

export const getPortalPublicationHistory =
  (deps: Deps) =>
  async (
    input: Readonly<{ portalId: string }>,
    ctx: AuthContext,
  ): Promise<PortalPublicationHistory> => {
    const pid = portalId(input.portalId)
    const portal = await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to view Portal publication history',
    })
    const [workingCopy, activations, pendingChanges] = await Promise.all([
      deps.publicationRepo.loadWorkingCopy(ctx.organizationId, pid),
      deps.publicationRepo.findCurrentAndLatestActivation(
        ctx.organizationId,
        portal.propertyId,
        pid,
      ),
      deps.publicationRepo.listOpenPendingContentChanges(
        ctx.organizationId,
        portal.propertyId,
        pid,
      ),
    ])
    if (!workingCopy) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Portal publication details are temporarily unavailable',
      )
    }

    const baseline = activations.current ?? activations.latest
    return {
      liveVersion: activations.current?.snapshot.version ?? null,
      pendingChangeCount: pendingChanges.length,
      hasPendingChanges:
        pendingChanges.length > 0 ||
        (baseline ? !workingCopyMatchesSnapshot(workingCopy, baseline.snapshot) : false),
    }
  }

export type GetPortalPublicationHistory = ReturnType<typeof getPortalPublicationHistory>
