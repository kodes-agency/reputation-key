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
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import type {
  CancelOrganizationClosureCommand,
  OrganizationLifecycleCommandStore,
  ReactivateOrganizationCommand,
  RequestOrganizationClosureCommand,
  TransitionOrganizationLifecycleCommand,
} from '../application/ports/organization-lifecycle-command-store.port'
import {
  ORGANIZATION_REACTIVATION_REASON_CODE,
  assertOrganizationLifecycleTransition,
  assertOrganizationLifecycleTransitionReason,
  canCancelOrganizationClosure,
  canReactivateOrganization,
  validateLifecycleEvidenceRef,
  type OrganizationLifecycleStatus,
} from '../domain/organization-lifecycle'
import { identityOrganizationLifecycleChanged } from '../domain/events'
import { organizationId as toOrganizationId } from '#/shared/domain/ids'
import { identityError } from '../domain/errors'

type ReceiptOperation = 'request' | 'cancel' | 'reactivate'
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
  // The current Better Auth membership is locked in the same transaction as
  // the lifecycle mutation. A concurrent demotion or removal therefore
  // linearizes before or after this command instead of leaving session state
  // in charge.
  const rows = await tx.execute(sql`
    SELECT m.role
    FROM member AS m
    WHERE m."organizationId" = ${input.organizationId}
      AND m."userId" = ${input.actorUserId}
    FOR UPDATE OF m
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
  options: OrganizationLifecycleCommandStoreOptions = {},
): OrganizationLifecycleCommandStore => {
  async function requestClosure(
    command: RequestOrganizationClosureCommand,
  ): Promise<OrganizationLifecycleStatus> {
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

      // The lifecycle authority row is the live closure fence. Keep the
      // interruption point after its durable transition for crash-boundary
      // verification.
      await options.interrupt?.('after_state_and_fence', 'request')

      const event = identityOrganizationLifecycleChanged({
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
    return result
  }

  async function cancelClosure(
    command: CancelOrganizationClosureCommand,
  ): Promise<OrganizationLifecycleStatus> {
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

      const event = identityOrganizationLifecycleChanged({
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
    return result
  }

  /**
   * LIF-01-T18 — clear the post-closure fence.
   *
   * This is the mirror image of `requestClosure`: one transaction commits the
   * cleared lifecycle evidence, the LIFTED Organization suspension and its new
   * policy generation, the durable fact and the replay receipt. Readiness is
   * the caller's obligation (see `reactivateOrganization`); the only decisions
   * here are authority, the state precondition and the compare-and-set.
   *
   * Migration reservation note: migration 0159 shipped BEFORE this command
   * existed, and two of its constructs still fence it —
   *   1. `guard_organization_lifecycle_revision_v1` allows no `active ->
   *      active` edge, and
   *   2. `organization_lifecycle_receipt_operation_valid` allows only
   *      'request' and 'cancel'.
   * Both belong to the migration integrator (see the wiring note in the task
   * report). Until that migration lands this method fails closed at the
   * database rather than silently half-lifting the fence, which is the safe
   * direction: an Organization that cannot prove reactivation stays fenced.
   */
  async function reactivate(
    command: ReactivateOrganizationCommand,
  ): Promise<OrganizationLifecycleStatus> {
    const result = await db.transaction(async (tx) => {
      await lockOrganizationLifecycle(tx, command.organizationId)
      await requireCurrentAccountAdmin(tx, command)
      const replay = await replayReceipt(tx, {
        ...command,
        operation: 'reactivate',
        reasonCode: ORGANIZATION_REACTIVATION_REASON_CODE,
      })
      if (replay) return replay

      const current = await readAuthorityForUpdate(tx, command.organizationId)
      const currentStatus = authorityStatus(current)
      if (!canReactivateOrganization(currentStatus)) {
        throw identityError(
          'forbidden',
          'Only an active Organization awaiting explicit reactivation can be reactivated',
        )
      }
      // The readiness evidence describes ONE revision of this Organization. A
      // concurrent closure request or operator transition invalidates it.
      if (
        currentStatus.revision !== command.expectedRevision ||
        currentStatus.closureLineageId !== command.closureLineageId
      ) {
        throw identityError(
          'organization_conflict',
          'Organization lifecycle authority changed',
        )
      }
      const supportEvidenceRef = validateLifecycleEvidenceRef(command.supportEvidenceRef)
      const rows = await tx
        .update(organizationLifecycleAuthority)
        .set({
          state: 'active',
          revision: current.revision + 1,
          // The `organization_lifecycle_state_shape` check requires an active
          // row with `reactivation_required = false` to carry NO closure
          // evidence, so the whole lineage clears together. The durable trail
          // survives in the command receipts and durable facts.
          closureLineageId: null,
          closureRequestedAt: null,
          recoverableUntil: null,
          irreversibleAt: null,
          closedAt: null,
          reactivationRequired: false,
          requestedBy: null,
          requestReasonCode: null,
          requestSupportEvidenceRef: null,
          lastTransitionAt: command.now,
          lastActorId: command.actorUserId,
          lastReasonCode: ORGANIZATION_REACTIVATION_REASON_CODE,
          lastSupportEvidenceRef: supportEvidenceRef,
        })
        .where(eq(organizationLifecycleAuthority.organizationId, command.organizationId))
        .returning()
      const status = authorityStatus(rows[0]!)

      // The authority row above has already lifted the live closure fence.
      // Keep the interruption point at the same transaction boundary.
      await options.interrupt?.('after_state_and_fence', 'reactivate')

      // The lineage and its recovery window describe the closure this
      // reactivation closes out; the fact that distinguishes it from a cancel
      // is `reactivationRequired: false`.
      const event = identityOrganizationLifecycleChanged({
        organizationId: toOrganizationId(command.organizationId),
        closureLineageId: command.closureLineageId,
        state: status.state,
        revision: status.revision,
        reactivationRequired: status.reactivationRequired,
        recoverableUntil: currentStatus.recoverableUntil!,
        occurredAt: command.now,
      })
      await insertOutboxRow(tx, event, { recordedAt: command.now })
      await writeReceipt(tx, command.operationId, 'reactivate', status)
      await options.interrupt?.('after_fact', 'reactivate')
      return status
    })
    return result
  }

  async function transition(
    command: TransitionOrganizationLifecycleCommand,
  ): Promise<OrganizationLifecycleStatus> {
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

      const event = identityOrganizationLifecycleChanged({
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
    return result
  }

  return {
    requestClosure,
    cancelClosure,
    reactivate,
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
