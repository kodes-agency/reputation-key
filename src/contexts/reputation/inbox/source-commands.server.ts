import { and, eq, sql } from 'drizzle-orm'
import {
  inboxHandlingCycleTransitions,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import {
  cycleHeadItemColumns,
  persistedHeadFromItemRow,
} from '#/contexts/reputation/inbox/inbox-cycle-head.server'
import {
  insertReceiptRow,
  reserveReceiptRow,
  restateReceiptRow,
  settleSupersededDeliveryRow,
} from '#/contexts/reputation/inbox/consumer-receipt-rows.server'
import { trace } from '#/shared/observability/trace'
import { inboxError } from '#/contexts/reputation/domain/inbox-errors'
import { isAnsweringGoogleReply } from '#/contexts/reputation/domain/inbox-rules'
import { inboxItemStatusChanged } from '#/contexts/reputation/domain/inbox-events'
import { inTransaction } from '#/contexts/reputation/inbox/inbox-command-transaction.server'
import { transitionInsert } from '#/contexts/reputation/inbox/review-handling-cycle-store.server'
import { closeHandlingCycle } from '#/contexts/reputation/domain/handling-cycles'
import type { InboxCommandStore } from '#/contexts/reputation/inbox/command-store.port.server'
import { cancelPrivateFeedbackTarget } from '#/contexts/reputation/response-targets/store.server'
import {
  assertObservationMatchesItem,
  assertReviewProjectionCommand,
  lifecycleFactFor,
  projectionTargetAnchor,
} from '#/contexts/reputation/inbox/inbox-command-guards.server'
import {
  insertReviewItemAnsweredOnGoogle,
  lockReviewRowsForObservation,
} from '#/contexts/reputation/inbox/review-reply-close.server'
import {
  insertItemIdempotent,
  lockReviewProjectionRows,
  catchUpProjectionRevisions,
  closeCycleForErasedSource,
  convergeProjectedItemRow,
  closeCycleOnObservedReply,
  reopenCycleOnDeletedReply,
  openNextFeedbackCycleOnResubmission,
  closeCycleForSourceTransition,
  closeTransitionedItemRow,
} from '#/contexts/reputation/inbox/inbox-source-projection.server'
import type { CommandRuntime } from './command-runtime.server'

export const createSourceCommands = (
  runtime: CommandRuntime,
): Pick<
  InboxCommandStore,
  | 'createItem'
  | 'createReviewItemAnsweredOnGoogle'
  | 'applySourceCreatedOnce'
  | 'applyReviewProjectionOnce'
  | 'applySourceWithdrawnOnce'
  | 'applyReviewSourceTransitionedOnce'
  | 'applyReplyObservedOnce'
  | 'settleSupersededDelivery'
  | 'recordReceipt'
> => {
  const { db } = runtime

  return {
    createItem: async (item, reviewCycleAnchor, lent) => {
      return trace('inbox.commandStore.createItem', () =>
        inTransaction(db, lent, (tx) =>
          insertItemIdempotent(tx, item, reviewCycleAnchor),
        ),
      )
    },

    createReviewItemAnsweredOnGoogle: async (item, anchor, observation, now, lent) => {
      return trace('inbox.commandStore.createReviewItemAnsweredOnGoogle', () =>
        inTransaction(db, lent, (tx) =>
          insertReviewItemAnsweredOnGoogle(
            tx,
            { item, anchor, observation, now },
            insertItemIdempotent,
          ),
        ),
      )
    },

    applySourceCreatedOnce: async (command, lent) => {
      return trace('inbox.commandStore.applySourceCreatedOnce', async () => {
        return inTransaction(db, lent, async (tx) => {
          // Reserved before anything is created. A fact that supersedes this
          // one (a withdrawal handled first) settles the delivery under the
          // same key, so exactly one of the two wins: a delivery that was
          // settled meanwhile creates nothing.
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return 'duplicate' as const
          }
          const { cycleAnchor } = command
          const inserted = await insertItemIdempotent(tx, command.item, cycleAnchor)
          if (!inserted.created) {
            const resubmissionFacts =
              command.item.sourceType === 'feedback' &&
              cycleAnchor.openedReason === 'feedback_submitted'
                ? await openNextFeedbackCycleOnResubmission(
                    tx,
                    command,
                    cycleAnchor,
                    inserted.item,
                  )
                : null
            if (resubmissionFacts) return 'applied' as const
            await restateReceiptRow(
              tx,
              command.eventId,
              command.consumerName,
              'duplicate',
            )
            return 'duplicate' as const
          }
          await insertOutboxRow(tx, command.fact)
          for (const fact of inserted.openingFacts) await insertOutboxRow(tx, fact)
          return 'applied' as const
        })
      })
    },

    applyReviewProjectionOnce: async (command, lent) => {
      return trace('inbox.commandStore.applyReviewProjectionOnce', async () => {
        assertReviewProjectionCommand(command)
        return inTransaction(db, lent, async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return 'duplicate' as const
          }

          const active = command.projection.sourceContentState === 'active'
          const initialRevision = command.projection.revisions[0]
          const inserted = await insertItemIdempotent(tx, command.item, {
            sourceRevision: initialRevision.materialReviewRevision,
            openedReason: 'review_observed',
            actorType: 'provider',
            // Reconstructed source history is keyed by immutable revision,
            // not whichever independently delivered wake-up arrived first.
            triggerEventId: null,
            openedAt: initialRevision.observedAt,
            responseTarget: active ? projectionTargetAnchor(initialRevision) : null,
          })
          let projectedChange = inserted.created
          if (inserted.created) {
            await insertOutboxRow(tx, command.fact)
            for (const fact of inserted.openingFacts) await insertOutboxRow(tx, fact)
          }

          // The Inbox row carries the Handling Cycle facts, so one row lock covers
          // both. For a just-inserted projection the row is already ours, but the
          // same read keeps this path identical under an insert race.
          const { headRow, itemRow } = await lockReviewProjectionRows(tx, inserted.item)

          let current = headRow
          if (
            current.currentSourceRevision >
            command.projection.currentMaterialReviewRevision
          ) {
            throw inboxError(
              'revision_conflict',
              'Inbox Review projection is ahead of Review authority',
            )
          }

          const catchUp = await catchUpProjectionRevisions(tx, {
            item: inserted.item,
            revisions: command.projection.revisions,
            active,
            current,
            withItemCreation: inserted.created,
          })
          if (catchUp.advanced) projectedChange = true
          current = catchUp.head

          const erasedAt = command.projection.sourceContentErasedAt
          if (!active && erasedAt instanceof Date && current.status === 'open') {
            current = await closeCycleForErasedSource(tx, {
              item: inserted.item,
              current,
              erasedAt,
            })
            projectedChange = true
          }

          if (!active && itemRow.status === 'open' && erasedAt instanceof Date) {
            const statusFact = inboxItemStatusChanged({
              inboxItemId: inserted.item.id,
              organizationId: inserted.item.organizationId,
              propertyId: inserted.item.propertyId,
              oldStatus: 'open',
              newStatus: 'closed',
              occurredAt: erasedAt,
            })
            await insertOutboxRow(tx, statusFact)
          }

          await convergeProjectedItemRow(tx, {
            item: inserted.item,
            itemRow,
            projection: command.projection,
            finalStatus: current.status,
            active,
            erasedAt,
            now: command.now,
          })
          const outcome =
            command.eventKind === 'created' && !projectedChange
              ? ('duplicate' as const)
              : ('applied' as const)
          if (outcome === 'duplicate') {
            await restateReceiptRow(
              tx,
              command.eventId,
              command.consumerName,
              'duplicate',
            )
          }
          return outcome
        })
      })
    },

    applySourceWithdrawnOnce: async (command, lent) => {
      return trace('inbox.commandStore.applySourceWithdrawnOnce', async () => {
        if (
          command.fact.inboxItemId !== command.item.id ||
          command.fact.organizationId !== command.item.organizationId ||
          command.fact.propertyId !== command.item.propertyId ||
          command.fact.oldStatus !== 'open' ||
          command.fact.newStatus !== 'closed' ||
          command.fact.occurredAt.getTime() !== command.now.getTime()
        ) {
          throw inboxError(
            'invalid_input',
            'Source withdrawal fact does not match the Inbox command',
          )
        }
        return inTransaction(db, lent, async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return 'applied' as const
          }
          const [lockedItem] = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.id, command.item.id),
                eq(inboxItems.organizationId, command.item.organizationId),
                eq(inboxItems.sourceType, command.item.sourceType),
                eq(inboxItems.sourceId, command.item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          const headRow = lockedItem ? persistedHeadFromItemRow(lockedItem) : null
          if (!headRow) return 'obsolete' as const
          const current = headRow
          if (
            command.sourceRevision !== undefined &&
            current.currentSourceRevision !== command.sourceRevision
          ) {
            await restateReceiptRow(tx, command.eventId, command.consumerName, 'obsolete')
            return 'obsolete' as const
          }
          if (current.status === 'closed') return 'applied' as const
          const decision = closeHandlingCycle({
            current,
            closeReason: 'guest_withdrawn',
            actorType: 'guest',
            actorUserId: null,
            triggerEventId: command.eventId,
            closedAt: command.now,
          })
          if (decision.isErr()) throw decision.error
          if (current.sourceType === 'feedback') {
            await cancelPrivateFeedbackTarget(tx, current, command.now)
          }
          const lifecycleFact = lifecycleFactFor(decision.value.transition)
          await tx
            .insert(inboxHandlingCycleTransitions)
            .values(transitionInsert(decision.value.transition, command.now))
          const [updatedItem] = await tx
            .update(inboxItems)
            .set({
              status: 'closed',
              ...cycleHeadItemColumns(decision.value.head),
              closedAt: command.now,
              commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
              updatedAt: command.now,
            })
            .where(
              and(
                eq(inboxItems.id, command.item.id),
                eq(inboxItems.organizationId, command.item.organizationId),
                eq(inboxItems.sourceType, command.item.sourceType),
                eq(inboxItems.sourceId, command.item.sourceId),
                eq(inboxItems.stateRevision, current.stateRevision),
                eq(inboxItems.status, 'open'),
              ),
            )
            .returning({ id: inboxItems.id })
          if (!updatedItem) {
            throw inboxError(
              'revision_conflict',
              'Handling Cycle changed during withdrawal',
            )
          }
          await insertOutboxRow(tx, command.fact)
          await insertOutboxRow(tx, lifecycleFact)
          return 'applied' as const
        })
      })
    },

    applyReviewSourceTransitionedOnce: async (command, lent) => {
      return trace('inbox.commandStore.applyReviewSourceTransitionedOnce', async () => {
        const { closeFact, item } = command
        if (
          item.sourceType !== 'review' ||
          closeFact.inboxItemId !== item.id ||
          closeFact.organizationId !== item.organizationId ||
          closeFact.propertyId !== item.propertyId ||
          closeFact.oldStatus !== 'open' ||
          closeFact.newStatus !== 'closed' ||
          closeFact.occurredAt.getTime() !== command.transitionedAt.getTime()
        ) {
          throw inboxError(
            'invalid_input',
            'Review source transition fact does not match the Inbox item',
          )
        }

        await inTransaction(db, lent, async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName)))
            return

          const [current] = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.id, item.id),
                eq(inboxItems.organizationId, item.organizationId),
                eq(inboxItems.propertyId, item.propertyId),
                eq(inboxItems.sourceType, 'review'),
                eq(inboxItems.sourceId, item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          const headRow = current ? persistedHeadFromItemRow(current) : null
          if (!headRow) {
            throw inboxError(
              'not_found',
              'Review source transition is waiting for its Handling Cycle',
            )
          }
          if (!current) return

          const shouldCloseItem = current.status === 'open'
          const shouldCloseCycle = headRow?.status === 'open'
          if (!shouldCloseItem && !shouldCloseCycle) return

          const cycleFact =
            shouldCloseCycle && headRow
              ? await closeCycleForSourceTransition(tx, command, headRow)
              : null

          await closeTransitionedItemRow(tx, command, current, shouldCloseItem)
          if (shouldCloseItem) await insertOutboxRow(tx, closeFact)
          if (cycleFact) await insertOutboxRow(tx, cycleFact)
        })

        return 'applied' as const
      })
    },

    applyReplyObservedOnce: async (command, lent) => {
      return trace('inbox.commandStore.applyReplyObservedOnce', async () => {
        await inTransaction(db, lent, async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName)))
            return

          const observation = command.currentObservation
          assertObservationMatchesItem(observation, command.item)

          const { headRow, itemRow } = await lockReviewRowsForObservation(
            tx,
            command.item,
            observation,
          )

          const shouldClose = isAnsweringGoogleReply(observation)
          const reopenReason =
            observation.reviewSourceContentState === 'active' &&
            observation.state === 'absent' &&
            observation.change === 'deleted' &&
            observation.resolution === 'absent'
              ? ('provider_reply_deleted' as const)
              : null

          if (shouldClose && itemRow.status === 'open') {
            await closeCycleOnObservedReply(tx, command, {
              headRow,
              itemRow,
              observation,
            })
            return
          }

          if (reopenReason !== null && itemRow.status === 'closed') {
            await reopenCycleOnDeletedReply(tx, command, {
              headRow,
              observation,
              reopenReason,
            })
          }
        })
        return 'applied' as const
      })
    },

    settleSupersededDelivery: (eventId, consumerName, organizationId) =>
      settleSupersededDeliveryRow(db, eventId, consumerName, organizationId),

    recordReceipt: async (eventId, consumerName, status, lent) => {
      return trace('inbox.commandStore.recordReceipt', async () => {
        await inTransaction(db, lent, async (tx) => {
          await insertReceiptRow(tx, eventId, consumerName, status)
        })
      })
    },
  }
}
