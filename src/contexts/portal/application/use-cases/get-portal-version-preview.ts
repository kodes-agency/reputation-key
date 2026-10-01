// Portal context — the guest page of one published version, for "View" in the
// History tab (round 4, slice 47i).
//
// The chosen version's verified snapshot is drawn by the same rules as the live
// preview: only the addresses an account admin still stands behind, none when
// the Linktree is off, and images only while they may be served. That is what
// guests would be served if this version were made live now, which is the
// question the History asks. It is a read: gated by `portal.read` like the
// version's words, it records nothing, and the answer carries no address.
//
// A version published with the earlier page design cannot be drawn by this
// preview (`earlier_design`), and the History falls back to its words. A
// version that no longer verifies is not found, as in `getPortalVersion`.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { buildVersionPortalPreview, type PortalPreviewOutcome } from '../portal-preview'
import {
  readPublishedPreviewInputs,
  type PublishedPreviewInputsDeps,
} from '../published-preview-inputs'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalRepository } from '../ports/portal.repository'

export type GetPortalVersionPreviewInput = Readonly<{
  portalId: string
  version: number
}>

export type GetPortalVersionPreviewDeps = PublishedPreviewInputsDeps &
  Readonly<{
    portalRepo: PortalRepository
    publicationRepo: Pick<PortalPublicationRepository, 'findSnapshotByVersion'>
    staffPublicApi: StaffPublicApi
  }>

export const getPortalVersionPreview =
  (deps: GetPortalVersionPreviewDeps) =>
  async (
    input: GetPortalVersionPreviewInput,
    ctx: AuthContext,
  ): Promise<PortalPreviewOutcome> => {
    const pid = portalId(input.portalId)
    const portal = await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to preview a Portal version',
    })
    const unavailable = () =>
      portalError(
        'publication_snapshot_unavailable',
        'The requested publication version is unavailable for this Portal',
      )
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw unavailable()

    const snapshot = await deps.publicationRepo.findSnapshotByVersion(
      ctx.organizationId,
      pid,
      input.version,
    )
    if (!snapshot) throw unavailable()

    const { approvedUris, mediaUrls } = await readPublishedPreviewInputs(
      deps,
      { organizationId: ctx.organizationId, propertyId: portal.propertyId },
      snapshot,
    )
    return buildVersionPortalPreview({ snapshot, approvedUris, mediaUrls })
  }

export type GetPortalVersionPreview = ReturnType<typeof getPortalVersionPreview>
