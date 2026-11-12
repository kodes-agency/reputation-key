import { and, eq } from 'drizzle-orm'
import {
  inboxAssignmentHistory,
  inboxHandlingCycleHeads,
} from '#/shared/db/schema/inbox.schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { userId, type UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../domain/types'
import { inboxError } from '../domain/errors'
import {
  inboxItemAssigned,
  inboxItemUnassigned,
  type InboxBulkReopenedCycle,
} from '../domain/events'
import { createNextHandlingCycle } from '../domain/handling-cycles'
import type { BulkReopenGovernance } from '../application/ports/inbox-command-store.port'
import type { ReviewCycleTargetAnchor } from '../application/ports/review-response-target-authority.port'
import type { InboxItemBulkStatusChanged } from '../domain/events'
import {
  bulkAssignmentReason,
  handlingCycleHeadFromRow,
  itemFromRow,
  webActorId,
  type PersistedHead,
  type PersistedItem,
} from './inbox-command-guards'
import { resolveBulkReopenAssignee } from './inbox-bulk-reopen-assignee'
import { insertAssignmentFact } from './inbox-assignment-facts'
import type { InboxCommandAuthority } from './inbox-command-authority'
import {
  assertManualReopenHonest,
  insertNextHandlingCycleDecision,
  tryUpdateItemRow,
} from './inbox-source-projection'

export type AppliedBulkAssignment =
  | Readonly<{ outcome: 'unchanged' }>
  | Readonly<{
      outcome: 'assigned' | 'reassigned' | 'released'
      previousAssignee: UserId | null
    }>

/**
 * Move one already-locked item to the requested assignee, recording the
 * history row and the per-item fact. An item already on that assignee is left
 * untouched so a re-run of the same bulk command stays a no-op.
 */
export async function applyBulkAssignmentToItem(
  tx: Tx,
  input: Readonly<{
    item: InboxItem
    currentRow: PersistedItem
    headRow: PersistedHead | undefined
    assignedTo: UserId | null
    actorId: UserId
    bulkId: string
    occurredAt: Date
  }>,
): Promise<AppliedBulkAssignment> {
  const { item, currentRow, assignedTo, actorId, bulkId, occurredAt } = input
  const previousAssignee = currentRow.assignedTo ? userId(currentRow.assignedTo) : null
  if (previousAssignee === assignedTo) return { outcome: 'unchanged' }
  const row = await tryUpdateItemRow(tx, itemFromRow(currentRow), {
    assignedTo,
    updatedAt: occurredAt,
  })
  if (!row) {
    throw inboxError(
      'revision_conflict',
      'Inbox item changed while its bulk assignment lock was held',
    )
  }
  const outcome =
    assignedTo === null
      ? ('released' as const)
      : previousAssignee === null
        ? ('assigned' as const)
        : ('reassigned' as const)
  const fact = assignedTo
    ? inboxItemAssigned({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: actorId,
        assignedTo,
        previousAssignee,
        bulkId,
        source: 'web',
        occurredAt,
      })
    : inboxItemUnassigned({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: actorId,
        previousAssignee: previousAssignee!,
        bulkId,
        source: 'web',
        occurredAt,
      })
  await tx.insert(inboxAssignmentHistory).values({
    inboxItemId: item.id,
    resultingCommandRevision: row.commandRevision,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    handlingCycleNumber: input.headRow?.currentCycleNumber ?? null,
    previousAssignee,
    nextAssignee: assignedTo,
    reason: bulkAssignmentReason(assignedTo, previousAssignee, actorId),
    actorUserId: actorId,
    bulkId,
    occurredAt,
  })
  await insertAssignmentFact(tx, fact, row.commandRevision)
  return { outcome, previousAssignee }
}

/**
 * Reopen one already-locked item: drop an assignee who lost eligibility,
 * record the next Handling Cycle and its facts, advance the fenced head, and
 * flip the Inbox row. Returns the cycle it opened for the completion fact.
 */
export async function reopenLockedBulkItem(
  tx: Tx,
  authorizeCommand: InboxCommandAuthority,
  input: Readonly<{
    item: InboxItem
    event: InboxItemBulkStatusChanged
    itemRow: PersistedItem
    headRow: PersistedHead | undefined
    reason: BulkReopenGovernance['reason']
    explanation: string | null
    bulkId: string
    responseTarget: ReviewCycleTargetAnchor | undefined
    now: Date
  }>,
): Promise<InboxBulkReopenedCycle> {
  const { item, event, itemRow, headRow, now } = input
  const actorId = webActorId(event)
  if (actorId === null) {
    throw inboxError(
      'invalid_input',
      'Inbox bulk reopen requires an authenticated web actor',
    )
  }
  const { assignedTo, unassignedFact } = await resolveBulkReopenAssignee(
    tx,
    authorizeCommand,
    item,
    itemRow,
    actorId,
    now,
  )

  if (!headRow) {
    throw inboxError(
      'revision_conflict',
      'Inbox Handling Cycle disappeared during bulk reopen',
    )
  }
  await assertManualReopenHonest(tx, handlingCycleHeadFromRow(headRow))
  const decision = createNextHandlingCycle({
    current: handlingCycleHeadFromRow(headRow),
    sourceRevision: headRow.currentSourceRevision,
    openedReason: 'manual_reopen',
    manualReopenReason: input.reason,
    manualReopenExplanation: input.explanation,
    openedBy: userId(actorId),
    actorType: 'user',
    triggerEventId: event.eventId,
    openedAt: now,
  })
  if (decision.isErr()) throw decision.error
  const handlingCycleNumber = decision.value.head.currentCycleNumber
  const cycleFacts = await insertNextHandlingCycleDecision(
    tx,
    decision.value,
    now,
    input.responseTarget,
    { bulkId: input.bulkId },
  )
  const updatedHeads = await tx
    .update(inboxHandlingCycleHeads)
    .set({
      currentCycleNumber: decision.value.head.currentCycleNumber,
      currentSourceRevision: decision.value.head.currentSourceRevision,
      ...(item.sourceType === 'review'
        ? { currentMaterialReviewRevision: decision.value.head.currentSourceRevision }
        : {}),
      stateRevision: decision.value.head.stateRevision,
      status: 'open',
      updatedAt: now,
    })
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, item.id),
        eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
        eq(inboxHandlingCycleHeads.currentCycleNumber, headRow.currentCycleNumber),
        eq(inboxHandlingCycleHeads.stateRevision, headRow.stateRevision),
        eq(inboxHandlingCycleHeads.status, 'closed'),
      ),
    )
    .returning({ inboxItemId: inboxHandlingCycleHeads.inboxItemId })
  if (!updatedHeads[0]) {
    throw inboxError(
      'revision_conflict',
      'Inbox Handling Cycle changed during bulk reopen',
    )
  }

  const row = await tryUpdateItemRow(tx, itemFromRow(itemRow), {
    status: 'open',
    closedAt: null,
    assignedTo,
    updatedAt: now,
  })
  if (!row) {
    throw inboxError(
      'revision_conflict',
      'Inbox item changed while its bulk reopen lock was held',
    )
  }
  if (unassignedFact) {
    await tx.insert(inboxAssignmentHistory).values({
      inboxItemId: item.id,
      resultingCommandRevision: row.commandRevision,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      handlingCycleNumber,
      previousAssignee: itemRow.assignedTo,
      nextAssignee: null,
      reason: 'eligibility_lost',
      actorUserId: actorId,
      bulkId: input.bulkId,
      occurredAt: now,
    })
  }
  for (const fact of cycleFacts) await insertOutboxRow(tx, fact)
  if (unassignedFact) await insertAssignmentFact(tx, unassignedFact, row.commandRevision)
  await insertOutboxRow(tx, event)
  return {
    inboxItemId: item.id,
    propertyId: item.propertyId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    cycleNumber: decision.value.head.currentCycleNumber,
    sourceRevision: decision.value.head.currentSourceRevision,
    stateRevision: decision.value.head.stateRevision,
  }
}
