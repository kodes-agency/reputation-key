// Portal context — the media sweep.
//
// Two jobs, run together on a schedule, that keep the object store honest about
// what the database says exists:
//
//  1. Finish takedowns. A takedown stops an image being served at once and then
//     removes its object; if that removal failed, the row still says the object
//     may be there, and this removes it.
//  2. Collect what nothing refers to. An image that was uploaded and then
//     replaced or never used, and that no Brand Profile, link or publication
//     snapshot names, is deleted: object and row. Snapshots are immutable and
//     must keep rendering, so an image one of them names is kept for as long as
//     the snapshot exists; that is the repository's definition of "refers to".
//
// An image younger than the grace period is never collected: an upload is
// attached to its Brand Profile or link moments after it arrives, and the sweep
// must not win that race. Whatever else races (an attach in the same instant) is
// settled by the repository, which locks the row and lets the database's foreign
// keys refuse a reference to a row that is going.
//
// Every failure is one image's: it is reported by id and code, and the sweep goes
// on with the rest. The next run finds the same work again.

import type { LoggerPort } from '#/shared/domain/logger.port'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import type { StoragePort } from '../ports/storage.port'

/** Each kind of work is bounded per run; a backlog drains over several runs. */
export const MEDIA_SWEEP_BATCH_SIZE = 100

/** How long an unreferenced image is left alone: a day to attach what was just uploaded. */
export const UNREFERENCED_GRACE_MS = 24 * 60 * 60 * 1000

export type PortalMediaSweepOutcome = Readonly<{
  takenDownObjectsRemoved: number
  discarded: number
  failed: number
}>

export type SweepPortalMediaDeps = Readonly<{
  mediaRepo: PortalMediaAssetRepository
  objectStore: Pick<StoragePort, 'deleteObject'>
  clock: () => Date
  logger: Pick<LoggerPort, 'error'>
}>

export const sweepPortalMedia =
  (deps: SweepPortalMediaDeps) => async (): Promise<PortalMediaSweepOutcome> => {
    const now = deps.clock()
    const cutoff = new Date(now.getTime() - UNREFERENCED_GRACE_MS)
    const reportFailure = (assetId: string) =>
      deps.logger.error(
        { assetId, errorCode: 'portal_media_sweep_object_failed' },
        'Portal media sweep could not remove an object; it will be retried',
      )

    let takenDownObjectsRemoved = 0
    let discarded = 0
    let failed = 0

    const takenDown = await deps.mediaRepo.listTakenDownWithObject(MEDIA_SWEEP_BATCH_SIZE)
    for (const asset of takenDown) {
      try {
        await deps.objectStore.deleteObject(asset.objectKey)
        await deps.mediaRepo.markObjectDeleted(asset.organizationId, asset.id, now)
        takenDownObjectsRemoved += 1
      } catch {
        failed += 1
        reportFailure(asset.id)
      }
    }

    const candidates = await deps.mediaRepo.listUnreferencedBefore(
      cutoff,
      MEDIA_SWEEP_BATCH_SIZE,
    )
    for (const asset of candidates) {
      try {
        const removed = await deps.mediaRepo.discardIfUnreferenced(
          asset,
          cutoff,
          (objectKey) => deps.objectStore.deleteObject(objectKey),
        )
        if (removed) discarded += 1
      } catch {
        failed += 1
        reportFailure(asset.id)
      }
    }

    return { takenDownObjectsRemoved, discarded, failed }
  }

export type SweepPortalMedia = ReturnType<typeof sweepPortalMedia>
