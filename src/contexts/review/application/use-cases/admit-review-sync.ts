// Review context — review sync admission for other contexts.
//
// A Google property import is the one sync whose admission changes what later
// observations mean: it fixes its source epoch's history cutoff. Admission
// fixes it before the import's sync job is queued, and so before the import
// settles and the discovery sweep may poll the Property. However long that job
// waits, retries a failed first step or is lost, no discovery, push or manual
// run can observe the epoch's history before its cutoff exists.

import { organizationId, propertyId } from '#/shared/domain/ids'
import type { PropertySourceEpochPort } from '../ports/property-source-epoch.port'
import type { ReviewProviderSnapshotRepository } from '../ports/review-provider-snapshot.repository'
import {
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
  type ReviewQueuePort,
  type SyncPropertyReviewsJobData,
} from '../ports/review-queue.port'

export type AdmitReviewSyncDeps = Readonly<{
  queue: Pick<ReviewQueuePort, 'addSyncJob'>
  admitImportSync?: (
    data: SyncPropertyReviewsJobData,
  ) => Promise<SyncPropertyReviewsJobData | null>
  propertySourceEpoch: PropertySourceEpochPort
  historyCutoffs: Pick<ReviewProviderSnapshotRepository, 'fixImportHistoryCutoff'>
}>

export type AdmitReviewSync = ReviewQueuePort['addSyncJob']

/** The import's epoch is the Property's current one; a Property with no Google
 * source left has nothing to cut off, and its sync refuses to run. */
const fixImportHistoryCutoff = async (
  deps: AdmitReviewSyncDeps,
  data: SyncPropertyReviewsJobData,
): Promise<boolean> => {
  const organization = organizationId(data.organizationId)
  const property = propertyId(data.propertyId)
  const current = await deps.propertySourceEpoch.getSourceEpoch(organization, property)
  if (data.sourceEpoch !== undefined && current?.sourceEpoch !== data.sourceEpoch)
    return false
  if (current == null) return true
  await deps.historyCutoffs.fixImportHistoryCutoff({
    organizationId: organization,
    propertyId: property,
    sourceEpoch: current.sourceEpoch,
  })
  return true
}

export const admitReviewSync =
  (deps: AdmitReviewSyncDeps): AdmitReviewSync =>
  async (data, options) => {
    if (data.initiator?.id === GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID) {
      if (!(await fixImportHistoryCutoff(deps, data))) return
    }
    const admitted = data.importBindingEventId
      ? await (() => {
          if (!deps.admitImportSync)
            throw new Error('Durable import sync admission unavailable')
          return deps.admitImportSync(data)
        })()
      : data
    if (admitted) await deps.queue.addSyncJob(admitted, options)
  }
