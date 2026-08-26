import {
  GBP_IMPORT_ITEM_STATUSES,
  type GbpImportItemStatus,
  type ImportParentStatus,
} from './google-import-v2-contract'

/** Worker-dispatch and child-transaction bound; never a product selection cap. */
export const GOOGLE_IMPORT_BATCH_SIZE = 100

export type GoogleImportSagaBatch<T> = Readonly<{
  ordinal: number
  items: readonly T[]
}>

export function planGoogleImportSagaBatches<T>(
  items: readonly T[],
): readonly GoogleImportSagaBatch<T>[] {
  if (items.length === 0) throw new Error('Google import saga requires at least one item')
  const batches: GoogleImportSagaBatch<T>[] = []
  for (let offset = 0; offset < items.length; offset += GOOGLE_IMPORT_BATCH_SIZE) {
    batches.push({
      ordinal: batches.length,
      items: items.slice(offset, offset + GOOGLE_IMPORT_BATCH_SIZE),
    })
  }
  return batches
}

export type GoogleImportSagaChildProgress = Readonly<{
  status: ImportParentStatus
  totalCount: number
  processedCount: number
  counts: Readonly<Record<GbpImportItemStatus, number>>
}>

export type GoogleImportSagaReduction = Readonly<{
  status: ImportParentStatus
  totalCount: number
  processedCount: number
  counts: Readonly<Record<GbpImportItemStatus, number>>
}>

const emptyCounts = (): Record<GbpImportItemStatus, number> =>
  Object.fromEntries(GBP_IMPORT_ITEM_STATUSES.map((status) => [status, 0])) as Record<
    GbpImportItemStatus,
    number
  >

function terminalSagaStatus(
  batches: readonly GoogleImportSagaChildProgress[],
): ImportParentStatus {
  if (batches.every((batch) => batch.status === 'completed')) return 'completed'
  if (batches.every((batch) => batch.status === 'cancelled')) return 'cancelled'
  if (
    batches.every((batch) => batch.status === 'failed' || batch.status === 'cancelled') &&
    batches.some((batch) => batch.status === 'failed')
  ) {
    return 'failed'
  }
  return 'completed_with_issues'
}

/**
 * Aggregates persisted child-batch truth. No total or percentage is inferred
 * from the current batch, so a 201-location saga can never appear complete
 * after its first 100-item batch settles.
 */
export function reduceGoogleImportSaga(
  batches: readonly GoogleImportSagaChildProgress[],
): GoogleImportSagaReduction {
  if (batches.length === 0) throw new Error('Google import saga has no child batches')

  const counts = emptyCounts()
  let totalCount = 0
  let processedCount = 0
  for (const batch of batches) {
    if (
      !Number.isSafeInteger(batch.totalCount) ||
      batch.totalCount < 1 ||
      batch.totalCount > GOOGLE_IMPORT_BATCH_SIZE ||
      !Number.isSafeInteger(batch.processedCount) ||
      batch.processedCount < 0 ||
      batch.processedCount > batch.totalCount
    ) {
      throw new Error('invalid Google import child-batch progress')
    }
    let counted = 0
    for (const status of GBP_IMPORT_ITEM_STATUSES) {
      const value = batch.counts[status]
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('invalid Google import child-batch count')
      }
      counts[status] += value
      counted += value
    }
    if (
      counted !== batch.totalCount ||
      batch.processedCount !==
        batch.totalCount - batch.counts.pending - batch.counts.processing
    ) {
      throw new Error('inconsistent Google import child-batch progress')
    }
    totalCount += batch.totalCount
    processedCount += batch.processedCount
  }

  const active = batches.some(
    (batch) => batch.status === 'queued' || batch.status === 'processing',
  )
  const status: ImportParentStatus = active
    ? processedCount === 0 && counts.processing === 0
      ? 'queued'
      : 'processing'
    : terminalSagaStatus(batches)

  return { status, totalCount, processedCount, counts }
}
