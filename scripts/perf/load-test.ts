// BQC-8.1: executable load/fault scenario harness (was: catalogue printer).
//
// The SLO/scenario/fault inventory lives in
// src/shared/testing/scenarios/catalogue.ts (single source of truth); the
// runnable executors in src/shared/testing/scenarios/executors.ts. This CLI
// is wiring only (scripts/ sits outside tsconfig/eslint):
//
//   pnpm perf:catalog                                   — print the catalogue
//   pnpm perf:run -- --scenario=steady [--duration-s=30] [--rate=20] [--out=dir]
//   pnpm perf:run -- --scenario=burst  [--duration-s=60]
//   pnpm perf:run -- --scenario=dashboardMix [--duration-s=15]
//   pnpm perf:run -- --scenario=drain  [--backlog=100] [--timeout-s=600]
//   pnpm perf:run -- --fault=redisUnavailable           — fails closed (8.4/8.5)
//
// Environment (--env=local, the only mode today):
//   DATABASE_URL / REDIS_URL + the app env (getEnv) — the CLI boots the real
//   composition container, so monitoring reads the same OperationsSnapshot
//   the /api/health/metrics route serves.
//   --base-url=http://host:3000 switches monitoring to HTTP mode and then
//   REQUIRES OPS_METRICS_TOKEN (the BQC-7.2 gate).
//
// Exit codes: 0 scenario passed · 1 scenario failed / environment or env-var
// failure · 2 usage, unknown scenario/fault, or a catalogue entry with no
// executor in this environment.

import { performance } from 'node:perf_hooks'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { sql } from 'drizzle-orm'
import { getEnv } from '../../src/shared/config/env'
// NOTE: the composition root is imported DYNAMICALLY inside runScenario,
// after env validation — its import chain touches getEnv() at module scope
// (observability logger), which would otherwise dump a raw stack instead of
// the clean "required env missing" failure.
import { closePool } from '../../src/shared/db/pool'
import { jobEnqueueOptions } from '../../src/shared/jobs/job-policy'
import { organizationId, propertyId } from '../../src/shared/domain/ids'
import {
  SLOS,
  SCENARIOS,
  FAULTS,
  serializeResult,
} from '../../src/shared/testing/scenarios/catalogue'
import {
  getScenarioExecutor,
  getFaultExecutor,
  type ScenarioRunEnv,
  type ScenarioRunOptions,
} from '../../src/shared/testing/scenarios/executors'
import { viaContainer, viaHttp } from '../../src/shared/testing/ops-snapshot-capture'

// ── Catalogue print (perf:catalog) ──────────────────────────────────

function printCatalogue(): void {
  console.log('BQC-8.1 Load Test & Fault Injection Harness')
  console.log('═'.repeat(60))

  console.log('\n## SLOs')
  for (const [key, value] of Object.entries(SLOS)) {
    console.log(`  ${key}: ${value}`)
  }

  console.log('\n## Scenarios (§9.2)')
  for (const [key, s] of Object.entries(SCENARIOS)) {
    const executable = getScenarioExecutor(key)
      ? 'executable'
      : 'catalogue-only (later slice)'
    console.log(`  ${key}: ${s.name} — ${s.description} [${executable}]`)
  }

  console.log('\n## Fault injections (§9.3)')
  for (const [key, f] of Object.entries(FAULTS)) {
    const executable = getFaultExecutor(key)
      ? 'executable'
      : 'no executor in this environment (BQC-8.4/8.5)'
    console.log(`  ${key}: ${f.name} [${executable}]`)
    console.log(`    Invariant:  ${f.invariant}`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log('Execute: pnpm perf:run -- --scenario=<name> [--duration-s=N] [--out=dir]')
}

// ── Args / env ───────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`))
  return hit?.slice(flag.length + 1)
}

function numericArg(flag: string): number | undefined {
  const raw = argValue(flag)
  if (raw == null) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Invalid ${flag}='${raw}' — expected a positive number`)
    process.exit(2)
  }
  return n
}

function failUsage(message: string): never {
  console.error(message)
  process.exit(2)
}

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

// ── Scenario run ─────────────────────────────────────────────────────

async function runScenario(name: string): Promise<number> {
  const executor = getScenarioExecutor(name)
  if (!executor) {
    if (name in SCENARIOS) {
      return failUsage(
        `scenario '${name}' is catalogued but has no executor in this environment ` +
          `(executable: ${Object.keys(SCENARIOS)
            .filter((k) => getScenarioExecutor(k))
            .join(', ')})`,
      )
    }
    return failUsage(
      `unknown scenario '${name}' — catalogue: ${Object.keys(SCENARIOS).join(', ')}`,
    )
  }

  // Fail closed on missing/invalid env (getEnv throws a zod error listing
  // every offending variable).
  let env
  try {
    env = getEnv()
  } catch (err) {
    console.error('Required env missing/invalid — cannot boot the harness:')
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }
  if (!env.REDIS_URL) {
    console.error('REDIS_URL is required for scenario runs (BullMQ producer seam).')
    return 1
  }

  const baseUrl = argValue('--base-url')
  if (baseUrl && !env.OPS_METRICS_TOKEN) {
    console.error('OPS_METRICS_TOKEN is required with --base-url (HTTP monitoring mode).')
    return 1
  }
  if (argValue('--env') && argValue('--env') !== 'local') {
    return failUsage(`unknown --env='${argValue('--env')}' — only 'local' exists today`)
  }

  const options: ScenarioRunOptions = {
    durationS: numericArg('--duration-s'),
    ratePerSec: numericArg('--rate'),
    backlogSize: numericArg('--backlog'),
    timeoutS: numericArg('--timeout-s'),
    concurrency: numericArg('--concurrency'),
    pollIntervalMs: numericArg('--poll-ms'),
  }
  const outDir = resolve(
    process.cwd(),
    argValue('--out') ?? 'docs/release-evidence/beta/local-draft/raw',
  )

  console.log(`Booting harness environment (composition container)…`)
  const { getContainer, closeContainer } = await import('../../src/composition')
  const container = getContainer()

  // Identity as the app itself reports it: one live snapshot read.
  const identitySnapshot = await container.operationsSnapshot.read()
  const identity = {
    environment: 'local',
    releaseSha:
      identitySnapshot.release.sha !== 'unknown'
        ? identitySnapshot.release.sha
        : gitSha(),
    versions: {
      capabilityPolicy: identitySnapshot.versions.capabilityPolicy,
      policyStore: identitySnapshot.versions.policyStore,
      routingPolicy: identitySnapshot.versions.routingPolicy,
      sourceContentPolicy: identitySnapshot.versions.sourceContentPolicy,
    },
  }

  const queue = container.jobQueue
  if (!queue) {
    console.error('BullMQ default queue unavailable — cannot reach the producer seam.')
    return 1
  }

  // dashboardMix needs a real property to read through the governed path.
  let dashboardProbe: (() => Promise<void>) | undefined
  if (name === 'dashboardMix') {
    const hottest = await container.db.execute(
      sql`SELECT p.id, p.organization_id
          FROM properties p
          LEFT JOIN reviews r ON r.property_id = p.id
          WHERE p.deleted_at IS NULL
          GROUP BY p.id, p.organization_id
          ORDER BY count(r.id) DESC
          LIMIT 1`,
    )
    const row = hottest.rows[0] as { id: string; organization_id: string } | undefined
    if (!row) {
      console.error(
        'dashboardMix: no properties in this database — seed first (pnpm perf:seed-scale).',
      )
      return 1
    }
    const oid = organizationId(row.organization_id)
    const pid = propertyId(row.id)
    dashboardProbe = async () => {
      const end = container.clock()
      const start = new Date(end.getTime() - 30 * 86_400_000)
      await container.useCases.getDashboardData({
        organizationId: oid,
        propertyId: pid,
        portalId: null,
        startDate: start,
        endDate: end,
        timeRange: '30d',
      })
    }
  }

  const runEnv: ScenarioRunEnv = {
    enqueue: async (jobName, data, jobId) => {
      await queue.add(jobName, data, { ...jobEnqueueOptions(jobName), jobId })
    },
    removeJobs: async (jobIds) => {
      let removed = 0
      let missing = 0
      for (const id of jobIds) {
        try {
          await queue.remove(id)
          removed += 1
        } catch {
          missing += 1 // already consumed/completed — nothing to remove
        }
      }
      return { removed, missing }
    },
    snapshotSource: baseUrl
      ? viaHttp(baseUrl, env.OPS_METRICS_TOKEN as string)
      : viaContainer(container.operationsSnapshot),
    arrivalJob: {
      name: 'sync-property-reviews',
      // Synthetic identifier-only payloads (ADR 0030). 8.2 points this seam
      // at real seeded properties for the staging execution.
      data: (seq) => ({
        propertyId: `00000000-0000-4000-8000-${String(seq % 0xffffffffffff).padStart(12, '0')}`,
        organizationId: 'perf-harness',
        connectionId: `00000000-0000-4000-9000-${String(seq % 0xffffffffffff).padStart(12, '0')}`,
        locationName: 'perf-probe',
      }),
    },
    dashboardProbe,
    clock: () => new Date(),
    now: () => performance.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    identity,
  }

  console.log(
    `Running '${name}' (release ${identity.releaseSha.slice(0, 12)}, monitoring: ${baseUrl ? `http ${baseUrl}` : 'container'})…`,
  )
  try {
    const outcome = await executor(runEnv, options)
    const { record, raw } = outcome

    mkdirSync(outDir, { recursive: true })
    const resultPath = join(outDir, `${name}.result.json`)
    const rawPath = join(outDir, `${name}.raw.json`)
    writeFileSync(resultPath, serializeResult(record), 'utf8')
    writeFileSync(
      rawPath,
      JSON.stringify(
        { version: 1, scenario: name, samples: raw.samples, monitoring: raw.monitoring },
        null,
        2,
      ),
      'utf8',
    )

    console.log('─'.repeat(60))
    console.log(
      `${record.passed ? 'PASS' : 'FAIL'} ${name} — ${(record.durationMs / 1000).toFixed(1)}s, ` +
        `${record.samples.count} samples (${record.samples.errors} errors), ` +
        `${record.monitoring.points} monitoring points`,
    )
    for (const a of record.assertions) {
      console.log(
        `  ${a.passed ? '✓' : '✗'} ${a.check}${a.detail ? ` — ${a.detail}` : ''}`,
      )
    }
    console.log(`  result: ${resultPath}`)
    console.log(`  raw:    ${rawPath}`)
    return record.passed ? 0 : 1
  } finally {
    await closeContainer()
    await closePool()
  }
}

// ── Fault dispatch (fails closed until 8.4/8.5 register executors) ──

function dispatchFault(name: string): number {
  if (!(name in FAULTS)) {
    return failUsage(
      `unknown fault '${name}' — catalogue: ${Object.keys(FAULTS).join(', ')}`,
    )
  }
  if (!getFaultExecutor(name)) {
    console.error(
      `fault '${name}' is catalogued but has no executor in this environment —\n` +
        'BQC-8.4 (runtime fault matrix) / BQC-8.5 (region fault matrix) register fault executors.\n' +
        'Not executed.',
    )
    return 2
  }
  // Unreachable today (registry is empty); kept for the 8.4/8.5 wiring point.
  return failUsage(`fault '${name}' executor wiring is incomplete`)
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const scenario = argValue('--scenario')
  const fault = argValue('--fault')
  const list = process.argv.includes('--list')

  if (list || (!scenario && !fault)) {
    printCatalogue()
    return
  }
  if (fault) {
    process.exit(dispatchFault(fault))
  }
  if (scenario) {
    process.exit(await runScenario(scenario))
  }
}

main().catch((err) => {
  console.error('perf harness failed:', err)
  process.exit(1)
})
