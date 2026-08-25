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
//     attested local target or the exact private hostname of a Railway PITR
//     sibling (isIsolatedRestoreTarget).
//
// Cutover back to serving = UNSET RESTORE_MODE (and redeploy); the web
// process then evaluates capabilities from the normal policy stores again.
//
// RESTORE_MODE is parsed by the env schema (src/shared/config/env.ts): the
// only accepted non-empty value is 'isolated' — anything else fails boot.

import { dataCellById } from '#/shared/domain/data-cell-catalogue'

/** Structural env shape the restore-mode checks read (parsed Env fits). */
export type RestoreModeEnv = Readonly<{
  RESTORE_MODE?: string
  DATABASE_URL?: string
  PROCESSING_CELL?: string
  RESTORE_SOURCE_CELL?: string
  RESTORE_DATABASE_SERVICE_NAME?: string
  RAILWAY_PROJECT_ID?: string
  RAILWAY_ENVIRONMENT_ID?: string
  RAILWAY_ENVIRONMENT_NAME?: string
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

/** Exact backup/source-to-target cell binding; absent is denied in restore mode. */
export function isRestoreCellCompatible(env: RestoreModeEnv): boolean {
  return (
    typeof env.PROCESSING_CELL === 'string' &&
    typeof env.RESTORE_SOURCE_CELL === 'string' &&
    env.PROCESSING_CELL === env.RESTORE_SOURCE_CELL
  )
}

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
  if (!isRestoreCellCompatible(env)) {
    throw new Error(
      '[RESTORE MODE] backup Data Cell does not match PROCESSING_CELL — restore refused',
    )
  }
  if (
    typeof env.DATABASE_URL !== 'string' ||
    !isIsolatedRestoreTarget(env.DATABASE_URL, env)
  ) {
    throw new Error(
      '[RESTORE MODE] DATABASE_URL is not an attested local or Railway PITR sibling target — restore refused',
    )
  }
  if (processKind === 'worker') {
    throw new Error(
      `[RESTORE MODE] ${RESTORE_ISOLATED_LOG_LINE} — worker refuses to boot: ` +
        'the restore drill is web + ops commands only (no schedules, no BullMQ ' +
        'consumers, no outbox relay, no external effects). Unset RESTORE_MODE ' +
        'to resume normal service.',
    )
  }
}

const RAILWAY_PITR_SERVICE_NAME = /^[a-z0-9][a-z0-9-]*-restored-[0-9]{8}-[0-9]{4}$/iu

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * True when DATABASE_URL identifies an isolated restore target.
 *
 * Local drills are restricted to exact loopback hostnames. Railway PITR is
 * different: the platform creates a new `<source>-restored-YYYYMMDD-HHMM`
 * sibling in the source environment. A Railway target is accepted only when
 * all platform identity variables exist, the environment is the authoritative
 * `cell-<PROCESSING_CELL>` environment, the operator names a PITR-shaped
 * service, and DATABASE_URL uses that exact service's private Railway DNS.
 * Public proxies, the source database, malformed URLs, and partial attestations
 * all fail closed.
 */
export function isIsolatedRestoreTarget(
  databaseUrl: string,
  env: RestoreModeEnv = {},
): boolean {
  try {
    // WHATWG URL keeps the IPv6 brackets ('[::1]') — normalize them away.
    const parsed = new URL(databaseUrl)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return false
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return (
        env.RESTORE_DATABASE_SERVICE_NAME === undefined ||
        RAILWAY_PITR_SERVICE_NAME.test(env.RESTORE_DATABASE_SERVICE_NAME)
      )
    }

    if (
      !nonEmpty(env.RAILWAY_PROJECT_ID) ||
      !nonEmpty(env.RAILWAY_ENVIRONMENT_ID) ||
      !nonEmpty(env.RAILWAY_ENVIRONMENT_NAME) ||
      !nonEmpty(env.PROCESSING_CELL) ||
      !nonEmpty(env.RESTORE_DATABASE_SERVICE_NAME)
    ) {
      return false
    }
    const cell = dataCellById(env.PROCESSING_CELL)
    if (!cell || env.RAILWAY_ENVIRONMENT_NAME !== cell.railway.environment) {
      return false
    }
    if (!RAILWAY_PITR_SERVICE_NAME.test(env.RESTORE_DATABASE_SERVICE_NAME)) {
      return false
    }

    const expectedPrivateHost = `${env.RESTORE_DATABASE_SERVICE_NAME.toLowerCase()}.railway.internal`
    return host === expectedPrivateHost
  } catch {
    return false
  }
}
