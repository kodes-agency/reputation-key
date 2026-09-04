// Bounded background fence for execution permits that were admitted and then
// never started (ADR 0050 execution-permit lifecycle).
//
// `startExecutionPermit` detects `start_deadline_elapsed` lazily — only when a
// caller actually starts the permit. The only other exit from `admitted` is the
// emergency-kill drain (`fenceActivePermits`). A permit whose caller crashed,
// timed out, or abandoned the request between admit and start therefore stays
// `admitted` forever, which:
//
//   - pins `approval_binding_id` (ON DELETE RESTRICT), permanently blocking
//     approval-row rotation for that capability, and
//   - keeps `authorization_execution_permits_active_idx` reporting active work,
//     so the "is anything stuck?" query over-reports for good.
//
// This sweeper is the missing cadence. It is deliberately narrow: it selects a
// bounded batch of candidate ids, then locks and re-reads each row and routes it
// through the domain helper `fenceElapsedStartDeadlinePermit`, which owns both
// the deadline comparison and the fence reason. There is no raw UPDATE
// predicate, so the SQL cannot drift from `startExecutionPermit`'s semantics.
//
// The row lock plus domain re-check is the compare-and-swap: a permit that was
// started (or already fenced) between the scan and the lock is retained, never
// force-fenced.

import type { Clock } from '#/shared/domain/clock'
import {
  GOOGLE_CONTENT_CAPABILITIES,
  type GoogleContentCapability,
} from './google-content-contract'
import {
  fenceElapsedStartDeadlinePermit,
  type AuthorizationExecutionPermit,
  type ExecutionPermitStartDeadlineRetentionReason,
} from './authorization-execution-permit'

/**
 * Per-run scan ceiling. Matches the bounded-batch shape of the retention sweep:
 * a run never scans more than this, and the next run resumes from the same
 * oldest-first ordering, so a large backlog drains across runs instead of
 * holding one long transaction.
 */
export const EXECUTION_PERMIT_START_DEADLINE_SWEEP_BATCH_SIZE = 200

export type ExecutionPermitStartDeadlineSweepStore<Tx> = Readonly<{
  transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T>
  /**
   * Ids of permits still in `admitted` whose `start_deadline_at < before`,
   * oldest deadline first, at most `limit` rows. Candidate selection only — the
   * fence decision is re-made under lock by the domain helper.
   *
   * `capabilities` scopes the scan so it matches the leading column of
   * `authorization_execution_permits_active_idx`
   * `(capability, state, start_deadline_at, ...)`. Without it the sweep would
   * sequential-scan a table that grows with every provider call.
   */
  listElapsedAdmittedPermitIds(
    tx: Tx,
    input: Readonly<{
      capabilities: readonly GoogleContentCapability[]
      before: Date
      limit: number
    }>,
  ): Promise<readonly string[]>
  lockPermit(
    tx: Tx,
    id: string,
    organizationId?: string,
  ): Promise<Readonly<{ permit: AuthorizationExecutionPermit }> | null>
  updatePermit(tx: Tx, permit: AuthorizationExecutionPermit): Promise<void>
}>

export type ExecutionPermitStartDeadlineSweepOutcome = Readonly<{
  /** Candidate ids returned by the bounded scan. */
  scanned: number
  /** Rows CASed `admitted` -> `fenced` with `fencedAt` set. */
  fenced: number
  /** Candidates the domain helper retained, by content-free reason. */
  retained: Readonly<Record<ExecutionPermitStartDeadlineRetentionReason, number>>
  /** Candidate rows that disappeared between scan and lock. */
  vanished: number
  /** True when the scan filled its batch, so more work remains for the next run. */
  batchFull: boolean
}>

export type ExecutionPermitStartDeadlineSweeper =
  () => Promise<ExecutionPermitStartDeadlineSweepOutcome>

export function createExecutionPermitStartDeadlineSweeper<Tx>(
  deps: Readonly<{
    store: ExecutionPermitStartDeadlineSweepStore<Tx>
    clock: Clock
    batchSize?: number
    /**
     * Scan scope. Defaults to every Google Content capability — the table holds
     * only their permits — so a new capability is swept the moment it is added
     * to the shared catalogue.
     */
    capabilities?: readonly GoogleContentCapability[]
  }>,
): ExecutionPermitStartDeadlineSweeper {
  const limit = deps.batchSize ?? EXECUTION_PERMIT_START_DEADLINE_SWEEP_BATCH_SIZE
  const capabilities = deps.capabilities ?? GOOGLE_CONTENT_CAPABILITIES

  return () =>
    deps.store.transaction(async (tx) => {
      const now = deps.clock()
      const candidates = await deps.store.listElapsedAdmittedPermitIds(tx, {
        capabilities,
        before: now,
        limit,
      })

      const retained: Record<ExecutionPermitStartDeadlineRetentionReason, number> = {
        state_not_admitted: 0,
        start_deadline_pending: 0,
      }
      let fenced = 0
      let vanished = 0

      for (const id of candidates) {
        const record = await deps.store.lockPermit(tx, id)
        if (!record) {
          vanished += 1
          continue
        }
        const decision = fenceElapsedStartDeadlinePermit(record.permit, now)
        if (decision.kind === 'retained') {
          retained[decision.reason] += 1
          continue
        }
        await deps.store.updatePermit(tx, decision.permit)
        fenced += 1
      }

      return {
        scanned: candidates.length,
        fenced,
        retained,
        vanished,
        batchFull: candidates.length >= limit,
      }
    })
}
