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
// Cutover back to serving = configure the verified recovery run/generation,
// UNSET RESTORE_MODE, and redeploy. A Railway PITR sibling then refuses web
// and worker boot unless that tuple is its latest durable recovery run.
//
// RESTORE_MODE is parsed by the env schema (src/shared/config/env.ts): the
// only accepted non-empty value is 'isolated' — anything else fails boot.

/** The Railway environment the beta deployment runs in; restore drills bind to it. */
const BETA_RAILWAY_ENVIRONMENT = 'cell-us'

/** Structural env shape the restore-mode checks read (parsed Env fits). */
export type RestoreModeEnv = Readonly<{
  RESTORE_MODE?: string
  DATABASE_URL?: string
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
        'consumers, no outbox relay, no external effects). Configure the verified ' +
        'recovery cutover run/generation, then unset RESTORE_MODE to resume.',
    )
  }
}

const RAILWAY_PITR_SERVICE_NAME = /^[a-z0-9][a-z0-9-]*-restored-[0-9]{8}-[0-9]{4}$/iu

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** True only for Railway's generated PITR sibling service-name shape. */
function isRailwayPitrServiceName(value: string | undefined): value is string {
  return nonEmpty(value) && RAILWAY_PITR_SERVICE_NAME.test(value)
}

/**
 * Detect a runtime connected to a Railway PITR sibling by its private DNS.
 * This remains true after RESTORE_MODE is removed for cutover, allowing boot
 * to require the durable recovery-run attestation before effects can resume.
 */
export function isRailwayPitrDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!nonEmpty(databaseUrl)) return false
  try {
    const parsed = new URL(databaseUrl)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return false
    }
    const suffix = '.railway.internal'
    const host = parsed.hostname.toLowerCase()
    if (!host.endsWith(suffix)) return false
    return isRailwayPitrServiceName(host.slice(0, -suffix.length))
  } catch {
    return false
  }
}

/**
 * True when DATABASE_URL identifies an isolated restore target.
 *
 * Local drills are restricted to exact loopback hostnames. Railway PITR is
 * different: the platform creates a new `<source>-restored-YYYYMMDD-HHMM`
 * sibling in the source environment. A Railway target is accepted only when
 * all platform identity variables exist, the environment is the beta
 * deployment's environment, the operator names a PITR-shaped service, and
 * DATABASE_URL uses that exact service's private Railway DNS.
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
      // Loopback proves only where the TCP tunnel terminates, not which
      // database is on its far side. Bind local/tunnel drills to the exact
      // PITR sibling name too; otherwise a tunnel to live Postgres would pass.
      return isRailwayPitrServiceName(env.RESTORE_DATABASE_SERVICE_NAME)
    }

    if (
      !nonEmpty(env.RAILWAY_PROJECT_ID) ||
      !nonEmpty(env.RAILWAY_ENVIRONMENT_ID) ||
      !nonEmpty(env.RAILWAY_ENVIRONMENT_NAME) ||
      !nonEmpty(env.RESTORE_DATABASE_SERVICE_NAME)
    ) {
      return false
    }
    if (env.RAILWAY_ENVIRONMENT_NAME !== BETA_RAILWAY_ENVIRONMENT) {
      return false
    }
    if (!isRailwayPitrServiceName(env.RESTORE_DATABASE_SERVICE_NAME)) {
      return false
    }

    const expectedPrivateHost = `${env.RESTORE_DATABASE_SERVICE_NAME.toLowerCase()}.railway.internal`
    return host === expectedPrivateHost
  } catch {
    return false
  }
}
