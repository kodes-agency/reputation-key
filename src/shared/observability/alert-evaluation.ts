import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import {
  ALERT_DEFINITIONS,
  blindedAlerts,
  type AlertAuxReads,
  type AlertEvent,
} from './alert-definitions'

export type AlertEvaluation = Readonly<{
  /** Newly-firing alerts (ok→firing edge) to dispatch now. */
  toDispatch: readonly AlertEvent[]
  /** All currently-firing alert names (state-store reconciliation input). */
  firing: readonly string[]
  /**
   * Sustained alerts breaching for the first time: not firing, not
   * dispatched. The caller persists them; a breach on the next evaluation
   * with the name in `previouslyPending` fires.
   */
  pending: readonly string[]
  /**
   * Alerts not evaluated because an input section is degraded. A held alert
   * that was firing stays in `firing`, so its state is neither cleared nor
   * re-paged; one that was quiet cannot open an edge on a fallback reading.
   */
  held: readonly string[]
}>

/**
 * Pure evaluation pass: run every implemented definition against the
 * snapshot + aux reads. Edge-trigger hysteresis is expressed through
 * `previouslyFiring`: an alert already in the firing state does NOT
 * re-dispatch. The caller persists the state (Redis, 24h TTL) — a
 * continuously-firing alert re-notifies only after its state key expires,
 * and the caller clears state on recovery (name absent from `firing`). An
 * alert whose input section is degraded is held, not evaluated: unknown is
 * not recovery. A sustained alert's first breach is only `pending`; it fires
 * when it breaches again with its name in `previouslyPending`.
 */
export function evaluateAlerts(
  snapshot: OperationsSnapshot,
  aux: AlertAuxReads,
  previouslyFiring: ReadonlySet<string>,
  previouslyPending: ReadonlySet<string>,
): AlertEvaluation {
  const toDispatch: AlertEvent[] = []
  const firing: string[] = []
  const pending: string[] = []
  const held = new Set(blindedAlerts(snapshot.degraded).map((def) => def.name))
  for (const def of ALERT_DEFINITIONS) {
    if (!def.implemented || def.evaluate === null) continue
    const wasFiring = previouslyFiring.has(def.name)
    if (held.has(def.name) || def.unknownWhen?.(aux)) {
      held.add(def.name)
      if (wasFiring) firing.push(def.name)
      continue
    }
    const event = def.evaluate(snapshot, aux)
    if (event === null) continue
    if (def.sustained && !wasFiring && !previouslyPending.has(def.name)) {
      pending.push(def.name)
      continue
    }
    firing.push(def.name)
    if (!wasFiring) toDispatch.push(event)
  }
  return { toDispatch, firing, pending, held: [...held] }
}
