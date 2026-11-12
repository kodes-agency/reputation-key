import type { LoggerPort } from '#/shared/domain/logger.port'
import { googlePropertyImportItemJobId } from './google-import-dispatch'
import type { GoogleImportQueuePort } from './ports/gbp-queue.port'
import type { GoogleImportProcessor } from './google-import-processor'
import {
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportStore,
} from './ports/google-import-store.port'

export type GoogleImportClaimReaperResult = Readonly<{
  dueItemsVisited: number
  claimsReleased: number
  itemsDispatched: number
  completionChecks: number
  claimsLost: number
  itemFailures: number
}>

export type GoogleImportClaimReaper = () => Promise<GoogleImportClaimReaperResult>

export function createGoogleImportClaimReaper(
  deps: Readonly<{
    store: Pick<GoogleImportStore, 'reserveDueItems' | 'releaseClaimForRetry'>
    queue: GoogleImportQueuePort
    processItem: GoogleImportProcessor['process']
    logger: Pick<LoggerPort, 'warn'>
    clock: () => Date
    newDeliveryId: () => string
    limit?: number
  }>,
): GoogleImportClaimReaper {
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
