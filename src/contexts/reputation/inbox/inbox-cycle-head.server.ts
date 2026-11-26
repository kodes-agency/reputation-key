import { inboxItems } from '#/shared/db/schema/inbox.schema'
import type { HandlingCycleHead } from '../domain/inbox-types'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'

type ItemRow = typeof inboxItems.$inferSelect

type HeadFacts = Pick<
  HandlingCycleHead,
  'currentCycleNumber' | 'currentSourceRevision' | 'stateRevision' | 'status'
>

/**
 * The current Handling Cycle as one Inbox row states it. An item that never
 * opened a cycle has none; every reader treats that as "no active handling".
 */
export const persistedHeadFromItemRow = (row: ItemRow): HandlingCycleHead | null => {
  if (
    row.currentCycleNumber === null ||
    row.currentSourceRevision === null ||
    row.stateRevision === null
  ) {
    return null
  }
  return {
    inboxItemId: inboxItemId(row.id),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    sourceType: row.sourceType,
    sourceId:
      row.sourceType === 'review' ? reviewId(row.sourceId) : feedbackId(row.sourceId),
    currentCycleNumber: row.currentCycleNumber,
    currentSourceRevision: row.currentSourceRevision,
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
