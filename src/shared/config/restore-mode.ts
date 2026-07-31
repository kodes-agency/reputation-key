// Isolated restore mode (BQC-7.8) — the restore-drill posture for recovered
// environments.
//
// A point-in-time restore produces a database whose rows must be verified
// BEFORE the environment is allowed to cause external effects again (a
// restored outbox/queue state must never re-fire Google syncs, reply
// publishes, or emails against provider state that has moved on). The drill
// shape is therefore:
//
//   - WEB process: boots with RESTORE_MODE=isolated; every capability
//     evaluation denies fail-closed at the existing seam (getStore() in
//     src/shared/auth/beta-capabilities.ts — the same seam BETA_CAPABILITIES_
//     OFF flows through, NOT a parallel mechanism), so capability-gated
//     server functions/mutations/external effects are impossible while reads
//     stay available for verification. The web boot logs the loud line via
//     server/plugins/restore-mode-guard.ts.
//   - WORKER process: REFUSES to boot (assertRestoreModeCompatible) — no
//     schedules, no BullMQ consumers, no outbox relay, no external effects,
//     by construction.
//   - Ops commands: ops:restore-preflight / ops:restore-verify run the
//     source-policy purge against the restored data and only ever touch an
//     ISOLATED target (isIsolatedRestoreTarget).
//
// Cutover back to serving = UNSET RESTORE_MODE (and redeploy); the web
// process then evaluates capabilities from the normal policy stores again.
//
// RESTORE_MODE is parsed by the env schema (src/shared/config/env.ts): the
// only accepted non-empty value is 'isolated' — anything else fails boot.

/** Structural env shape the restore-mode checks read (parsed Env fits). */
export type RestoreModeEnv = Readonly<{
  RESTORE_MODE?: string
}>

/**
 * The loud boot log line every process emits when restore-isolated is
 * active. Pinned verbatim — runbooks and the drill transcript grep for it.
 */
export const RESTORE_ISOLATED_LOG_LINE =
  'RESTORE MODE ISOLATED — external effects disabled'

/** True when RESTORE_MODE selects the isolated restore drill. */
export function isRestoreIsolated(env: RestoreModeEnv): boolean {
  return env.RESTORE_MODE === 'isolated'
}

export type RestoreProcessKind = 'web' | 'worker'

/**
 * Refuse an incompatible process boot. No-op outside restore-isolated mode.
 * The web process is the supported drill shape (capabilities deny at the
 * evaluation seam); the worker must never run against a restored instance —
 * its schedules/consumers/relay ARE the external-effect surface.
 */
export function assertRestoreModeCompatible(
  env: RestoreModeEnv,
  processKind: RestoreProcessKind,
): void {
  if (!isRestoreIsolated(env)) return
  if (processKind === 'worker') {
    throw new Error(
      `[RESTORE MODE] ${RESTORE_ISOLATED_LOG_LINE} — worker refuses to boot: ` +
        'the restore drill is web + ops commands only (no schedules, no BullMQ ' +
        'consumers, no outbox relay, no external effects). Unset RESTORE_MODE ' +
        'to resume normal service.',
    )
  }
}

/**
 * True when a DATABASE_URL points at an isolated/local restore target
 * (loopback only). The restore drill never runs against a live or shared
 * database; the ops restore commands refuse anything else (fail closed on
 * malformed URLs and localhost look-alikes — exact hostname match).
 */
export function isIsolatedRestoreTarget(databaseUrl: string): boolean {
  try {
    // WHATWG URL keeps the IPv6 brackets ('[::1]') — normalize them away.
    const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}
