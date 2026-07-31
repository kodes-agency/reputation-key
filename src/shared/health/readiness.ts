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
//   - policy            — the persisted policy store's loaded state. The store
//                         DOES expose load state (PersistedPolicyStore.
//                         currentVersion), but only through the identity
//                         build's internal handle — not through the
//                         composition container's readiness surface (which
//                         exposes refreshPolicyStore only), and reading it
//                         would couple the probe to container-build timing
//                         (the first refresh is fire-and-forget). The honest
//                         check at this seam is BQC-2.2's version-gated strong
//                         read: `SELECT version FROM policy_version` succeeds
//                         within budget ⇒ the policy tables exist and are
//                         readable, which is what serving policy decisions
//                         requires. Chosen: the strong read.
//
// Both DB checks reuse the SHARED pool handle (getPool) — no per-request
// client construction (STD-P1-04). The journal path is anchored at
// process.cwd(): the Nitro bundle's import.meta.url is not a stable root,
// while cwd is the app root in every runtime layout (repo root for
// dev/e2e/`pnpm start`; /app in the Docker web image, which copies drizzle/
// next to the bundle — see Dockerfile).
//
// WORKER HEARTBEAT IS DELIBERATELY NOT A READINESS/STARTUP INPUT: the web
// tier serves traffic without a worker; a degraded non-critical worker must
// not take web traffic down. Worker-heartbeat alerting consumes the ops
// metrics snapshot (BQC-7.4), not the platform probes.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPool } from '#/shared/db/pool'
import { getLogger } from '#/shared/observability/logger'
import { readyProbe, startupProbe, type ReadyProbe, type StartupProbe } from './probes'
import { withBudget } from './operations-snapshot'
import { MIGRATION_COUNT_SQL } from './migration-version'

/** Hard per-probe budget. A probe slower than this reports false. */
export const READINESS_PROBE_BUDGET_MS = 2000

// BQC-2.2's version-gated strong read (policy-state.repository getPolicyVersion).
const POLICY_VERSION_SQL = "SELECT version FROM policy_version WHERE scope = 'global'"

/** On-disk migration journal entry count (drizzle/meta/_journal.json). */
function journalEntryCount(
  journalPath = join(process.cwd(), 'drizzle', 'meta', '_journal.json'),
): number {
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

/** Persisted policy state is readable (policy tables migrated + reachable). */
export async function isPolicyStateReadable(): Promise<boolean> {
  try {
    await getPool().query(POLICY_VERSION_SQL)
    return true
  } catch (err) {
    getLogger().warn({ err }, '[health] policy state read failed')
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

/** Run every readiness probe under budget and assemble the probe body. */
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
  return readyProbe({ db, redis, migrations, policy }, now)
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
  const container = (() => {
    try {
      return probes.container()
    } catch {
      return false
    }
  })()
  return startupProbe({ container, migrations, policy }, now)
}
