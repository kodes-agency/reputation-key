/**
 * The result a gated job resolves with when the delayed-execution gate denies
 * it terminally.
 *
 * A terminal denial must not retry, so BullMQ records the job as completed.
 * This value, kept as the job's return value, is what tells the runtime
 * observations that nothing ran: the worker's completion listener and the
 * retained completed-set scan both read it and record a denial instead of a
 * success. It carries only the closed deny reason, never scope or payload.
 */

export type GateDeniedExecutionKind = 'worker' | 'schedule'

export type GateDeniedResult = Readonly<{
  gate: 'denied'
  /** The policy's closed deny code (DelayedDenyReason). */
  reason: string
  executionKind: GateDeniedExecutionKind
}>

/** Reads a live completion result or a return value BullMQ parsed from Redis. */
export function isGateDeniedResult(value: unknown): value is GateDeniedResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return (
    result.gate === 'denied' &&
    typeof result.reason === 'string' &&
    (result.executionKind === 'worker' || result.executionKind === 'schedule')
  )
}
