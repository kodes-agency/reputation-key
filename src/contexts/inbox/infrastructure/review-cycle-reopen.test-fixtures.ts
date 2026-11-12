// Opens a later Review Handling Cycle on an item for integration tests. Both
// paths run the production writers: a manual reopen goes through the command
// store's reopenReviewCycle, a Material Revision through the projection
// catch-up, so the head compare-and-set and the head -> item lock order are the
// ones production uses.

import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxHandlingCycleHeads, inboxItems } from '#/shared/db/schema/inbox.schema'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { ReviewCycleTargetAnchor } from '../application/ports/review-response-target-authority.port'
import type { HandlingCycleHead, ManualReopenReason } from '../domain/types'
import { inboxItemStatusChanged } from '../domain/events'
import { inboxError } from '../domain/errors'
import { handlingCycleHeadFromRow, itemFromRow } from './inbox-command-guards'
import { createAtomicInboxCommandStore } from './inbox-command-store'
import { catchUpProjectionRevisions } from './inbox-source-projection'

type ReopenBase = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  materialReviewRevision: number
  openedAt: Date
  responseTarget: ReviewCycleTargetAnchor
}>

export type ReopenReviewCycleFixture =
  | (ReopenBase &
      Readonly<{
        openedReason: 'manual_reopen'
        manualReopenReason: ManualReopenReason
        manualReopenExplanation: string | null
        openedBy: UserId
      }>)
  | (ReopenBase &
      Readonly<{
        openedReason: 'material_revision_changed'
        openedBy: null
      }>)

const readHead = async (
  db: Database,
  command: ReopenBase,
): Promise<HandlingCycleHead> => {
  const [row] = await db
    .select()
    .from(inboxHandlingCycleHeads)
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, command.inboxItemId),
        eq(inboxHandlingCycleHeads.organizationId, command.organizationId),
      ),
    )
    .limit(1)
  if (!row) throw inboxError('not_found', 'Inbox Handling Cycle head not found')
  return handlingCycleHeadFromRow(row)
}

const reopenManually = async (
  db: Database,
  command: Extract<ReopenReviewCycleFixture, { openedReason: 'manual_reopen' }>,
): Promise<void> => {
  const head = await readHead(db, command)
  const [itemRow] = await db
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, command.inboxItemId),
        eq(inboxItems.organizationId, command.organizationId),
      ),
    )
    .limit(1)
  if (!itemRow) throw inboxError('not_found', 'Inbox item not found')
  const item = itemFromRow(itemRow)
  const store = createAtomicInboxCommandStore(
    db,
    async () => ({ allowed: true }),
    () => command.openedAt,
  )
  await store.reopenReviewCycle({
    item,
    expected: {
      cycleNumber: head.currentCycleNumber,
      sourceRevision: head.currentSourceRevision,
      stateRevision: head.stateRevision,
    },
    reason: command.manualReopenReason,
    explanation: command.manualReopenExplanation,
    fact: inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus: 'closed',
      newStatus: 'open',
      userId: command.openedBy,
      occurredAt: command.openedAt,
    }),
    now: command.openedAt,
    responseTarget: command.responseTarget,
  })
}

const reopenForMaterialRevision = async (
  db: Database,
  command: Extract<
    ReopenReviewCycleFixture,
    { openedReason: 'material_revision_changed' }
  >,
): Promise<void> => {
  await db.transaction(async (tx) => {
    const [headRow] = await tx
      .select()
      .from(inboxHandlingCycleHeads)
      .where(
        and(
          eq(inboxHandlingCycleHeads.inboxItemId, command.inboxItemId),
          eq(inboxHandlingCycleHeads.organizationId, command.organizationId),
        ),
      )
      .for('update')
      .limit(1)
    if (!headRow) throw inboxError('not_found', 'Inbox Handling Cycle head not found')
    const [itemRow] = await tx
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.id, command.inboxItemId),
          eq(inboxItems.organizationId, command.organizationId),
        ),
      )
      .for('update')
      .limit(1)
    if (!itemRow) throw inboxError('not_found', 'Inbox item not found')
    const { reviewAuthority } = command.responseTarget
    await catchUpProjectionRevisions(tx, {
      item: itemFromRow(itemRow),
      revisions: [
        {
          authority: 'review.inbox-projection-revision.v1',
          organizationId: reviewAuthority.organizationId,
          propertyId: reviewAuthority.propertyId,
          reviewId: reviewAuthority.reviewId,
          sourceEpoch: reviewAuthority.sourceEpoch,
          materialReviewRevision: command.materialReviewRevision,
          eligibility: reviewAuthority.eligibility,
          responseTargetStartAt: reviewAuthority.responseTargetStartAt,
          rating: reviewAuthority.rating,
          observedAt: command.openedAt,
          sourceEpochCarry: false,
        },
      ],
      active: true,
      current: handlingCycleHeadFromRow(headRow),
      withItemCreation: false,
    })
    // Raw SQL on purpose: only the production writers the mirror guard names
    // may write the item table through the query builder.
    await tx.execute(sql`
      UPDATE inbox_items
      SET status = 'open', closed_at = NULL,
          command_revision = command_revision + 1, updated_at = ${command.openedAt}
      WHERE id = ${command.inboxItemId}
        AND organization_id = ${command.organizationId}
    `)
  })
}

export async function openNextReviewCycleForTest(
  db: Database,
  command: ReopenReviewCycleFixture,
): Promise<Readonly<{ head: HandlingCycleHead }>> {
  if (command.openedReason === 'manual_reopen') await reopenManually(db, command)
  else await reopenForMaterialRevision(db, command)
  return { head: await readHead(db, command) }
}
