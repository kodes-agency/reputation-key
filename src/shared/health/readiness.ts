// BQC-7.2 — readiness/startup probe assembly for /api/health/ready,
// /api/health (combined legacy) and /api/health/started.
//
// Each probe runs under a hard per-probe budget (READINESS_PROBE_BUDGET_MS)
// via 5.5's withBudget: a probe that times out OR rejects reports false —
// readiness degrades (503), never hangs the platform's probe window.
//
// Real checks (routes inject them; unit tests inject fakes):
//   - db / redis        — the existing BQR-6.1 probes (db-probe, cache/redis).
//   - migrations        — the applied set (drizzle.__drizzle_migrations row
//                         count, the 5.4 comparator's query shape) must match
//                         the on-disk journal entry count
//                         (drizzle/meta/_journal.json). Mismatch = a deploy
//                         whose migrations have not finished applying.
//   - policy            — the process-static capability configuration parses
//                         successfully and retains every hard-blocked
//                         capability. Tenant grants/consent and the Google
//                         execution control remain live request-time reads;
//                         readiness does not query a deleted snapshot table.
//
// Both DB checks reuse the SHARED pool handle (getPool) — no per-request
// client construction (STD-P1-04). The journal path is anchored at
// process.cwd(): the Nitro bundle's import.meta.url is not a stable root,
// while cwd is the app root in every runtime layout (repo root for
// dev/e2e/`pnpm start`; /app in the Docker web image, which copies drizzle/
// next to the bundle — see Dockerfile).
//
// WORKER HEARTBEAT IS DELIBERATELY NOT A READINESS/STARTUP INPUT: the web
// tier serves traffic without a worker process. Queue Redis is still a web
// dependency because the web process produces jobs; its independent probe is
// combined with Cache Redis under the backward-compatible `redis` readiness
// field. Worker-heartbeat alerting consumes the ops metrics snapshot
// (BQC-7.4), not the platform probes.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Applied migration set matches the on-disk journal (deploy finished). */
export async function isMigrationJournalMatched(): Promise<boolean> {
  try {
    const expected = journalEntryCount()
    const result = await getPool().query(MIGRATION_COUNT_SQL)
    return Number(result.rows[0]?.count ?? -1) === expected
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

export type ReadinessProbes = Readonly<{
  db: () => Promise<boolean>
  redis: () => Promise<boolean>
  migrations: () => Promise<boolean>
  policy: () => Promise<boolean>
}>

export type StartupProbes = Readonly<{
  /** Succeeds (returns, does not throw) once the composition root is built. */
  container: () => boolean
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
  const [db, redis, migrations, policy] = await Promise.all([
    withBudget(probes.db(), budgetMs, () => false),
    withBudget(probes.redis(), budgetMs, () => false),
    withBudget(probes.migrations(), budgetMs, () => false),
    withBudget(probes.policy(), budgetMs, () => false),
  ])
  const probe = readyProbe({ db, redis, migrations, policy }, now)
  if (probe.status === 'degraded') {
    const failing = Object.entries({ db, redis, migrations, policy })
      .filter(([, value]) => !value)
      .map(([name]) => name)
    getLogger().warn(
      { failing, budgetMs },
      '[health] readiness degraded — probe(s) reported false or outran the budget',
    )
  }
  return probe
}

/** Run the startup probes: container built + migrations + policy, budgeted. */
export async function runStartup(
  probes: StartupProbes,
  budgetMs: number = READINESS_PROBE_BUDGET_MS,
  now?: () => Date,
): Promise<StartupProbe> {
  const [migrations, policy] = await Promise.all([
    withBudget(probes.migrations(), budgetMs, () => false),
    withBudget(probes.policy(), budgetMs, () => false),
  ])
  // The composition root throw is swallowed into `container: false`, which is
  // right for the probe body and useless for diagnosis: a boot that cannot
  // build reports the same shape as one that simply has not finished. Log the
  // reason once here so a container that never activates leaves a trace.
  const container = (() => {
    try {
      return probes.container()
    } catch (err) {
      getLogger().warn({ err }, '[health] startup container probe threw')
      return false
    }
  })()
  const probe = startupProbe({ container, migrations, policy }, now)
  if (probe.status === 'degraded') {
    const failing = Object.entries({ container, migrations, policy })
      .filter(([, value]) => !value)
      .map(([name]) => name)
    getLogger().warn(
      { failing, budgetMs },
      '[health] startup degraded — probe(s) reported false or outran the budget',
    )
  }
  return probe
}
