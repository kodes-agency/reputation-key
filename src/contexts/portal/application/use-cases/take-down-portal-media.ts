// Portal context — take an uploaded image down.
//
// A takedown stops the image being served and removes its object. It is the
// answer to "this image must not be shown": a rights complaint, a mistaken
// upload, an image that should never have been public. The row stays, because
// published snapshots name assets by id and must keep verifying; they simply
// find the asset unservable and show their no-photo look.
//
// The order is the safe one. The row flips first, in one conditional update, and
// from that moment the serving path refuses the asset. Removing the object comes
// second and may fail; the row then says the object is still there, and the media
// sweep retries until it is gone. A takedown therefore never fails half-done in
// the direction that matters (an image still being served).

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalMediaAssetId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { canForContext } from '#/shared/domain/permissions'
import { z } from 'zod/v4'
import { portalError } from '../../domain/errors'
import { assertPropertyAccess } from '../assert-property-access'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import type { StoragePort } from '../ports/storage.port'

export type TakeDownPortalMediaInput = Readonly<{ assetId: string }>

export type TakenDownPortalMedia = Readonly<{
  assetId: string
  /** False when the object could not be removed yet; the sweep will retry. */
  objectRemoved: boolean
}>

export type TakeDownPortalMediaDeps = Readonly<{
  mediaRepo: PortalMediaAssetRepository
  objectStore: Pick<StoragePort, 'deleteObject'>
  staffPublicApi: StaffPublicApi
  clock: () => Date
  logger: Pick<LoggerPort, 'info' | 'error'>
}>

const uuidSchema = z.uuid()

export const takeDownPortalMedia =
  (deps: TakeDownPortalMediaDeps) =>
  async (
    input: TakeDownPortalMediaInput,
    ctx: AuthContext,
  ): Promise<TakenDownPortalMedia> => {
    // Property-wide branding is an Account Admin's; a takedown is never narrower
    // than the upload it undoes.
    if (!canForContext(ctx, 'portal.admin')) {
      throw portalError('forbidden', 'Insufficient permissions to take an image down')
    }
    if (!uuidSchema.safeParse(input.assetId).success) throw notFound()
    const assetId = portalMediaAssetId(input.assetId)

    const asset = await deps.mediaRepo.findById(ctx.organizationId, assetId)
    if (!asset) throw notFound()
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.admin', asset.propertyId)

    const now = deps.clock()
    const taken = await deps.mediaRepo.markTakenDown(ctx.organizationId, assetId, now)
    // The conditional update changes nothing when another request got there
    // first, and the row read above is then stale: ask again before judging.
    const current = taken ?? (await deps.mediaRepo.findById(ctx.organizationId, assetId))
    // Not active and not taken down is not a state the model has; refuse
    // rather than act on a row this code does not understand.
    if (!current || (!taken && current.status !== 'taken_down')) throw notFound()
    if (taken) {
      deps.logger.info({ assetId, actorUserId: ctx.userId }, 'Portal media taken down')
    }

    const objectRemoved = current.objectDeletedAt
      ? true
      : await removeObject(deps, ctx, assetId, current.objectKey, now)
    return { assetId, objectRemoved }
  }

async function removeObject(
  deps: TakeDownPortalMediaDeps,
  ctx: AuthContext,
  assetId: ReturnType<typeof portalMediaAssetId>,
  objectKey: string,
  now: Date,
): Promise<boolean> {
  try {
    await deps.objectStore.deleteObject(objectKey)
    await deps.mediaRepo.markObjectDeleted(ctx.organizationId, assetId, now)
    return true
  } catch {
    // Content-free: an id and a code. The row keeps `object_deleted_at` empty,
    // which is what hands the object to the sweep.
    deps.logger.error(
      { assetId, errorCode: 'portal_media_takedown_object_pending' },
      'Portal media object not removed after takedown; the sweep will retry',
    )
    return false
  }
}

const notFound = () =>
  portalError('media_not_found', 'image not found in this organization')

export type TakeDownPortalMedia = ReturnType<typeof takeDownPortalMedia>
