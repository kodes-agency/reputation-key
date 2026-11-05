// Readiness and startup probe assembly for /api/health/ready, /api/health
// (combined legacy) and /api/health/started.
//
// Each probe runs under a hard per-probe budget (READINESS_PROBE_BUDGET_MS) via
// withBudget: a probe that times out OR rejects reports false, so readiness
// degrades (503) and never hangs the platform's probe window.
//
// Real checks (routes inject them; unit tests inject fakes):
//   - container  — the composition root is built. The first check builds it,
//                  which reads every provider key group construction needs, so a
//                  deployment missing one stays unready instead of failing its
//                  first request. False for good once the process is draining
//                  and after a build failed (container-lifecycle.ts).
//   - keys       — the environment parses and carries no placeholder secret.
//   - db / redis — the existing db-probe and cache/redis probes.
//   - migrations — the applied set (drizzle.__drizzle_migrations row count)
//                  must match the on-disk journal entry count
//                  (drizzle/meta/_journal.json). Fewer applied = a deploy whose
//                  migrations have not finished applying. More applied = this
//                  image is older than the database: never ready, by design —
//                  recovery is forward-only (ADR 0038, amended 2026-10-12). The
//                  outgoing container reads that way until the newer release
//                  activates, and for good when that release applied its
//                  migrations and never activated (runbooks.md §28).
//   - policy     — the process-static capability configuration parses and
//                  retains every hard-blocked capability. Tenant grants/consent
//                  and the Google execution control remain live request-time
//                  reads; readiness does not query a deleted snapshot table.
//
// Both DB checks reuse the SHARED pool handle (getPool). The journal path is
// anchored at process.cwd(): the Nitro bundle's import.meta.url is not a stable
// root, while cwd is the app root in every runtime layout (repo root for
// dev/e2e/`pnpm start`; /app in the Docker web image, which copies drizzle/ next
// to the bundle).
//
// WORKER HEARTBEAT IS DELIBERATELY NOT A READINESS/STARTUP INPUT: the web tier
// serves traffic without a worker process. Queue Redis is still a web dependency
// because the web process produces jobs; its independent probe is combined with
// Cache Redis under the backward-compatible `redis` readiness field.
// Worker-heartbeat alerting consumes the ops metrics snapshot, not the platform
// probes.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getEnv } from '#/shared/config/env'
import { assertProductionSecrets } from '#/shared/config/production-secrets'
import { migrationJournalPosition } from '#/shared/db/migration-journal-state'
import { getPool } from '#/shared/db/pool'
import { getLogger } from '#/shared/observability/logger'
import { readyProbe, startupProbe, type ReadyProbe, type StartupProbe } from './probes'
import { withBudget } from './operations-snapshot'
import { MIGRATION_COUNT_SQL } from './migration-version'
import {
  assertBlockedCapabilitiesContained,
  createEnvCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'

/** Hard per-probe budget. A probe slower than this reports false. */
export const READINESS_PROBE_BUDGET_MS = 2000

/** On-disk migration journal entry count (drizzle/meta/_journal.json). */
function journalEntryCount(
  journalPath = join(process.cwd(), 'drizzle', 'meta', '_journal.json'),
): number {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): default param is a server-constant path (process.cwd()/drizzle), never request input
  const raw = readFileSync(journalPath, 'utf8')
  return (JSON.parse(raw) as { entries: readonly unknown[] }).entries.length
}

/**
 * Applied migration set matches the on-disk journal (deploy finished). False
 * in both directions; the probe body cannot tell them apart, so the one that
 * no waiting resolves — an image older than the database — is logged.
 */
export async function isMigrationJournalMatched(): Promise<boolean> {
  try {
    const journalEntries = journalEntryCount()
    const result = await getPool().query(MIGRATION_COUNT_SQL)
    const applied = Number(result.rows[0]?.count ?? -1)
    const position = migrationJournalPosition(applied, journalEntries)
    if (position === 'database_ahead') {
      getLogger().warn(
        { applied, journalEntries },
        '[health] this image is older than the database — more migrations are applied than its journal holds, ' +
          'so it is never ready by design (forward-only recovery, ADR 0038). ' +
          'Expected on the outgoing container until the newer release activates; ' +
          'if that release never activates, this container cannot be redeployed (runbooks.md §28)',
      )
    }
    return position === 'matched'
  } catch (err) {
    getLogger().warn({ err }, '[health] migration journal check failed')
    return false
  }
}

/** Process-static policy configuration is valid and preserves hard blocks. */
export async function isPolicyConfigurationReady(): Promise<boolean> {
  try {
    assertBlockedCapabilitiesContained(createEnvCapabilityPolicyStore(process.env))
    return true
  } catch (err) {
    getLogger().warn({ err }, '[health] static policy configuration check failed')
    return false
  }
}

/**
 * The environment parses and carries no placeholder secret. The provider key
 * groups parse during container construction, which the container probe covers.
 */
export async function isKeyConfigurationReady(): Promise<boolean> {
  try {
    assertProductionSecrets(getEnv())
    return true
  } catch {
    getLogger().warn('[health] required key configuration check failed')
    return false
  }
}

export type ReadinessProbes = Readonly<{
  container: () => boolean | Promise<boolean>
  keys: () => Promise<boolean>
  db: () => Promise<boolean>
  redis: () => Promise<boolean>
  migrations: () => Promise<boolean>
  policy: () => Promise<boolean>
}>

export type StartupProbes = Readonly<{
  /** True once the composition root is built. */
  container: () => boolean | Promise<boolean>
  keys: () => Promise<boolean>
  migrations: () => Promise<boolean>
  policy: () => Promise<boolean>
}>

/**
 * Run every readiness probe under budget and assemble the probe body.
 *
 * A degraded result is LOGGED with the names of the probes that reported
 * false. Without that, a failing activation gate is silent: the platform
 * reports "HTTP 503" and the body only reaches whoever can curl the container
 * — which, for a deployment that never activates, is nobody. On 2026-08-31
 * that cost hours of deploys on `web`, where the only visible signal was five
 * identical 503s and no clue which of four dependencies was unhappy.
 *
 * `withBudget` returns the same `false` for a genuine failure and for a probe
 * that simply outran its 2s budget, so the two are reported together rather
 * than guessed apart — a slow cold pool and a broken dependency look identical
 * here by construction, and pretending otherwise would be a worse lie than
 * naming both.
 */
export async function runReadiness(
  probes: ReadinessProbes,
  budgetMs: number = READINESS_PROBE_BUDGET_MS,
  now?: () => Date,
): Promise<ReadyProbe> {
  const [container, keys, db, redis, migrations, policy] = await Promise.all([
    withBudget(Promise.resolve().then(probes.container), budgetMs, () => false),
    withBudget(Promise.resolve().then(probes.keys), budgetMs, () => false),
    withBudget(Promise.resolve().then(probes.db), budgetMs, () => false),
    withBudget(Promise.resolve().then(probes.redis), budgetMs, () => false),
    withBudget(Promise.resolve().then(probes.migrations), budgetMs, () => false),
    withBudget(Promise.resolve().then(probes.policy), budgetMs, () => false),
  ])
  const probe = readyProbe({ container, keys, db, redis, migrations, policy }, now)
  if (probe.status === 'degraded') {
    const failing = Object.entries({ container, keys, db, redis, migrations, policy })
      .filter(([, value]) => !value)
      .map(([name]) => name)
    getLogger().warn(
      { failing, budgetMs },
      '[health] readiness degraded — probe(s) reported false or outran the budget',
    )
  }
  return probe
}

/** Run the startup probes: container built + keys + migrations + policy, budgeted. */
export async function runStartup(
  probes: StartupProbes,
  budgetMs: number = READINESS_PROBE_BUDGET_MS,
  now?: () => Date,
): Promise<StartupProbe> {
  const [container, keys, migrations, policy] = await Promise.all([
    withBudget(Promise.resolve().then(probes.container), budgetMs, () => false),
    withBudget(Promise.resolve().then(probes.keys), budgetMs, () => false),
    withBudget(Promise.resolve().then(probes.migrations), budgetMs, () => false),
    withBudget(Promise.resolve().then(probes.policy), budgetMs, () => false),
  ])
  const probe = startupProbe({ container, keys, migrations, policy }, now)
  if (probe.status === 'degraded') {
    const failing = Object.entries({ container, keys, migrations, policy })
      .filter(([, value]) => !value)
      .map(([name]) => name)
    getLogger().warn(
      { failing, budgetMs },
      '[health] startup degraded — probe(s) reported false or outran the budget',
    )
  }
  return probe
}
