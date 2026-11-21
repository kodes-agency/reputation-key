import { and, eq, type SQL } from 'drizzle-orm'
import { inboxHandlingCycleHeads, inboxItems } from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { HandlingCycleHead } from '../domain/inbox-types'
import { inboxError } from '../domain/inbox-errors'

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

/**
 * Mirror a head move onto `inbox_handling_cycle_heads`, which is still written
 * beside the Inbox row. The Inbox row is the fence: the caller has already
 * moved it under its own compare-and-swap, so this write is by identity.
 */
export async function mirrorCycleHead(
  tx: Tx,
  input: Readonly<{
    inboxItemId: string
    organizationId: string
    sourceType: ItemRow['sourceType']
    head: Omit<HeadFacts, 'status'> & Partial<Pick<HeadFacts, 'status'>>
    updatedAt: Date | SQL<Date>
  }>,
): Promise<void> {
  const { head } = input
  const updated = await tx
    .update(inboxHandlingCycleHeads)
    .set({
      currentCycleNumber: head.currentCycleNumber,
      currentSourceRevision: head.currentSourceRevision,
      ...(input.sourceType === 'review'
        ? { currentMaterialReviewRevision: head.currentSourceRevision }
        : {}),
      stateRevision: head.stateRevision,
      ...(head.status === undefined ? {} : { status: head.status }),
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, input.inboxItemId),
        eq(inboxHandlingCycleHeads.organizationId, input.organizationId),
      ),
    )
    .returning({ id: inboxHandlingCycleHeads.inboxItemId })
  if (!updated[0]) {
    throw inboxError('revision_conflict', 'Inbox Handling Cycle changed during update')
  }
}
