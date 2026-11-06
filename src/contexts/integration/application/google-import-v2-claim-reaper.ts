import type { LoggerPort } from '#/shared/domain/logger.port'
import { googlePropertyImportItemJobId } from './google-import-dispatch'
import type { GoogleImportV2QueuePort } from './ports/gbp-queue.port'
import type { GoogleImportV2Processor } from './google-import-v2-processor'
import {
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportV2Store,
} from './ports/google-import-v2-store.port'

export type GoogleImportV2ClaimReaperResult = Readonly<{
  dueItemsVisited: number
  claimsReleased: number
  itemsDispatched: number
  completionChecks: number
  claimsLost: number
  itemFailures: number
}>

export type GoogleImportV2ClaimReaper = () => Promise<GoogleImportV2ClaimReaperResult>

export function createGoogleImportV2ClaimReaper(
  deps: Readonly<{
    store: Pick<GoogleImportV2Store, 'reserveDueItems' | 'releaseClaimForRetry'>
    queue: GoogleImportV2QueuePort
    processItem: GoogleImportV2Processor['process']
    logger: Pick<LoggerPort, 'warn'>
    clock: () => Date
    newDeliveryId: () => string
    limit?: number
  }>,
): GoogleImportV2ClaimReaper {
  return async () => {
    const now = deps.clock()
    const dueItems = await deps.store.reserveDueItems(now, deps.limit ?? 100)
    let claimsReleased = 0
    let itemsDispatched = 0
    let completionChecks = 0
    let claimsLost = 0
    let itemFailures = 0

    for (const item of dueItems) {
      try {
        let dispatchEpoch = item.dispatchEpoch
        if (item.status === 'processing') {
          if (item.claimFence === null)
            throw new Error('Google import claim has no fence')
          const released = await deps.store.releaseClaimForRetry({
            organizationId: item.organizationId,
            itemId: item.itemId,
            retryRevision: item.retryRevision,
            dispatchEpoch,
            claimFence: item.claimFence,
            expiredOnly: true,
            now,
          })
          if (released === 'lost') {
            claimsLost++
            continue
          }
          claimsReleased++
          dispatchEpoch++
        }

        if (
          item.attemptOrdinal >= GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS ||
          now >= item.effectDeadlineAt
        ) {
          // A committed Property receipt must run through the processor's
          // existing follow-ups before any exhausted/deadline outcome wins.
          await deps.processItem({
            organizationId: item.organizationId,
            itemId: item.itemId,
            retryRevision: item.retryRevision,
            dispatchEpoch,
            attemptOrdinal: 1,
          })
          completionChecks++
          continue
        }

        await deps.queue.addImportItemJobs([
          {
            jobId: googlePropertyImportItemJobId({
              itemId: item.itemId,
              lifecycleVersion: item.expectedConnectionLifecycleVersion,
              sourceEpoch: item.expectedSourceEpoch,
              retryRevision: item.retryRevision,
              dispatchEpoch,
              deliveryId: deps.newDeliveryId(),
            }),
            organizationId: item.organizationId,
            importJobId: item.importJobId,
            itemId: item.itemId,
            retryRevision: item.retryRevision,
            dispatchEpoch,
          },
        ])
        itemsDispatched++
      } catch (error) {
        itemFailures++
        deps.logger.warn(
          {
            itemId: item.itemId,
            errorName: error instanceof Error ? error.name : 'unknown',
          },
          'Google import recovery item deferred to its next appointment',
        )
      }
    }
    return {
      dueItemsVisited: dueItems.length,
      claimsReleased,
      itemsDispatched,
      completionChecks,
      claimsLost,
      itemFailures,
    }
  }
}
