// Property context — advance region move use case (BQC-4.5 / ADR 0048).
//
// The operator-driven stepper for the move rehearsal and future real moves.
// One call requests ONE transition ({ toState }); the machine
// (domain/region-move-workflow) validates it and the stepper executes the
// per-state effect BEFORE writing the state — a crash leaves the state behind
// the effects, and retrying the same { toState } is an idempotent no-op
// ('already_in_state'), so every step is safely re-runnable.
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
//   target_activated — the source-of-truth swap: ONE guarded UPDATE on
//                      properties (processing_region + routing_policy_version+1)
//                      — the atomic authority change
//   source_erased    — record-only while there is one cell (nothing exists to
//                      erase; the erasure contract is the transition itself)
//   completed        — terminal; completed_at stamped
//   failed           — operator-recorded failure; error kept content-free
//                      (first line only)
//   rolling_back     — RESUME queues (jobs were preserved) + restore the
//                      source region if activation had committed (guarded,
//                      idempotent) — the source stays the single authority
//                      throughout and no external effect is duplicated
//   rolled_back      — terminal record

import type { AuthContext } from '#/shared/domain/auth-context'
import {
  pauseQueueForQuarantine,
  resumeQueueFromQuarantine,
  type QuarantineQueueName,
  type QuarantineQueuePort,
} from '#/shared/jobs/queue-quarantine'
import { readQueueDepth } from '#/shared/health/queue-depth'
import { getLogger } from '#/shared/observability/logger'
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

// fallow-ignore-next-line unused-type
export type AdvanceRegionMoveDeps = Readonly<{
  moveStore: RegionMoveStore
  queues: ReadonlyArray<RegionMoveQueueBinding>
  clock: () => Date
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

/** Execute the toState effect. Returns 'queues_not_drained' when the step
 * must stay (no state write), otherwise null. */
async function applyStepEffect(
  deps: AdvanceRegionMoveDeps,
  move: RegionMoveRecord,
  toState: RegionMoveState,
  now: Date,
): Promise<'queues_not_drained' | null> {
  const logger = getLogger()
  switch (toState) {
    case 'writes_paused':
      for (const { name, queue } of deps.queues) {
        if (!queue) continue
        await pauseQueueForQuarantine(queue)
        logger.info({ moveId: move.id, queue: name }, 'region move: queue paused')
      }
      return null
    case 'queues_drained':
      return (await queuesDrained(deps)) ? null : 'queues_not_drained'
    case 'rolling_back':
      for (const { name, queue } of deps.queues) {
        if (!queue) continue
        await resumeQueueFromQuarantine(queue)
        logger.info({ moveId: move.id, queue: name }, 'region move: queue resumed')
      }
      // Restore the source when activation had committed (guarded — a
      // pre-activation failure reports already_active and changes nothing).
      await deps.moveStore.restoreSourceRegion({
        orgId: move.organizationId,
        propertyId: move.propertyId,
        fromRegion: move.fromRegion,
        toRegion: move.toRegion,
        resolvedAt: now,
      })
      return null
    case 'target_activated':
      await deps.moveStore.activateTargetRegion({
        orgId: move.organizationId,
        propertyId: move.propertyId,
        fromRegion: move.fromRegion,
        toRegion: move.toRegion,
        resolvedAt: now,
      })
      return null
    default:
      // data_copied / verified: policy gates (see header). source_erased:
      // record-only with one cell. completed / rolled_back: terminal records.
      // failed: no external effect — the error line is written by the step.
      return null
  }
}

function firstLine(error: string): string {
  return (error.split('\n')[0] ?? '').trim().slice(0, 200)
}

export const advanceRegionMove =
  (deps: AdvanceRegionMoveDeps) =>
  async (
    input: AdvanceRegionMoveInput,
    ctx: AuthContext,
  ): Promise<AdvanceRegionMoveResult> => {
    const move = await deps.moveStore.findMoveById(ctx.organizationId, input.moveId)
    if (!move) {
      throw propertyError(
        'property_not_found',
        'region move not found in this organization',
      )
    }
    // Idempotent retry of a reached state — the crash/retry contract.
    if (move.state === input.toState) {
      return { move, advanced: false, note: 'already_in_state' }
    }
    assertValidMoveTransition(move.state, input.toState)
    if (input.toState === 'failed' && !input.error?.trim()) {
      throw new Error('error is required when failing a region move')
    }

    const now = deps.clock()
    const note = await applyStepEffect(deps, move, input.toState, now)
    if (note) return { move, advanced: false, note }

    const update: RegionMoveStateUpdate = {
      state: input.toState,
      requestedBy: input.confirmedBy,
      stateChangedAt: now,
      ...(input.toState === 'completed' ? { completedAt: now } : {}),
      ...(input.toState === 'failed' ? { error: firstLine(input.error ?? '') } : {}),
    }
    await deps.moveStore.updateMoveState(ctx.organizationId, input.moveId, update)
    return { move: { ...move, ...update }, advanced: true, note: null }
  }

// fallow-ignore-next-line unused-type
export type AdvanceRegionMove = ReturnType<typeof advanceRegionMove>
