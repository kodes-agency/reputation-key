// Identity-owned Organization lifecycle command store (LIF-01).
//
// Request commits lifecycle revision + Organization suspension/policy version
// + content-minimal outbox fact + retry receipt in one transaction. Cancel is
// deliberately narrower: it cancels only the recoverable lifecycle request,
// retains the Organization suspension, and marks explicit reactivation work.

import { and, asc, eq, inArray, lte, ne, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  organizationLifecycleAuthority,
  organizationLifecycleCommandReceipts,
} from '#/shared/db/schema/organization-lifecycle.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import type {
  CancelOrganizationClosureCommand,
  OrganizationLifecycleCommandStore,
  RequestOrganizationClosureCommand,
  TransitionOrganizationLifecycleCommand,
} from '../application/ports/organization-lifecycle-command-store.port'
import {
  assertOrganizationLifecycleTransition,
  assertOrganizationLifecycleTransitionReason,
  canCancelOrganizationClosure,
  validateLifecycleEvidenceRef,
  type OrganizationLifecycleStatus,
} from '../domain/organization-lifecycle'
import { identityOrganizationLifecycleChanged } from '../domain/events'
import { organizationId as toOrganizationId } from '#/shared/domain/ids'
import { identityError } from '../domain/errors'
import { setOrganizationPolicy } from './repositories/policy-state.repository'

type ReceiptOperation = 'request' | 'cancel'
type Operation = ReceiptOperation | 'transition'
type FaultStage = 'after_state_and_fence' | 'after_fact'

export type OrganizationLifecycleCommandStoreOptions = Readonly<{
  /** Transaction-bound interruption seam used only by atomicity verification. */
  interrupt?: (stage: FaultStage, operation: Operation) => Promise<void>
}>

type Receipt = typeof organizationLifecycleCommandReceipts.$inferSelect
type Authority = typeof organizationLifecycleAuthority.$inferSelect

function authorityStatus(row: Authority): OrganizationLifecycleStatus {
  return {
    organizationId: row.organizationId,
    state: row.state as OrganizationLifecycleStatus['state'],
    revision: row.revision,
    closureLineageId: row.closureLineageId,
    closureRequestedAt: row.closureRequestedAt,
    recoverableUntil: row.recoverableUntil,
    irreversibleAt: row.irreversibleAt,
    closedAt: row.closedAt,
    reactivationRequired: row.reactivationRequired,
    lastTransitionAt: row.lastTransitionAt,
    lastActorId: row.lastActorId,
    lastReasonCode: row.lastReasonCode,
    lastSupportEvidenceRef: row.lastSupportEvidenceRef,
  }
}

function receiptStatus(row: Receipt): OrganizationLifecycleStatus {
  return {
    organizationId: row.organizationId,
    state: row.resultState as OrganizationLifecycleStatus['state'],
    revision: row.resultRevision,
    closureLineageId: row.closureLineageId,
    closureRequestedAt: row.closureRequestedAt,
    recoverableUntil: row.recoverableUntil,
    irreversibleAt: row.irreversibleAt,
    closedAt: row.closedAt,
    reactivationRequired: row.reactivationRequired,
    lastTransitionAt: row.lastTransitionAt,
    lastActorId: row.lastActorId,
    lastReasonCode: row.lastReasonCode,
    lastSupportEvidenceRef: row.lastSupportEvidenceRef,
  }
}

async function lockOrganizationLifecycle(tx: Tx, organizationId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`organization-lifecycle:${organizationId}`}, 0))`,
  )
}

async function requireCurrentAccountAdmin(
  tx: Tx,
  input: Readonly<{ organizationId: string; actorUserId: string }>,
): Promise<void> {
  // Both current membership and the app-owned single-Organization binding are
  // locked. A concurrent demotion/removal/release therefore linearizes before
  // or after this command instead of leaving session authority in charge.
  const rows = await tx.execute(sql`
    SELECT m.role
    FROM member AS m
    INNER JOIN user_organization_bindings AS binding
      ON binding.user_id = m."userId"
     AND binding.organization_id = m."organizationId"
     AND binding.state = 'active'
    WHERE m."organizationId" = ${input.organizationId}
      AND m."userId" = ${input.actorUserId}
    FOR UPDATE OF m, binding
  `)
  const row = rows.rows[0] as { role: string } | undefined
  if (!row || row.role !== 'owner') {
    throw identityError(
      'forbidden',
      'A current AccountAdmin is required for Organization lifecycle changes',
    )
  }
}

async function readAuthorityForUpdate(
  tx: Tx,
  organizationId: string,
): Promise<Authority> {
  const rows = await tx
    .select()
    .from(organizationLifecycleAuthority)
    .where(eq(organizationLifecycleAuthority.organizationId, organizationId))
    .limit(1)
    .for('update')
  const row = rows[0]
  if (!row) {
    throw identityError(
      'org_setup_failed',
      'Organization lifecycle authority is unavailable',
    )
  }
  return row
}

async function replayReceipt(
  tx: Tx,
  input: Readonly<{
    operationId: string
    organizationId: string
    operation: ReceiptOperation
    actorUserId: string
    reasonCode: string
    supportEvidenceRef: string
  }>,
): Promise<OrganizationLifecycleStatus | null> {
  const rows = await tx
    .select()
    .from(organizationLifecycleCommandReceipts)
    .where(eq(organizationLifecycleCommandReceipts.operationId, input.operationId))
    .limit(1)
  const receipt = rows[0]
  if (!receipt) return null
  if (
    receipt.organizationId !== input.organizationId ||
    receipt.operation !== input.operation ||
    receipt.lastActorId !== input.actorUserId ||
    receipt.lastReasonCode !== input.reasonCode ||
    receipt.lastSupportEvidenceRef !== input.supportEvidenceRef
  ) {
    throw identityError(
      'organization_conflict',
      'Organization lifecycle operation identifier is already bound',
    )
  }
  return receiptStatus(receipt)
}

async function writeReceipt(
  tx: Tx,
  operationId: string,
  operation: ReceiptOperation,
  status: OrganizationLifecycleStatus,
): Promise<void> {
  await tx.insert(organizationLifecycleCommandReceipts).values({
    operationId,
    organizationId: status.organizationId,
    operation,
    resultState: status.state,
    resultRevision: status.revision,
    closureLineageId: status.closureLineageId,
    closureRequestedAt: status.closureRequestedAt,
    recoverableUntil: status.recoverableUntil,
    irreversibleAt: status.irreversibleAt,
    closedAt: status.closedAt,
    reactivationRequired: status.reactivationRequired,
    lastTransitionAt: status.lastTransitionAt,
    lastActorId: status.lastActorId,
    lastReasonCode: status.lastReasonCode,
    lastSupportEvidenceRef: status.lastSupportEvidenceRef,
    occurredAt: status.lastTransitionAt,
  })
}

export const createOrganizationLifecycleCommandStore = (
  db: Database,
  events: EventBus,
  options: OrganizationLifecycleCommandStoreOptions = {},
): OrganizationLifecycleCommandStore => {
  async function requestClosure(
    command: RequestOrganizationClosureCommand,
  ): Promise<OrganizationLifecycleStatus> {
    let event: ReturnType<typeof identityOrganizationLifecycleChanged> | null = null
    const result = await db.transaction(async (tx) => {
      await lockOrganizationLifecycle(tx, command.organizationId)
      await requireCurrentAccountAdmin(tx, command)
      const replay = await replayReceipt(tx, { ...command, operation: 'request' })
      if (replay) return replay

      const current = await readAuthorityForUpdate(tx, command.organizationId)
      if (current.state !== 'active' || current.reactivationRequired) {
        throw identityError(
          'already_exists',
          'Organization is not fully active for a new closure request',
        )
      }
      const revision = current.revision + 1
      const rows = await tx
        .update(organizationLifecycleAuthority)
        .set({
          state: 'closure_requested',
          revision,
          closureLineageId: command.operationId,
          closureRequestedAt: command.now,
          recoverableUntil: command.recoverableUntil,
          irreversibleAt: null,
          closedAt: null,
          reactivationRequired: true,
          requestedBy: command.actorUserId,
          requestReasonCode: command.reasonCode,
          requestSupportEvidenceRef: command.supportEvidenceRef,
          lastTransitionAt: command.now,
          lastActorId: command.actorUserId,
          lastReasonCode: command.reasonCode,
          lastSupportEvidenceRef: command.supportEvidenceRef,
        })
        .where(eq(organizationLifecycleAuthority.organizationId, command.organizationId))
        .returning()
      const status = authorityStatus(rows[0]!)

      // Stable machine reason only. This statement also bumps policy_version;
      // both it and the lifecycle revision remain inside this transaction.
      await setOrganizationPolicy(tx, {
        organizationId: command.organizationId,
        suspendedAt: command.now,
        suspendedReason: 'lifecycle:closure_requested',
      })
      await options.interrupt?.('after_state_and_fence', 'request')

      event = identityOrganizationLifecycleChanged({
        organizationId: toOrganizationId(command.organizationId),
        closureLineageId: command.operationId,
        state: status.state,
        revision: status.revision,
        reactivationRequired: status.reactivationRequired,
        recoverableUntil: command.recoverableUntil,
        occurredAt: command.now,
      })
      await insertOutboxRow(tx, event, { recordedAt: command.now })
      await writeReceipt(tx, command.operationId, 'request', status)
      await options.interrupt?.('after_fact', 'request')
      return status
    })
    if (event) await emitAfterCommit(events, event)
    return result
  }

  async function cancelClosure(
    command: CancelOrganizationClosureCommand,
  ): Promise<OrganizationLifecycleStatus> {
    let event: ReturnType<typeof identityOrganizationLifecycleChanged> | null = null
    const result = await db.transaction(async (tx) => {
      await lockOrganizationLifecycle(tx, command.organizationId)
      await requireCurrentAccountAdmin(tx, command)
      const replay = await replayReceipt(tx, { ...command, operation: 'cancel' })
      if (replay) return replay

      const current = await readAuthorityForUpdate(tx, command.organizationId)
      if (
        !canCancelOrganizationClosure({
          state: current.state as OrganizationLifecycleStatus['state'],
          recoverableUntil: current.recoverableUntil,
          now: command.now,
        })
      ) {
        throw identityError('forbidden', 'Organization closure is no longer recoverable')
      }
      const revision = current.revision + 1
      const rows = await tx
        .update(organizationLifecycleAuthority)
        .set({
          state: 'active',
          revision,
          // The closure lineage and request evidence remain as the durable
          // cancellation trail. Suspension also remains untouched.
          reactivationRequired: true,
          lastTransitionAt: command.now,
          lastActorId: command.actorUserId,
          lastReasonCode: command.reasonCode,
          lastSupportEvidenceRef: command.supportEvidenceRef,
        })
        .where(eq(organizationLifecycleAuthority.organizationId, command.organizationId))
        .returning()
      const status = authorityStatus(rows[0]!)
      await options.interrupt?.('after_state_and_fence', 'cancel')

      event = identityOrganizationLifecycleChanged({
        organizationId: toOrganizationId(command.organizationId),
        closureLineageId: status.closureLineageId!,
        state: status.state,
        revision: status.revision,
        reactivationRequired: status.reactivationRequired,
        recoverableUntil: status.recoverableUntil!,
        occurredAt: command.now,
      })
      await insertOutboxRow(tx, event, { recordedAt: command.now })
      await writeReceipt(tx, command.operationId, 'cancel', status)
      await options.interrupt?.('after_fact', 'cancel')
      return status
    })
    if (event) await emitAfterCommit(events, event)
    return result
  }

  async function transition(
    command: TransitionOrganizationLifecycleCommand,
  ): Promise<OrganizationLifecycleStatus> {
    let event: ReturnType<typeof identityOrganizationLifecycleChanged> | null = null
    const result = await db.transaction(async (tx) => {
      await lockOrganizationLifecycle(tx, command.organizationId)
      const current = await readAuthorityForUpdate(tx, command.organizationId)
      const currentStatus = authorityStatus(current)

      // A caller retrying after an ambiguous response receives the exact
      // committed result without another revision or fact.
      if (
        currentStatus.state === command.to &&
        currentStatus.revision === command.expectedRevision + 1 &&
        currentStatus.closureLineageId === command.closureLineageId &&
        currentStatus.lastActorId === command.actorUserId &&
        currentStatus.lastReasonCode === command.reasonCode &&
        currentStatus.lastSupportEvidenceRef === command.supportEvidenceRef
      ) {
        return currentStatus
      }

      if (
        currentStatus.state !== command.from ||
        currentStatus.revision !== command.expectedRevision ||
        currentStatus.closureLineageId !== command.closureLineageId
      ) {
        throw identityError(
          'organization_conflict',
          'Organization lifecycle authority changed',
        )
      }
      assertOrganizationLifecycleTransition(command.from, command.to)
      assertOrganizationLifecycleTransitionReason(
        command.from,
        command.to,
        command.reasonCode,
      )
      const supportEvidenceRef = validateLifecycleEvidenceRef(command.supportEvidenceRef)
      const revision = current.revision + 1
      const rows = await tx
        .update(organizationLifecycleAuthority)
        .set({
          state: command.to,
          revision,
          irreversibleAt: command.to === 'purging' ? command.now : current.irreversibleAt,
          closedAt: command.to === 'closed' ? command.now : current.closedAt,
          reactivationRequired: true,
          lastTransitionAt: command.now,
          lastActorId: command.actorUserId,
          lastReasonCode: command.reasonCode,
          lastSupportEvidenceRef: supportEvidenceRef,
        })
        .where(eq(organizationLifecycleAuthority.organizationId, command.organizationId))
        .returning()
      const status = authorityStatus(rows[0]!)
      await options.interrupt?.('after_state_and_fence', 'transition')

      event = identityOrganizationLifecycleChanged({
        organizationId: toOrganizationId(command.organizationId),
        closureLineageId: command.closureLineageId,
        state: status.state,
        revision: status.revision,
        reactivationRequired: status.reactivationRequired,
        recoverableUntil: status.recoverableUntil!,
        occurredAt: command.now,
      })
      await insertOutboxRow(tx, event, { recordedAt: command.now })
      await options.interrupt?.('after_fact', 'transition')
      return status
    })
    if (event) await emitAfterCommit(events, event)
    return result
  }

  return {
    requestClosure,
    cancelClosure,
    transition,
    getAuthority: async (organizationId) =>
      db.transaction(async (tx) => {
        await lockOrganizationLifecycle(tx, organizationId)
        return authorityStatus(await readAuthorityForUpdate(tx, organizationId))
      }),
    listCandidates: async (input) => {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
        throw new Error('Organization lifecycle candidate limit must be 1..50')
      }
      if (input.states.length === 0) return []
      const rows = await db
        .select()
        .from(organizationLifecycleAuthority)
        .where(
          and(
            inArray(organizationLifecycleAuthority.state, input.states),
            or(
              ne(organizationLifecycleAuthority.state, 'closing'),
              lte(organizationLifecycleAuthority.recoverableUntil, input.now),
            ),
          ),
        )
        .orderBy(asc(organizationLifecycleAuthority.lastTransitionAt))
        .limit(input.limit)
      return rows.map(authorityStatus)
    },
    getStatus: async (input) =>
      db.transaction(async (tx) => {
        await lockOrganizationLifecycle(tx, input.organizationId)
        await requireCurrentAccountAdmin(tx, input)
        return authorityStatus(await readAuthorityForUpdate(tx, input.organizationId))
      }),
  }
}
