// Identity context — remove avatar and logo uploads that were never saved.
//
// The browser uploads straight to the bucket by a signed address, and the
// picture is saved on the user or organization only afterwards. A person who
// abandons the flow leaves an object nothing points at; the image route already
// refuses to serve it, and this frees the bytes. Replaced pictures are freed at
// the save (`retireReplacedIdentityAsset`); this catches what never got that far.
//
// An object is left alone while its signed address (an hour) could still replace
// it, so the grace is longer than that. Only keys of the two shapes the upload
// requests issue are ever deleted, and an object with no reported age is kept.

import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { parseIdentityAssetKey } from './identity-assets'

/** The signed upload address lasts one hour; an object this old can no longer be replaced. */
export const PENDING_UPLOAD_GRACE_MS = 2 * 60 * 60 * 1000

/** Objects read per listing call. */
const PENDING_UPLOAD_PAGE_SIZE = 1000

/**
 * The most objects read per prefix in one run, so a run stays bounded. Live
 * pictures sit ahead of abandoned uploads in key order, so the scan walks the
 * whole prefix up to this cap rather than stopping at the first page.
 */
const PENDING_UPLOAD_SCAN_LIMIT = 100_000

/** The most objects deleted in one run; a backlog drains over several runs. */
const PENDING_UPLOAD_DELETE_LIMIT = 200

type StoredObject = Awaited<
  ReturnType<ReclaimPendingIdentityUploadsDeps['storage']['listObjects']>
>['objects'][number]

const PREFIXES = ['avatars/', 'organizations/'] as const

export type PendingUploadReclaimOutcome = Readonly<{
  reclaimed: number
  failed: number
  listingTruncated: boolean
}>

export type ReclaimPendingIdentityUploadsDeps = Readonly<{
  storage: Pick<StoragePort, 'listObjects' | 'deleteObject'>
  /** Whether the user or organization the key is scoped to still points at it. */
  isReferenced: (key: string) => Promise<boolean>
  clock: () => Date
  logger: Pick<LoggerPort, 'warn'>
}>

type Tally = { reclaimed: number; failed: number }

const deleteLimitReached = (tally: Tally): boolean =>
  tally.reclaimed + tally.failed >= PENDING_UPLOAD_DELETE_LIMIT

/** Delete one object if it is a never-saved upload past its grace; counts the result. */
const reclaimObject =
  (deps: ReclaimPendingIdentityUploadsDeps, cutoff: number, tally: Tally) =>
  async ({ key, lastModified }: StoredObject): Promise<void> => {
    const parsed = parseIdentityAssetKey(key)
    if (!parsed || !lastModified || lastModified.getTime() > cutoff) return

    try {
      if (await deps.isReferenced(key)) return
      await deps.storage.deleteObject(key)
      tally.reclaimed += 1
    } catch (error) {
      tally.failed += 1
      deps.logger.warn(
        {
          err: error,
          errorCode: 'identity_pending_upload_reclaim_failed',
          kind: parsed.kind,
        },
        'A pending image upload could not be removed from the store; it will be retried',
      )
    }
  }

/** Walk one prefix page by page; true when the delete limit or scan cap cut it short. */
const reclaimPrefix = async (
  deps: ReclaimPendingIdentityUploadsDeps,
  prefix: string,
  reclaim: (object: StoredObject) => Promise<void>,
  tally: Tally,
): Promise<boolean> => {
  let startAfter: string | undefined
  let scanned = 0

  for (;;) {
    const page = await deps.storage.listObjects(
      prefix,
      PENDING_UPLOAD_PAGE_SIZE,
      startAfter,
    )

    for (const object of page.objects) {
      if (deleteLimitReached(tally)) return true
      await reclaim(object)
    }

    scanned += page.objects.length
    const last = page.objects.at(-1)
    if (!page.truncated || !last) return false
    if (scanned >= PENDING_UPLOAD_SCAN_LIMIT) {
      // Not silent: abandoned uploads past the cap are never reached.
      deps.logger.warn(
        { errorCode: 'identity_pending_upload_scan_capped', prefix },
        'The pending image upload scan reached its cap before the end of the listing',
      )
      return true
    }
    startAfter = last.key
  }
}

export const reclaimPendingIdentityUploads =
  (deps: ReclaimPendingIdentityUploadsDeps) =>
  async (): Promise<PendingUploadReclaimOutcome> => {
    const cutoff = deps.clock().getTime() - PENDING_UPLOAD_GRACE_MS
    const tally: Tally = { reclaimed: 0, failed: 0 }
    const reclaim = reclaimObject(deps, cutoff, tally)
    let listingTruncated = false

    for (const prefix of PREFIXES) {
      listingTruncated =
        (await reclaimPrefix(deps, prefix, reclaim, tally)) || listingTruncated
    }

    return { ...tally, listingTruncated }
  }

export type ReclaimPendingIdentityUploads = ReturnType<
  typeof reclaimPendingIdentityUploads
>
