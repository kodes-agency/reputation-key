// Property context — advance region move use case (BQC-4.5 / ADR 0057,
// retaining the ADR 0048 workflow seam for future expansion).
//
// The operator-driven stepper for the move rehearsal and future real moves.
// One call requests ONE transition ({ toState }); the machine
// (domain/region-move-workflow) validates it. External effects are ordered so
// crashes remain safely retryable; Property authority changes co-commit with
// the state CAS, and rollback resumes queues only after source restoration.
//
// Per-state effects:
//   writes_paused    — PAUSE the property-scoped queues via the BQC-0.4
//                      queue-quarantine primitive (jobs preserved, never dropped)
//   queues_drained   — verify queue depths are zero via the BQC-3.7 depth
//                      reader; not drained → STAY + report 'queues_not_drained'
//   data_copied      — POLICY GATE: with no second cell there is nothing to
//                      copy; the operator confirmation token (confirmedBy) is
//                      recorded on the row. Real copy lands with the second
//                      cell (BQC-7 / Europe evidence).
//   verified         — POLICY GATE (same comment as data_copied)
//   target_activated — the repository co-commits the source-of-truth swap and
//                      state-revision CAS in ONE PostgreSQL transaction
//   source_erased    — record-only while there is one cell (nothing exists to
//                      erase; the erasure contract is the transition itself)
//   completed        — terminal; completed_at stamped
//   failed           — operator-recorded failure; error kept content-free
//                      (first line only)
//   rolling_back     — RESUME queues (jobs were preserved); the repository
//                      co-commits source restoration with the state CAS
//   rolled_back      — terminal record

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import {
  pauseQueueForQuarantine,
  resumeQueueFromQuarantine,
  type QuarantineQueueName,
  type QuarantineQueuePort,
} from '#/shared/jobs/queue-quarantine'
import { readQueueDepth } from '#/shared/health/queue-depth'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { propertyError } from '../../domain/errors'
import {
  assertValidMoveTransition,
  type RegionMoveRecord,
  type RegionMoveState,
} from '../../domain/region-move-workflow'
import type {
  RegionMoveStateUpdate,
  RegionMoveStore,
} from '../ports/region-move-store.port'

/** A property-scoped queue the stepper may pause/drain/resume (structural —
 * the composition binds the cell's real BullMQ queues). */
export type RegionMoveQueueBinding = Readonly<{
  name: QuarantineQueueName
  queue: QuarantineQueuePort | undefined
}>

export type AdvanceRegionMoveDeps = Readonly<{
  moveStore: RegionMoveStore
  queues: ReadonlyArray<RegionMoveQueueBinding>
  clock: () => Date
  logger: Pick<LoggerPort, 'info'>
}>

export type AdvanceRegionMoveInput = Readonly<{
  moveId: string
  toState: RegionMoveState
  /** Operator confirmation token — recorded on the row at every step. */
  confirmedBy: string
  /** Required when toState is 'failed' (content-free first line only). */
  error?: string
}>

export type AdvanceRegionMoveResult = Readonly<{
  move: RegionMoveRecord
  advanced: boolean
  /** 'already_in_state' (idempotent retry) | 'queues_not_drained' (stay). */
  note: 'already_in_state' | 'queues_not_drained' | null
}>

/** Drained = no pending work. Failed jobs are preserved evidence (BQC-0.4),
 * not pending work, so they do not block the drain. */
async function queuesDrained(deps: AdvanceRegionMoveDeps): Promise<boolean> {
  for (const { name, queue } of deps.queues) {
    const depth = await readQueueDepth(name, queue)
    if (depth && depth.waiting + depth.active + depth.delayed + depth.paused > 0) {
      return false
    }
  }
  return true
}

async function resumeMoveQueues(deps: AdvanceRegionMoveDeps): Promise<void> {
  for (const { name, queue } of deps.queues) {
    if (!queue) continue
    await resumeQueueFromQuarantine(queue)
    deps.logger.info({ queue: name }, 'region move: queue resumed')
  }
}

/** Execute the toState effect. Returns 'queues_not_drained' when the step
 * must stay (no state write), otherwise null. */
async function applyStepEffect(
  deps: AdvanceRegionMoveDeps,
  toState: RegionMoveState,
): Promise<'queues_not_drained' | null> {
  switch (toState) {
    case 'writes_paused':
      for (const { name, queue } of deps.queues) {
        if (!queue) continue
        await pauseQueueForQuarantine(queue)
        deps.logger.info({ queue: name }, 'region move: queue paused')
      }
      return null
    case 'queues_drained':
      return (await queuesDrained(deps)) ? null : 'queues_not_drained'
    default:
      // data_copied / verified: policy gates (see header). target_activated
      // and rolling_back: transaction-owned authority effects. source_erased:
      // record-only with one cell. completed / rolled_back: terminal records;
      // failed: no external effect — the error line is written by the step.
      return null
  }
}

function firstLine(error: string): string {
  return (error.split('\n')[0] ?? '').trim().slice(0, 200)
}

function moveStateUpdate(
  move: RegionMoveRecord,
  input: AdvanceRegionMoveInput,
  now: Date,
): RegionMoveStateUpdate {
  return {
    expectedState: move.state,
    expectedStateRevision: move.stateRevision,
    state: input.toState,
    requestedBy: input.confirmedBy,
    stateChangedAt: now,
    ...(input.toState === 'completed' ? { completedAt: now } : {}),
    ...(input.toState === 'failed' ? { error: firstLine(input.error ?? '') } : {}),
  }
}

function movedRecord(
  move: RegionMoveRecord,
  update: RegionMoveStateUpdate,
): RegionMoveRecord {
  return {
    ...move,
    state: update.state,
    stateRevision: move.stateRevision + 1,
    requestedBy: update.requestedBy,
    stateChangedAt: update.stateChangedAt,
    ...(update.completedAt !== undefined ? { completedAt: update.completedAt } : {}),
    ...(update.error !== undefined ? { error: update.error } : {}),
  }
}

/**
 * The CAS lost. A concurrent step that already reached the requested state is
 * the same idempotent retry the pre-write check handles; anything else is a
 * genuine conflict.
 */
async function reconcileStaleMove(
  deps: AdvanceRegionMoveDeps,
  organizationId: OrganizationId,
  input: AdvanceRegionMoveInput,
  move: RegionMoveRecord,
): Promise<AdvanceRegionMoveResult> {
  const current = await deps.moveStore.findMoveById(organizationId, input.moveId)
  if (current?.state === input.toState) {
    if (input.toState === 'rolling_back') await resumeMoveQueues(deps)
    return { move: current, advanced: false, note: 'already_in_state' }
  }
  throw propertyError(
    'region_move_conflict',
    'region move changed while this step was being committed',
    {
      moveId: input.moveId,
      expectedState: move.state,
      expectedStateRevision: move.stateRevision,
      currentState: current?.state ?? null,
      currentStateRevision: current?.stateRevision ?? null,
    },
  )
}

export const advanceRegionMove =
  (deps: AdvanceRegionMoveDeps) =>
  async (
    input: AdvanceRegionMoveInput,
    ctx: AuthContext,
  ): Promise<AdvanceRegionMoveResult> => {
    if (!canForContext(ctx, 'policy.admin')) {
      throw propertyError('forbidden', 'policy administration permission is required')
    }
    const move = await deps.moveStore.findMoveById(ctx.organizationId, input.moveId)
    if (!move) {
      throw propertyError(
        'property_not_found',
        'region move not found in this organization',
      )
    }
    // Idempotent retry of a reached state — the crash/retry contract.
    if (move.state === input.toState) {
      if (input.toState === 'rolling_back') await resumeMoveQueues(deps)
      return { move, advanced: false, note: 'already_in_state' }
    }
    assertValidMoveTransition(move.state, input.toState)
    if (input.toState === 'failed' && !input.error?.trim()) {
      throw new Error('error is required when failing a region move')
    }

    const now = deps.clock()
    const note = await applyStepEffect(deps, input.toState)
    if (note) return { move, advanced: false, note }

    const update = moveStateUpdate(move, input, now)
    const outcome = await deps.moveStore.updateMoveState(
      ctx.organizationId,
      input.moveId,
      update,
    )
    if (outcome === 'stale') {
      return reconcileStaleMove(deps, ctx.organizationId, input, move)
    }
    if (input.toState === 'rolling_back') await resumeMoveQueues(deps)
    return { move: movedRecord(move, update), advanced: true, note: null }
  }

export type AdvanceRegionMove = ReturnType<typeof advanceRegionMove>
