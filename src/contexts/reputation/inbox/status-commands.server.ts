import { and, eq, inArray } from 'drizzle-orm'
import { inboxHandlingCycleHeads, inboxItems } from '#/shared/db/schema/inbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { organizationId, userId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { inboxError } from '#/contexts/inbox/domain/errors'
import {
  inboxBulkReopenCompleted,
  type InboxBulkReopenedCycle,
} from '#/contexts/inbox/domain/events'
import { inTransaction } from '#/contexts/inbox/infrastructure/inbox-command-transaction'
import type { InboxCommandStore } from '#/contexts/inbox/application/ports/inbox-command-store.port'
import {
  matchesLockedBulkReopenState,
  sourceCommandPermission,
  webActorId,
} from '#/contexts/inbox/infrastructure/inbox-command-guards'
import { appendEscalationHistory } from '#/contexts/inbox/infrastructure/inbox-escalation-history'
import {
  appendPriorityHistory,
  guardPriorityCommand,
  managerPriorityColumns,
} from '#/contexts/inbox/infrastructure/inbox-priority-history'
import { reopenLockedBulkItem } from '#/contexts/inbox/infrastructure/inbox-bulk-commands'
import type { CommandRuntime } from './command-runtime.server'

export const createStatusCommands = (
  runtime: CommandRuntime,
): Pick<
  InboxCommandStore,
  'bulkUpdateStatus' | 'escalate' | 'setPriority' | 'resolveEscalation'
> => {
  const {
    db,
    authorizeCommand,
    clock,
    assertCommandAuthority,
    authorityRequirements,
    actorPrincipals,
    transition,
  } = runtime

  return {
    bulkUpdateStatus: async (items, perItemEvents, governance, responseTargets, lent) => {
      return trace('inbox.commandStore.bulkUpdateStatus', async () => {
        if (items.length === 0 && perItemEvents.length === 0) {
          return { updated: 0, results: [] }
        }
        const first = perItemEvents[0]
        if (!first || perItemEvents.length !== items.length) {
          throw inboxError(
            'invalid_input',
            'Inbox bulk status command items and facts must match',
          )
        }
        if (first.newStatus !== 'open') {
          throw inboxError('invalid_input', 'Inbox bulk close is unavailable')
        }
        const explanation = governance.explanation?.trim() || null
        if (
          (governance.reason === 'other' && explanation === null) ||
          (governance.reason !== 'other' && explanation !== null)
        ) {
          throw inboxError(
            'invalid_input',
            'Inbox bulk reopen reason and explanation are inconsistent',
          )
        }
        const mismatched = items.some((item, index) => {
          const event = perItemEvents[index]
          return (
            !event ||
            event.inboxItemId !== item.id ||
            event.organizationId !== item.organizationId ||
            event.propertyId !== item.propertyId ||
            event.oldStatus !== item.status ||
            event.newStatus !== first.newStatus ||
            event.bulkId !== first.bulkId ||
            event.userId !== first.userId ||
            event.occurredAt.getTime() !== first.occurredAt.getTime()
          )
        })
        if (mismatched) {
          throw inboxError(
            'invalid_input',
            'Inbox bulk status facts do not match their command items',
          )
        }
        const actorId = webActorId(first)
        if (actorId === null) {
          throw inboxError(
            'invalid_input',
            'Inbox bulk reopen requires an authenticated web actor',
          )
        }
        const now = first.occurredAt
        return inTransaction(db, lent, async (tx) => {
          // Each row is revision-fenced, while all row changes and per-item
          // facts still commit atomically as one bulk command.
          const commandOrganizationId = items[0]?.organizationId
          if (
            commandOrganizationId === undefined ||
            items.some((item) => item.organizationId !== commandOrganizationId)
          ) {
            throw inboxError(
              'invalid_input',
              'Inbox bulk status command must target one Organization',
            )
          }
          const requirements = items.flatMap((item, index) =>
            authorityRequirements(
              item,
              actorPrincipals(item, perItemEvents[index] ?? null),
            ),
          )
          // The actor and every assignee are decided in one call, so a grant
          // revoked mid-command cannot be seen half way. Only when that batch
          // denies is the actor decided alone, and each assignee is then
          // decided per item to learn which of them lost authority.
          const assigneeRequirements = items.flatMap((item) =>
            item.assignedTo === null
              ? []
              : authorityRequirements(item, [
                  {
                    userId: item.assignedTo,
                    permissions: [
                      'inbox.write',
                      sourceCommandPermission(item.sourceType),
                    ],
                    purpose: 'assignee',
                  },
                ]),
          )
          const batch =
            assigneeRequirements.length === 0
              ? null
              : await authorizeCommand(tx, {
                  organizationId: commandOrganizationId,
                  at: now,
                  requirements: [...requirements, ...assigneeRequirements],
                })
          const assigneesAuthorized = batch?.allowed === true
          if (!assigneesAuthorized) {
            await assertCommandAuthority(tx, commandOrganizationId, now, requirements)
          }
          const results: Array<
            | {
                inboxItemId: (typeof items)[number]['id']
                outcome: 'reopened' | 'revision_conflict'
              }
            | undefined
          > = new Array(items.length)
          const ordered = items
            .map((item, originalIndex) => ({
              item,
              event: perItemEvents[originalIndex]!,
              originalIndex,
            }))
            .sort((left, right) => left.item.id.localeCompare(right.item.id))

          // Canonical lock order is all source heads by item ID, followed by
          // all Inbox rows by item ID. Opposite-order overlapping batches can
          // therefore wait, but cannot deadlock or observe a split authority.
          const cycleIds = ordered.map(({ item }) => item.id)
          const headRows =
            cycleIds.length === 0
              ? []
              : await tx
                  .select()
                  .from(inboxHandlingCycleHeads)
                  .where(
                    and(
                      eq(inboxHandlingCycleHeads.organizationId, commandOrganizationId),
                      inArray(inboxHandlingCycleHeads.inboxItemId, [...cycleIds]),
                    ),
                  )
                  .orderBy(inboxHandlingCycleHeads.inboxItemId)
                  .for('update')
          const lockedItemRows = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.organizationId, commandOrganizationId),
                inArray(
                  inboxItems.id,
                  ordered.map(({ item }) => item.id),
                ),
              ),
            )
            .orderBy(inboxItems.id)
            .for('update')
          const headByItemId = new Map(headRows.map((row) => [row.inboxItemId, row]))
          const itemById = new Map(lockedItemRows.map((row) => [row.id, row]))
          const reopened: InboxBulkReopenedCycle[] = []

          for (const { event, item, originalIndex } of ordered) {
            const itemRow = itemById.get(item.id)
            const headRow = headByItemId.get(item.id)
            const stillExact =
              itemRow !== undefined &&
              headRow !== undefined &&
              matchesLockedBulkReopenState(item, itemRow, headRow)
            if (!stillExact) {
              results[originalIndex] = {
                inboxItemId: item.id,
                outcome: 'revision_conflict',
              }
              continue
            }

            reopened.push(
              await reopenLockedBulkItem(tx, authorizeCommand, {
                item,
                event,
                itemRow,
                headRow,
                reason: governance.reason,
                explanation,
                bulkId: first.bulkId,
                responseTarget: responseTargets?.get(item.id),
                assigneeAuthorized: assigneesAuthorized,
                now,
              }),
            )
            results[originalIndex] = {
              inboxItemId: item.id,
              outcome: 'reopened',
            }
          }
          // One grouped notice per recipient comes from this fact; the
          // bulk-stamped per-item reopen facts stay history only.
          if (reopened.length > 0) {
            await insertOutboxRow(
              tx,
              inboxBulkReopenCompleted({
                organizationId: organizationId(commandOrganizationId),
                userId: userId(actorId),
                bulkId: first.bulkId,
                reopened,
                occurredAt: now,
              }),
            )
          }
          return {
            updated: results.filter((result) => result?.outcome === 'reopened').length,
            results: results.filter(
              (
                result,
              ): result is {
                inboxItemId: (typeof items)[number]['id']
                outcome: 'reopened' | 'revision_conflict'
              } => result !== undefined,
            ),
          }
        })
      })
    },

    escalate: (item, updates, event, now, lent) => {
      const stamp = now ?? clock()
      return transition(
        'inbox.commandStore.escalate',
        item,
        {
          isEscalated: true,
          escalatedAt: stamp,
          escalatedBy: updates.escalatedBy,
          escalationResolvedAt: null,
          escalationResolvedBy: null,
          updatedAt: stamp,
        },
        'Inbox item escalation update failed — no row returned',
        event,
        stamp,
        (tx, row) =>
          appendEscalationHistory(tx, item, row, {
            kind: 'escalated',
            actorUserId: updates.escalatedBy,
            occurredAt: stamp,
          }),
        lent,
      )
    },

    setPriority: async (item, updates, event, now, lent) => {
      // Fail closed: `transition()` re-authorizes the actor its fact names, and
      // a fact naming no web actor would run no authority check at all.
      guardPriorityCommand(item, updates, event)
      const stamp = now ?? clock()
      return transition(
        'inbox.commandStore.setPriority',
        item,
        managerPriorityColumns(updates.priority, updates.setBy, stamp),
        'Inbox item priority update failed — no row returned',
        event,
        stamp,
        (tx, row) =>
          appendPriorityHistory(tx, item, row, {
            priority: updates.priority,
            actorUserId: updates.setBy,
            occurredAt: stamp,
          }),
        lent,
      )
    },

    resolveEscalation: (item, updates, event, now, lent) => {
      const stamp = now ?? clock()
      return transition(
        'inbox.commandStore.resolveEscalation',
        item,
        {
          isEscalated: false,
          escalationResolvedAt: stamp,
          escalationResolvedBy: updates.resolvedBy,
          updatedAt: stamp,
        },
        'Inbox item resolve-escalation failed — no row returned',
        event,
        stamp,
        (tx, row) =>
          appendEscalationHistory(tx, item, row, {
            kind: 'resolved',
            actorUserId: updates.resolvedBy,
            occurredAt: stamp,
          }),
        lent,
      )
    },
  }
}
