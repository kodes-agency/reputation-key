import { and, eq, inArray, sql } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import {
  inboxItemId,
  organizationId,
  propertyId,
  userId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { inboxError } from '#/contexts/reputation/domain/inbox-errors'
import { INBOX_BULK_LIMIT } from '#/contexts/reputation/inbox/contracts'
import {
  inboxAssignmentsReleased,
  inboxBulkAssignmentCompleted,
  inboxItemUnassigned,
  type InboxAssignmentRelease,
  type InboxAssignmentReleaseReason,
} from '#/contexts/reputation/domain/inbox-events'
import { inTransaction } from '#/contexts/reputation/inbox/inbox-command-transaction.server'
import {
  cycleHeadItemColumns,
  persistedHeadFromItemRow,
} from '#/contexts/reputation/inbox/inbox-cycle-head.server'
import { createNextHandlingCycle } from '#/contexts/reputation/domain/handling-cycles'
import type { InboxCommandStore } from '#/contexts/reputation/inbox/command-store.port.server'
import {
  assignmentAuthorityKey,
  isAuthorityContractChange,
  matchesLockedBulkAssignState,
  sourceCommandPermission,
  webActorId,
} from '#/contexts/reputation/inbox/inbox-command-guards.server'
import { inboxItemFromRow } from '#/contexts/reputation/inbox/inbox-mapper.server'
import {
  appendAssignmentHistory,
  currentAssignmentCycleNumber,
  insertAssignmentFact,
} from '#/contexts/reputation/inbox/inbox-assignment-facts.server'
import type {
  InboxCommandAuthorityPrincipal,
  InboxCommandAuthorityRequirement,
} from '#/contexts/reputation/inbox/inbox-command-authority.server'
import {
  assertManualReopenHonest,
  insertNextHandlingCycleDecision,
  updateItemRow,
} from '#/contexts/reputation/inbox/inbox-source-projection.server'
import { applyBulkAssignmentToItem } from '#/contexts/reputation/inbox/inbox-bulk-commands.server'
import type { CommandRuntime } from './command-runtime.server'

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createAssignmentCommands = (
  runtime: CommandRuntime,
): Pick<
  InboxCommandStore,
  'releaseIneligibleAssignmentsForUser' | 'reopenReviewCycle' | 'bulkAssign' | 'assign'
> => {
  const {
    db,
    authorizeCommand,
    assertCommandAuthority,
    authorityRequirements,
    actorPrincipals,
  } = runtime
  // The actor and the assignee are decided in one call, so a grant revoked
  // mid-command cannot be seen half way. Only when that denies is the actor
  // decided alone; the assignee requirement is then returned for its own check.
  const authorizeReopen = async (
    tx: Tx,
    currentItem: Parameters<typeof authorityRequirements>[0],
    principals: Parameters<typeof authorityRequirements>[1],
    assignedTo: string | null,
    now: Date,
  ): Promise<InboxCommandAuthorityRequirement | null> => {
    const actorRequirements = authorityRequirements(currentItem, principals)
    if (assignedTo === null) {
      await assertCommandAuthority(tx, currentItem.organizationId, now, actorRequirements)
      return null
    }
    const assigneeRequirement: InboxCommandAuthorityRequirement = {
      propertyId: currentItem.propertyId,
      userId: assignedTo,
      permissions: ['inbox.write', sourceCommandPermission(currentItem.sourceType)],
      purpose: 'assignee',
    }
    const together = await authorizeCommand(tx, {
      organizationId: currentItem.organizationId,
      at: now,
      requirements: [...actorRequirements, assigneeRequirement],
    })
    if (together.allowed) return null
    await assertCommandAuthority(tx, currentItem.organizationId, now, actorRequirements)
    return assigneeRequirement
  }

  const assigneeLostEligibility = async (
    tx: Tx,
    organizationId: OrganizationId,
    requirement: InboxCommandAuthorityRequirement,
    now: Date,
  ): Promise<boolean> => {
    const eligibility = await authorizeCommand(tx, {
      organizationId,
      at: now,
      requirements: [requirement],
    })
    if (eligibility.allowed) return false
    if (isAuthorityContractChange(eligibility.reason)) {
      throw inboxError(
        'revision_conflict',
        'Inbox assignment authority changed during reopen',
        { authorityReason: eligibility.reason },
      )
    }
    return true
  }

  type ReleaseInput = Readonly<{
    organizationId: OrganizationId
    userId: UserId
    actorId: UserId | null
    releaseReason: InboxAssignmentReleaseReason
    at: Date
  }>

  /**
   * Clear a preselected set in canonical lock order: Inbox rows are locked and
   * updated by item ID. A racing release is an idempotent no-op.
   */
  /** Accumulator shape for the release groups below. */
  type Mutable<T> = { -readonly [K in keyof T]: T[K] }

  const releaseAssignmentRows = async (
    tx: Tx,
    input: ReleaseInput,
    candidateIds: readonly string[],
  ): Promise<number> => {
    if (candidateIds.length === 0) return 0

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

      await appendAssignmentHistory(tx, row, {
        resultingCommandRevision: row.commandRevision,
        handlingCycleNumber: current.currentCycleNumber,
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

  return {
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
          const assigneeRequirement = (
            requirement: (typeof requirements)[number],
          ): InboxCommandAuthorityRequirement => ({
            propertyId: requirement.propertyId,
            userId: input.userId,
            permissions: ['inbox.write', sourceCommandPermission(requirement.sourceType)],
            purpose: 'assignee',
          })
          // One Accounts call decides every retained key. Only when it denies
          // does each key get its own call to tell which ones lost authority.
          const checkable = requirements.filter((requirement) =>
            UUID_TEXT.test(requirement.propertyId),
          )
          const everyKeyHolds =
            checkable.length > 0 &&
            (
              await authorizeCommand(tx, {
                organizationId: input.organizationId,
                at: input.at,
                requirements: checkable.map(assigneeRequirement),
              })
            ).allowed
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
            if (everyKeyHolds) continue
            const decision = await authorizeCommand(tx, {
              organizationId: input.organizationId,
              at: input.at,
              requirements: [assigneeRequirement(requirement)],
            })
            if (decision.allowed) continue
            if (isAuthorityContractChange(decision.reason)) {
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
            {
              ...input,
              releaseReason: input.releaseReason ?? 'member_became_ineligible',
            },
            candidateIds,
          )
        })
        return { released }
      })
    },

    reopenReviewCycle: async (command, lent) => {
      return trace('inbox.commandStore.reopenReviewCycle', async () => {
        const { item, fact, expected, now } = command
        const actorId = webActorId(fact)
        const expectedSourceRevision = expected.sourceRevision
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
          const itemRow = itemRows[0]
          const headRow = itemRow ? persistedHeadFromItemRow(itemRow) : null
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

          const currentItem = inboxItemFromRow(itemRow)
          const pendingAssignee = await authorizeReopen(
            tx,
            currentItem,
            actorPrincipals(currentItem, fact),
            itemRow.assignedTo,
            now,
          )
          await assertManualReopenHonest(tx, headRow)
          const decision = createNextHandlingCycle({
            current: headRow,
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
          if (
            assignedTo !== null &&
            pendingAssignee !== null &&
            (await assigneeLostEligibility(tx, item.organizationId, pendingAssignee, now))
          ) {
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

          const cycleFacts = await insertNextHandlingCycleDecision(
            tx,
            decision.value,
            now,
            command.responseTarget,
          )
          const [updatedItem] = await tx
            .update(inboxItems)
            .set({
              status: 'open',
              ...cycleHeadItemColumns(decision.value.head),
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
                eq(inboxItems.currentCycleNumber, expected.cycleNumber),
                eq(inboxItems.currentSourceRevision, expectedSourceRevision),
                eq(inboxItems.stateRevision, expected.stateRevision),
                eq(inboxItems.status, 'closed'),
              ),
            )
            .returning()
          if (!updatedItem) {
            throw inboxError('revision_conflict', 'Inbox item changed during reopen')
          }
          if (unassignedFact) {
            await appendAssignmentHistory(tx, item, {
              resultingCommandRevision: updatedItem.commandRevision,
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
          return inboxItemFromRow(updatedItem)
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
          items.length > INBOX_BULK_LIMIT ||
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

          // Every Inbox row is locked by stable Inbox identity; each carries its
          // Handling Cycle facts, so one lock keeps every history row anchored to
          // the cycle that owned the assignment.
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
          const rowByItemId = new Map(lockedRows.map((row) => [row.id, row]))
          const exact = items.every((item) =>
            matchesLockedBulkAssignState(item, rowByItemId.get(item.id)),
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

    assign: async (item, updates, event, lent) => {
      return trace('inbox.commandStore.assign', async () => {
        const stamp = event.occurredAt
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
          const handlingCycleNumber = await currentAssignmentCycleNumber(tx, item)
          const row = await updateItemRow(
            tx,
            item,
            { assignedTo: updates.assignedTo, updatedAt: stamp },
            'Inbox item assignment update failed — no row returned',
          )
          const reason =
            item.assignedTo === null
              ? updates.assignedTo === event.userId
                ? 'claim'
                : 'assign'
              : updates.assignedTo === null
                ? 'release'
                : 'reassign'
          await appendAssignmentHistory(tx, item, {
            resultingCommandRevision: row.commandRevision,
            handlingCycleNumber,
            previousAssignee: item.assignedTo,
            nextAssignee: updates.assignedTo,
            reason,
            actorUserId: event.userId,
            bulkId: null,
            occurredAt: stamp,
          })
          await insertAssignmentFact(tx, event, row.commandRevision)
          return row
        })
      })
    },
  }
}
