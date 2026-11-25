import { inboxItems } from '#/shared/db/schema/inbox.schema'
import type { HandlingCycleHead } from '../domain/inbox-types'

type ItemRow = typeof inboxItems.$inferSelect

/**
 * The current Handling Cycle as one Inbox row states it. An item that never
 * opened a cycle has none; every reader treats that as "no active handling".
 */
export type PersistedHead = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId: string
  sourceType: ItemRow['sourceType']
  sourceId: string
  reviewId: string | null
  currentCycleNumber: number
  currentSourceRevision: number
  currentMaterialReviewRevision: number | null
  stateRevision: number
  status: ItemRow['status']
}>

type HeadFacts = Pick<
  HandlingCycleHead,
  'currentCycleNumber' | 'currentSourceRevision' | 'stateRevision' | 'status'
>

export const persistedHeadFromItemRow = (row: ItemRow): PersistedHead | null => {
  if (
    row.currentCycleNumber === null ||
    row.currentSourceRevision === null ||
    row.stateRevision === null
  ) {
    return null
  }
  const isReview = row.sourceType === 'review'
  return {
    inboxItemId: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    reviewId: isReview ? row.sourceId : null,
    currentCycleNumber: row.currentCycleNumber,
    currentSourceRevision: row.currentSourceRevision,
    currentMaterialReviewRevision: isReview ? row.currentSourceRevision : null,
    stateRevision: row.stateRevision,
    status: row.status,
  }
}

/** The Handling Cycle facts an Inbox row carries; spread them into its update. */
export const cycleHeadItemColumns = (head: HeadFacts) => ({
  currentCycleNumber: head.currentCycleNumber,
  currentSourceRevision: head.currentSourceRevision,
  stateRevision: head.stateRevision,
})
