// Atomic inbox command store (BQC-3.4).
//
// One PostgreSQL transaction per command commits the inbox state mutation,
// outbox facts, and any consumer receipt together.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back the state mutation, the
//   outbox rows, AND the receipt together — no state/outbox/receipt split is
//   ever observable (the pre-BQC-3.4 consumers could lose the
//   inbox_item.status_changed fact between separate awaits).
// - A committed outbox row is the durable fact consumed by the relay.
// - createItem is idempotent on the (sourceType, sourceId, organizationId)
//   unique anchor: a conflicting concurrent insert re-selects the existing
//   row and records NO fact — the projection path and rebuild depend on this.
// - A guarded applyOnce transition that matches no row (lost TOCTOU race)
//   records the receipt but NO fact — redelivery converges, rebuild heals.

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxAssignmentHistory,
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxItems,
  inboxNotes,
} from '#/shared/db/schema/inbox.schema'
import type { DomainEvent } from '#/shared/events/events'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import {
  insertReceiptRow,
  reserveReceiptRow,
  restateReceiptRow,
  settleSupersededDeliveryRow,
} from './consumer-receipt-rows'
import {
  inboxItemId,
  organizationId,
  propertyId,
  userId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { Permission } from '#/shared/domain/permissions'
import type { InboxItem } from '../domain/types'
import { inboxError } from '../domain/errors'
import { isAnsweringGoogleReply } from '../domain/rules'
import {
  inboxAssignmentsReleased,
  inboxBulkAssignmentCompleted,
  inboxBulkReopenCompleted,
  inboxItemStatusChanged,
  inboxItemUnassigned,
  type InboxBulkReopenedCycle,
} from '../domain/events'
import { inTransaction } from './inbox-command-transaction'
import { inboxNoteFromRow, inboxNoteToInsertRow } from './mappers/inbox-note.mapper'
import { transitionInsert } from './review-handling-cycle.store'
import { closeHandlingCycle, createNextHandlingCycle } from '../domain/handling-cycles'
import type {
  HandlingCycleCreationAnchor,
  InboxCommandStore,
} from '../application/ports/inbox-command-store.port'
import type {
  InboxAssignmentRelease,
  InboxAssignmentReleaseReason,
} from '../domain/events'
import { cancelPrivateFeedbackTarget } from './response-target.store'
import {
  assertObservationMatchesItem,
  assertReviewProjectionCommand,
  assignmentAuthorityKey,
  handlingCycleHeadFromRow,
  itemFromRow,
  lifecycleFactFor,
  matchesLockedBulkAssignState,
  matchesLockedBulkReopenState,
  projectionTargetAnchor,
  sourceCommandPermission,
  webActorId,
} from './inbox-command-guards'
import { appendEscalationHistory } from './inbox-escalation-history'
import {
  currentAssignmentCycleNumber,
  insertAssignmentFact,
} from './inbox-assignment-facts'
import type {
  InboxCommandAuthority,
  InboxCommandAuthorityPrincipal,
  InboxCommandAuthorityRequirement,
} from './inbox-command-authority'
import {
  appendPriorityHistory,
  guardPriorityCommand,
  managerPriorityColumns,
} from './inbox-priority-history'
import {
  insertReviewItemAnsweredOnGoogle,
  lockReviewRowsForObservation,
} from './review-reply-close'
import {
  assertManualReopenHonest,
  insertNextHandlingCycleDecision,
  insertItemIdempotent,
  updateItemRow,
  lockReviewProjectionRows,
  catchUpProjectionRevisions,
  closeCycleForErasedSource,
  convergeProjectedItemRow,
  closeCycleOnObservedReply,
  reopenCycleOnDeletedReply,
  openNextFeedbackCycleOnResubmission,
  closeCycleForSourceTransition,
  scrubTransitionedItemRow,
} from './inbox-source-projection'
import { applyBulkAssignmentToItem, reopenLockedBulkItem } from './inbox-bulk-commands'

export type {
  InboxCommandAuthority,
  InboxCommandAuthorityPrincipal,
  InboxCommandAuthorityRequirement,
} from './inbox-command-authority'

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createAtomicInboxCommandStore = (
  db: Database,
  authorizeCommand: InboxCommandAuthority,
  clock: () => Date,
): InboxCommandStore => {
  const assertCommandAuthority = async (
    tx: Tx,
    organizationId: string,
    at: Date,
    requirements: readonly InboxCommandAuthorityRequirement[],
  ): Promise<void> => {
    if (requirements.length === 0) return
    const decision = await authorizeCommand(tx, {
      organizationId,
      at,
      requirements,
    })
    if (!decision.allowed) {
      throw inboxError('forbidden', 'Inbox command authority is no longer current', {
        authorityReason: decision.reason,
      })
    }
  }

  const authorityRequirements = (
    item: InboxItem,
    principals: readonly InboxCommandAuthorityPrincipal[],
  ): InboxCommandAuthorityRequirement[] =>
    principals.map((principal) => ({ ...principal, propertyId: item.propertyId }))

  const actorPrincipals = (
    item: InboxItem,
    event: DomainEvent | null,
    extraPermissions: readonly Permission[] = [],
  ): InboxCommandAuthorityPrincipal[] => {
    const actorId = webActorId(event)
    return actorId === null
      ? []
      : [
          {
            userId: actorId,
            permissions: [
              'inbox.write',
              sourceCommandPermission(item.sourceType),
              ...extraPermissions,
            ],
            purpose: 'actor',
          },
        ]
  }

  type ReleaseInput = Readonly<{
    organizationId: OrganizationId
    userId: UserId
    actorId: UserId | null
    releaseReason: InboxAssignmentReleaseReason
    at: Date
  }>

  /**
   * Clear a preselected set in canonical lock order. Review heads are locked
   * before Inbox items to match Handling Cycle commands; Inbox rows are then
   * locked and updated by item ID. A racing release is an idempotent no-op.
   */
  /** Accumulator shape for the release groups below. */
  type Mutable<T> = { -readonly [K in keyof T]: T[K] }

  const releaseAssignmentRows = async (
    tx: Tx,
    input: ReleaseInput,
    candidateIds: readonly string[],
  ): Promise<number> => {
    if (candidateIds.length === 0) return 0

    const reviewCycleRows = await tx
      .select({
        inboxItemId: inboxHandlingCycleHeads.inboxItemId,
        currentCycleNumber: inboxHandlingCycleHeads.currentCycleNumber,
      })
      .from(inboxHandlingCycleHeads)
      .innerJoin(
        inboxItems,
        and(
          eq(inboxItems.id, inboxHandlingCycleHeads.inboxItemId),
          eq(inboxItems.organizationId, inboxHandlingCycleHeads.organizationId),
          // Canonical heads use UUIDs while retained Inbox projections may
          // contain legacy text. Cast the canonical side so such a value cannot
          // abort this authority-removal path.
          sql`${inboxHandlingCycleHeads.propertyId}::text = ${inboxItems.propertyId}`,
          eq(inboxItems.sourceType, inboxHandlingCycleHeads.sourceType),
          eq(inboxItems.sourceId, inboxHandlingCycleHeads.sourceId),
        ),
      )
      .where(
        and(
          eq(inboxItems.organizationId, input.organizationId),
          eq(inboxItems.assignedTo, input.userId),
          inArray(inboxItems.id, [...candidateIds]),
        ),
      )
      .orderBy(inboxHandlingCycleHeads.inboxItemId)
      .for('share', { of: inboxHandlingCycleHeads })
    const cycleByItem = new Map(
      reviewCycleRows.map((row) => [row.inboxItemId, row.currentCycleNumber]),
    )

    const lockedRows = await tx
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.organizationId, input.organizationId),
          eq(inboxItems.assignedTo, input.userId),
          inArray(inboxItems.id, [...candidateIds]),
        ),
      )
      .orderBy(inboxItems.id)
      .for('update')

    let released = 0
    const releasedByProperty = new Map<string, Mutable<InboxAssignmentRelease>>()
    for (const current of lockedRows) {
      const [row] = await tx
        .update(inboxItems)
        .set({
          assignedTo: null,
          commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(inboxItems.id, current.id),
            eq(inboxItems.organizationId, input.organizationId),
            eq(inboxItems.assignedTo, input.userId),
          ),
        )
        .returning()
      if (!row) continue

      await tx.insert(inboxAssignmentHistory).values({
        inboxItemId: row.id,
        resultingCommandRevision: row.commandRevision,
        organizationId: row.organizationId,
        propertyId: row.propertyId,
        handlingCycleNumber: cycleByItem.get(row.id) ?? null,
        previousAssignee: input.userId,
        nextAssignee: null,
        reason: 'eligibility_lost',
        actorUserId: input.actorId,
        bulkId: null,
        occurredAt: input.at,
      })
      const fact = inboxItemUnassigned({
        inboxItemId: inboxItemId(row.id),
        organizationId: organizationId(row.organizationId),
        propertyId: propertyId(row.propertyId),
        userId: input.actorId ?? undefined,
        previousAssignee: input.userId,
        source: 'web',
        occurredAt: input.at,
      })
      await insertAssignmentFact(tx, fact, row.commandRevision)
      released += 1
      // Closing an item keeps its assignee, so a departing manager still holds
      // everything they ever handled. Releasing those is right, but only open
      // work is left without an owner: a closed item is not a gap to fill, and
      // counting it sent an urgent "give them a new one" for finished work.
      if (row.status !== 'open') continue
      // Grouped here, not in the fact's reader: a departing fleet manager can
      // hold thousands of assignments, and one entry per item would put an
      // unbounded array on the bus for a notice that is one per Property.
      // `lockedRows` is ordered by item id, so the first open row of a
      // Property is its canonical anchor.
      const group = releasedByProperty.get(row.propertyId)
      if (group) group.count += 1
      else {
        releasedByProperty.set(row.propertyId, {
          propertyId: propertyId(row.propertyId),
          anchorInboxItemId: inboxItemId(row.id),
          count: 1,
        })
      }
    }
    // The grouped close fact: the per-item facts above stay history, and this
    // one is what a notification is delivered from, once per Property, to the
    // people who now own the gap. Same transaction as the rows it describes.
    // A release of handled work alone opens no gap and records none.
    if (releasedByProperty.size > 0) {
      await insertOutboxRow(
        tx,
        inboxAssignmentsReleased({
          organizationId: input.organizationId,
          userId: input.actorId,
          releasedFrom: input.userId,
          releaseReason: input.releaseReason,
          releases: [...releasedByProperty.values()],
          occurredAt: input.at,
        }),
      )
    }
    return released
  }

  /**
   * Shared runner: single-row update + optional fact, one transaction.
   *
   * `appendHistory` runs between the compare-and-swap and the outbox insert so
   * an append-only history row, the projection update and the fact either all
   * commit or none do.
   */
  const transition = async (
    span: string,
    item: InboxItem,
    set: Record<string, unknown>,
    notFoundMessage: string,
    event: DomainEvent | null,
    at: Date,
    appendHistory?: (tx: Tx, row: InboxItem) => Promise<void>,
    lent?: Tx,
  ): Promise<InboxItem> => {
    return trace(span, async () => {
      return inTransaction(db, lent, async (tx) => {
        await assertCommandAuthority(
          tx,
          item.organizationId,
          event?.occurredAt ?? at,
          authorityRequirements(item, actorPrincipals(item, event)),
        )
        const row = await updateItemRow(tx, item, set, notFoundMessage)
        if (appendHistory) await appendHistory(tx, row)
        if (event) await insertOutboxRow(tx, event)
        return row
      })
    })
  }

  return {
    releaseAssignmentsForUser: async (input, lent) => {
      return trace('inbox.commandStore.releaseAssignmentsForUser', async () => {
        const released = await inTransaction(db, lent, async (tx) => {
          const candidates = await tx
            .select({ id: inboxItems.id })
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.organizationId, input.organizationId),
                eq(inboxItems.assignedTo, input.userId),
              ),
            )
            .orderBy(inboxItems.id)
          return releaseAssignmentRows(
            tx,
            { ...input, releaseReason: 'member_offboarded' },
            candidates.map((candidate) => candidate.id),
          )
        })
        return { released }
      })
    },

    releaseIneligibleAssignmentsForUser: async (input, lent) => {
      return trace('inbox.commandStore.releaseIneligibleAssignmentsForUser', async () => {
        const released = await inTransaction(db, lent, async (tx) => {
          const candidates = await tx
            .select({
              id: inboxItems.id,
              propertyId: inboxItems.propertyId,
              sourceType: inboxItems.sourceType,
            })
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.organizationId, input.organizationId),
                eq(inboxItems.assignedTo, input.userId),
              ),
            )
            .orderBy(inboxItems.id)
          const requirements = [
            ...new Map(
              candidates.map((candidate) => [
                assignmentAuthorityKey(candidate.propertyId, candidate.sourceType),
                {
                  propertyId: candidate.propertyId,
                  sourceType: candidate.sourceType,
                },
              ]),
            ).values(),
          ].sort(
            (left, right) =>
              left.propertyId.localeCompare(right.propertyId) ||
              left.sourceType.localeCompare(right.sourceType),
          )
          const denied = new Set<string>()
          for (const requirement of requirements) {
            const key = assignmentAuthorityKey(
              requirement.propertyId,
              requirement.sourceType,
            )
            // No canonical Property authority can ever match a retained
            // legacy text key. Release it without casting through uuid.
            if (!UUID_TEXT.test(requirement.propertyId)) {
              denied.add(key)
              continue
            }
            const decision = await authorizeCommand(tx, {
              organizationId: input.organizationId,
              at: input.at,
              requirements: [
                {
                  propertyId: requirement.propertyId,
                  userId: input.userId,
                  permissions: [
                    'inbox.write',
                    sourceCommandPermission(requirement.sourceType),
                  ],
                  purpose: 'assignee',
                },
              ],
            })
            if (decision.allowed) continue
            if (
              decision.reason.includes('authority_changed') ||
              decision.reason.includes('contract_mismatch')
            ) {
              throw inboxError(
                'revision_conflict',
                'Inbox assignment authority changed during reconciliation',
                { authorityReason: decision.reason },
              )
            }
            denied.add(key)
          }
          const candidateIds = candidates
            .filter((candidate) =>
              denied.has(
                assignmentAuthorityKey(candidate.propertyId, candidate.sourceType),
              ),
            )
            .map((candidate) => candidate.id)
          return releaseAssignmentRows(
            tx,
            { ...input, releaseReason: 'member_became_ineligible' },
            candidateIds,
          )
        })
        return { released }
      })
    },

    createItem: async (item, event, reviewCycleAnchor, lent) => {
      return trace('inbox.commandStore.createItem', async () => {
        return inTransaction(db, lent, async (tx) => {
          const inserted = await insertItemIdempotent(tx, item, reviewCycleAnchor)
          if (inserted.created && event) {
            await insertOutboxRow(tx, event)
            for (const fact of inserted.openingFacts) await insertOutboxRow(tx, fact)
          }
          return inserted
        })
      })
    },

    createReviewItemAnsweredOnGoogle: async (item, anchor, observation, lent) => {
      return trace('inbox.commandStore.createReviewItemAnsweredOnGoogle', () =>
        inTransaction(db, lent, (tx) =>
          insertReviewItemAnsweredOnGoogle(
            tx,
            { item, anchor, observation, now: clock() },
            insertItemIdempotent,
          ),
        ),
      )
    },

    reopenReviewCycle: async (command, lent) => {
      return trace('inbox.commandStore.reopenReviewCycle', async () => {
        const { item, fact, expected, now } = command
        const actorId = webActorId(fact)
        const expectedSourceRevision =
          'sourceRevision' in expected
            ? expected.sourceRevision
            : expected.materialReviewRevision
        if (
          actorId === null ||
          fact.inboxItemId !== item.id ||
          fact.organizationId !== item.organizationId ||
          fact.propertyId !== item.propertyId ||
          fact.oldStatus !== 'closed' ||
          fact.newStatus !== 'open' ||
          fact.occurredAt.getTime() !== now.getTime()
        ) {
          throw inboxError(
            'invalid_input',
            'Manual reopen fact does not match the Inbox command',
          )
        }

        return inTransaction(db, lent, async (tx) => {
          const headRows = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, item.id),
                eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, item.sourceType),
                eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          const itemRows = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.id, item.id),
                eq(inboxItems.organizationId, item.organizationId),
                eq(inboxItems.sourceType, item.sourceType),
                eq(inboxItems.sourceId, item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          const headRow = headRows[0]
          const itemRow = itemRows[0]
          if (!headRow || !itemRow) {
            throw inboxError(
              'not_found',
              'Inbox item or current Handling Cycle was not found',
            )
          }
          const expectedMatches =
            headRow.currentCycleNumber === expected.cycleNumber &&
            headRow.currentSourceRevision === expectedSourceRevision &&
            headRow.stateRevision === expected.stateRevision
          if (
            !expectedMatches ||
            headRow.status !== 'closed' ||
            itemRow.status !== headRow.status ||
            itemRow.commandRevision !== item.commandRevision
          ) {
            throw inboxError(
              'revision_conflict',
              'Inbox Handling Cycle changed; reload current state',
              {
                expected,
                current: {
                  cycleNumber: headRow.currentCycleNumber,
                  sourceRevision: headRow.currentSourceRevision,
                  stateRevision: headRow.stateRevision,
                  status: headRow.status,
                  commandRevision: itemRow.commandRevision,
                },
              },
            )
          }

          const currentItem = itemFromRow(itemRow)
          await assertCommandAuthority(
            tx,
            currentItem.organizationId,
            now,
            authorityRequirements(currentItem, actorPrincipals(currentItem, fact)),
          )
          await assertManualReopenHonest(tx, handlingCycleHeadFromRow(headRow))
          const decision = createNextHandlingCycle({
            current: handlingCycleHeadFromRow(headRow),
            sourceRevision: headRow.currentSourceRevision,
            openedReason: 'manual_reopen',
            manualReopenReason: command.reason,
            manualReopenExplanation: command.explanation,
            openedBy: userId(actorId),
            actorType: 'user',
            triggerEventId: fact.eventId,
            openedAt: now,
          })
          if (decision.isErr()) throw decision.error

          let assignedTo = itemRow.assignedTo
          let unassignedFact: ReturnType<typeof inboxItemUnassigned> | null = null
          if (assignedTo !== null) {
            const eligibility = await authorizeCommand(tx, {
              organizationId: itemRow.organizationId,
              at: now,
              requirements: [
                {
                  propertyId: itemRow.propertyId,
                  userId: assignedTo,
                  permissions: ['inbox.write', sourceCommandPermission(item.sourceType)],
                  purpose: 'assignee',
                },
              ],
            })
            if (!eligibility.allowed) {
              if (
                eligibility.reason.includes('authority_changed') ||
                eligibility.reason.includes('contract_mismatch')
              ) {
                throw inboxError(
                  'revision_conflict',
                  'Inbox assignment authority changed during reopen',
                  { authorityReason: eligibility.reason },
                )
              }
              unassignedFact = inboxItemUnassigned({
                inboxItemId: item.id,
                organizationId: item.organizationId,
                propertyId: item.propertyId,
                userId: userId(actorId),
                previousAssignee: userId(assignedTo),
                source: 'web',
                occurredAt: now,
              })
              assignedTo = null
            }
          }

          const cycleFacts = await insertNextHandlingCycleDecision(
            tx,
            decision.value,
            now,
            command.responseTarget,
          )
          const [updatedHead] = await tx
            .update(inboxHandlingCycleHeads)
            .set({
              currentCycleNumber: decision.value.head.currentCycleNumber,
              currentSourceRevision: decision.value.head.currentSourceRevision,
              ...(item.sourceType === 'review'
                ? {
                    currentMaterialReviewRevision:
                      decision.value.head.currentSourceRevision,
                  }
                : {}),
              stateRevision: decision.value.head.stateRevision,
              status: 'open',
              updatedAt: now,
            })
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, item.id),
                eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
                eq(inboxHandlingCycleHeads.currentCycleNumber, expected.cycleNumber),
                eq(inboxHandlingCycleHeads.currentSourceRevision, expectedSourceRevision),
                eq(inboxHandlingCycleHeads.stateRevision, expected.stateRevision),
                eq(inboxHandlingCycleHeads.status, 'closed'),
              ),
            )
            .returning({ id: inboxHandlingCycleHeads.inboxItemId })
          if (!updatedHead) {
            throw inboxError(
              'revision_conflict',
              'Inbox Handling Cycle changed during reopen',
            )
          }
          const [updatedItem] = await tx
            .update(inboxItems)
            .set({
              status: 'open',
              closedAt: null,
              assignedTo,
              commandRevision: item.commandRevision + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(inboxItems.id, item.id),
                eq(inboxItems.organizationId, item.organizationId),
                eq(inboxItems.commandRevision, item.commandRevision),
                eq(inboxItems.status, 'closed'),
              ),
            )
            .returning()
          if (!updatedItem) {
            throw inboxError('revision_conflict', 'Inbox item changed during reopen')
          }
          if (unassignedFact) {
            await tx.insert(inboxAssignmentHistory).values({
              inboxItemId: item.id,
              resultingCommandRevision: updatedItem.commandRevision,
              organizationId: item.organizationId,
              propertyId: item.propertyId,
              handlingCycleNumber: decision.value.head.currentCycleNumber,
              previousAssignee: itemRow.assignedTo,
              nextAssignee: null,
              reason: 'eligibility_lost',
              actorUserId: actorId,
              bulkId: null,
              occurredAt: now,
            })
          }
          await insertOutboxRow(tx, fact)
          for (const cycleFact of cycleFacts) await insertOutboxRow(tx, cycleFact)
          if (unassignedFact) {
            await insertAssignmentFact(tx, unassignedFact, updatedItem.commandRevision)
          }
          return itemFromRow(updatedItem)
        })
      })
    },

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
          await assertCommandAuthority(tx, commandOrganizationId, now, requirements)
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

    bulkAssign: async (command, lent) => {
      return trace('inbox.commandStore.bulkAssign', async () => {
        const { items, assignedTo, actorId, bulkId, occurredAt } = command
        const itemIds = items.map((item) => item.id)
        const commandOrganizationId = items[0]?.organizationId
        if (
          items.length === 0 ||
          items.length > 100 ||
          new Set(itemIds).size !== items.length ||
          commandOrganizationId === undefined ||
          items.some((item) => item.organizationId !== commandOrganizationId) ||
          !UUID_TEXT.test(bulkId)
        ) {
          throw inboxError('invalid_input', 'Inbox bulk assignment command is invalid')
        }

        return inTransaction(db, lent, async (tx) => {
          const ordered = [...items].sort((left, right) =>
            left.id.localeCompare(right.id),
          )
          const cycleItems = ordered

          // Canonical workflow lock order: every Review head, then every Inbox
          // row, both sorted by stable Inbox identity. A shared head lock keeps
          // each history row anchored to the cycle that owned the assignment.
          const headRows =
            cycleItems.length === 0
              ? []
              : await tx
                  .select()
                  .from(inboxHandlingCycleHeads)
                  .where(
                    and(
                      eq(inboxHandlingCycleHeads.organizationId, commandOrganizationId),
                      inArray(
                        inboxHandlingCycleHeads.inboxItemId,
                        cycleItems.map((item) => item.id),
                      ),
                    ),
                  )
                  .orderBy(inboxHandlingCycleHeads.inboxItemId)
                  .for('share')
          const lockedRows = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.organizationId, commandOrganizationId),
                inArray(inboxItems.id, [...itemIds]),
              ),
            )
            .orderBy(inboxItems.id)
            .for('update')
          const headByItemId = new Map(headRows.map((row) => [row.inboxItemId, row]))
          const rowByItemId = new Map(lockedRows.map((row) => [row.id, row]))
          const exact = items.every((item) =>
            matchesLockedBulkAssignState(
              item,
              rowByItemId.get(item.id),
              headByItemId.get(item.id),
            ),
          )
          if (!exact) {
            return {
              updated: 0,
              results: items.map((item) => ({
                inboxItemId: item.id,
                outcome: 'revision_conflict' as const,
              })),
            }
          }

          const requirements = ordered.flatMap((item) => {
            const principals: InboxCommandAuthorityPrincipal[] = [
              {
                userId: actorId,
                permissions: [
                  'inbox.write',
                  sourceCommandPermission(item.sourceType),
                  'inbox.manage',
                ],
                purpose: 'actor',
              },
            ]
            if (assignedTo !== null) {
              principals.push({
                userId: assignedTo,
                permissions: ['inbox.write', sourceCommandPermission(item.sourceType)],
                purpose: 'assignee',
              })
            }
            return authorityRequirements(item, principals)
          })
          await assertCommandAuthority(
            tx,
            commandOrganizationId,
            occurredAt,
            requirements,
          )

          const outcomeByItemId = new Map<
            string,
            'assigned' | 'reassigned' | 'released' | 'unchanged'
          >()
          const transitions = [] as Array<{
            inboxItemId: (typeof items)[number]['id']
            propertyId: (typeof items)[number]['propertyId']
            previousAssignee: UserId | null
            nextAssignee: UserId | null
          }>
          for (const item of ordered) {
            const applied = await applyBulkAssignmentToItem(tx, {
              item,
              currentRow: rowByItemId.get(item.id)!,
              headRow: headByItemId.get(item.id),
              assignedTo,
              actorId,
              bulkId,
              occurredAt,
            })
            if (applied.outcome === 'unchanged') {
              outcomeByItemId.set(item.id, 'unchanged')
              continue
            }
            transitions.push({
              inboxItemId: item.id,
              propertyId: item.propertyId,
              previousAssignee: applied.previousAssignee,
              nextAssignee: assignedTo,
            })
            outcomeByItemId.set(item.id, applied.outcome)
          }

          if (transitions.length > 0) {
            const completed = inboxBulkAssignmentCompleted({
              organizationId: organizationId(commandOrganizationId),
              userId: actorId,
              bulkId,
              transitions,
              occurredAt,
            })
            await insertOutboxRow(tx, completed)
          }
          return {
            updated: transitions.length,
            results: items.map((item) => ({
              inboxItemId: item.id,
              outcome: outcomeByItemId.get(item.id)!,
            })),
          }
        })
      })
    },

    assign: async (item, updates, event, now, lent) => {
      return trace('inbox.commandStore.assign', async () => {
        const stamp = now ?? clock()
        return inTransaction(db, lent, async (tx) => {
          const actorId = webActorId(event)
          const touchesAnotherAssignee =
            actorId !== null &&
            ((updates.assignedTo !== null && updates.assignedTo !== actorId) ||
              (item.assignedTo !== null && item.assignedTo !== actorId))
          const principals = actorPrincipals(
            item,
            event,
            touchesAnotherAssignee ? ['inbox.manage'] : [],
          )
          if (updates.assignedTo !== null) {
            principals.push({
              userId: updates.assignedTo,
              permissions: ['inbox.write', sourceCommandPermission(item.sourceType)],
              purpose: 'assignee',
            })
          }
          await assertCommandAuthority(
            tx,
            item.organizationId,
            stamp,
            authorityRequirements(item, principals),
          )
          const handlingCycleNumber = event
            ? await currentAssignmentCycleNumber(tx, item)
            : null
          const row = await updateItemRow(
            tx,
            item,
            { assignedTo: updates.assignedTo, updatedAt: stamp },
            'Inbox item assignment update failed — no row returned',
          )
          if (event) {
            const reason =
              item.assignedTo === null
                ? updates.assignedTo === event.userId
                  ? 'claim'
                  : 'assign'
                : updates.assignedTo === null
                  ? 'release'
                  : 'reassign'
            await tx.insert(inboxAssignmentHistory).values({
              inboxItemId: item.id,
              resultingCommandRevision: row.commandRevision,
              organizationId: item.organizationId,
              propertyId: item.propertyId,
              handlingCycleNumber,
              previousAssignee: item.assignedTo,
              nextAssignee: updates.assignedTo,
              reason,
              actorUserId: event.userId,
              bulkId: null,
              occurredAt: stamp,
            })
            await insertAssignmentFact(tx, event, row.commandRevision)
          }
          return row
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

    addNote: async (item, note, event, lent) => {
      return trace('inbox.commandStore.addNote', async () => {
        return inTransaction(db, lent, async (tx) => {
          await assertCommandAuthority(
            tx,
            item.organizationId,
            note.createdAt,
            authorityRequirements(item, actorPrincipals(item, event)),
          )
          await updateItemRow(
            tx,
            item,
            { updatedAt: note.createdAt },
            'Inbox item note update failed — no row returned',
          )
          const result = await tx
            .insert(inboxNotes)
            .values(inboxNoteToInsertRow(note))
            .returning()
          if (!result[0]) {
            throw inboxError('not_found', 'Inbox note insert failed — no row returned')
          }
          await insertOutboxRow(tx, event)
          return inboxNoteFromRow(result[0])
        })
      })
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
          const cycleAnchor: HandlingCycleCreationAnchor = command.cycleAnchor ?? {
            sourceRevision: 1,
            openedReason:
              command.item.sourceType === 'review'
                ? 'review_observed'
                : 'feedback_submitted',
            actorType: command.item.sourceType === 'review' ? 'provider' : 'guest',
            triggerEventId: command.eventId,
            openedAt: command.item.createdAt,
          }
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

          // Canonical lock order for an existing projection is head -> item.
          // For a just-inserted projection both rows are already ours, but the
          // same reads keep this path identical under an insert race.
          const { headRow, itemRow } = await lockReviewProjectionRows(tx, inserted.item)

          let current = handlingCycleHeadFromRow(headRow)
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
          const [headRow] = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                eq(inboxHandlingCycleHeads.organizationId, command.item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, command.item.sourceType),
                eq(inboxHandlingCycleHeads.sourceId, command.item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          if (!headRow) return 'obsolete' as const
          const current = handlingCycleHeadFromRow(headRow)
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
          const [updatedHead] = await tx
            .update(inboxHandlingCycleHeads)
            .set({
              stateRevision: decision.value.head.stateRevision,
              status: 'closed',
              updatedAt: command.now,
            })
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                eq(inboxHandlingCycleHeads.organizationId, command.item.organizationId),
                eq(inboxHandlingCycleHeads.stateRevision, current.stateRevision),
                eq(inboxHandlingCycleHeads.status, 'open'),
              ),
            )
            .returning({ id: inboxHandlingCycleHeads.inboxItemId })
          if (!updatedHead) {
            throw inboxError(
              'revision_conflict',
              'Handling Cycle changed during withdrawal',
            )
          }
          const [updatedItem] = await tx
            .update(inboxItems)
            .set({
              status: 'closed',
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
              ),
            )
            .returning({ id: inboxItems.id })
          if (!updatedItem) {
            throw inboxError('revision_conflict', 'Inbox item changed during withdrawal')
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

          const [headRow] = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, item.id),
                eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
                eq(inboxHandlingCycleHeads.sourceType, 'review'),
                eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
              ),
            )
            .for('update')
            .limit(1)
          if (command.closeIfOpen && !headRow) {
            throw inboxError(
              'not_found',
              'Review source transition is waiting for its Handling Cycle',
            )
          }

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
          if (!current) return

          const shouldCloseItem = command.closeIfOpen && current.status === 'open'
          const shouldCloseCycle = command.closeIfOpen && headRow?.status === 'open'
          const needsScrub =
            current.rating !== null ||
            current.snippet !== null ||
            current.reviewerName !== null
          if (!shouldCloseItem && !shouldCloseCycle && !needsScrub) return

          const cycleFact =
            shouldCloseCycle && headRow
              ? await closeCycleForSourceTransition(tx, command, headRow)
              : null

          await scrubTransitionedItemRow(tx, command, current, shouldCloseItem)
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
