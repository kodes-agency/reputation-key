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
// BQC-8.2 capacity scenarios (target the seeded dataset; see --seed):
//   pnpm perf:run -- --scenario=singlePropertyBurst [--rate=20 --hot-rate=100 --duration-s=60]
//   pnpm perf:run -- --scenario=reconnect [--baseline-s=30 --outage-s=30 --timeout-s=600]
//   pnpm perf:run -- --scenario=fleetDispatch [--fleet=5000]
//   pnpm perf:run -- --scenario=dashboardCold [--reads=20]
//   pnpm perf:run -- --scenario=replyBurst [--burst-size=25] --gbp-stub=http://localhost:4150
//     (replyBurst needs BETA_ALLOWLIST_ORGS naming the probe org + the GBP
//     stub the cell wired — capability-dark environments fail closed and the
//     row stays not-executed, never faked)
//
// Environment (--env=local, the only mode today):
//   DATABASE_URL / REDIS_URL / QUEUE_REDIS_URL + app env — the CLI boots the real
//   composition container, so monitoring reads the same OperationsSnapshot
//   the /api/health/metrics route serves.
//   --base-url=http://host:3000 switches monitoring to HTTP mode and then
//   REQUIRES OPS_METRICS_TOKEN (the BQC-7.2 gate).
//   --seed=perf-scale-v1 points arrival jobs at the seeded dataset's real
//   properties (skewed: ~30% of arrivals land on the hot 5% slice, mirroring
//   the dataset); without a seeded dataset the 8.1 synthetic payloads are
//   used. When a redis-cli binary is on PATH, runs also collect Redis
//   INFO memory/stats (external collector, recorded in the run record).
//
// Exit codes: 0 scenario passed · 1 scenario failed / environment or env-var
// failure · 2 usage, unknown scenario/fault, or a catalogue entry with no
// executor in this environment.

import { performance } from 'node:perf_hooks'
import { execSync, execFile, spawnSync } from 'node:child_process'
import type { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve, join } from 'node:path'
import { sql } from 'drizzle-orm'
import { getEnv } from '../../src/shared/config/env'
// NOTE: the composition root is imported DYNAMICALLY inside runScenario,
// after env validation — its import chain touches getEnv() at module scope
// (observability logger), which would otherwise dump a raw stack instead of
// the clean "required env missing" failure.
import { closePool } from '../../src/shared/db/pool'
import { jobEnqueueOptions } from '../../src/shared/jobs/job-policy'
import { getJobRedisUrl } from '../../src/shared/jobs/redis-topology'
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
  type FaultRunSummary,
  type ScenarioExecutor,
  type ScenarioRunEnv,
  type ScenarioRunOptions,
} from '../../src/shared/testing/scenarios/executors'
import {
  viaContainerFactory,
  viaHttp,
} from '../../src/shared/testing/ops-snapshot-capture'
import {
  createLcg,
  deterministicUuid,
  seedTag,
} from '../../src/shared/testing/scale-dataset'
import { createRedisInfoCollector } from '../../src/shared/testing/external-collectors'
import { createTokenEncryptionAdapter } from '../../src/contexts/integration/infrastructure/adapters/token-encryption.adapter'
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_BATCHES,
  type PurgeRunResult,
} from '../../src/contexts/review/infrastructure/jobs/purge-expired-reviews.job'

const JOB_RESULT_POLL_INTERVAL_MS = 250

async function waitForJobResult(
  queue: Queue,
  jobId: string,
  timeoutMs: number,
): Promise<unknown> {
  const deadlineMs = performance.now() + timeoutMs
  while (performance.now() < deadlineMs) {
    const job = await queue.getJob(jobId)
    if (!job) throw new Error(`job ${jobId} disappeared before a terminal result`)

    const state = await job.getState()
    if (state === 'completed') return job.returnvalue
    if (state === 'failed') throw new Error(job.failedReason ?? `job ${jobId} failed`)

    await new Promise<void>((resolve) => setTimeout(resolve, JOB_RESULT_POLL_INTERVAL_MS))
  }
  throw new Error(`job ${jobId} timed out before returning a terminal result`)
}

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

// ── BQC-8.2: reply publication seam (real saga against the GBP stub) ──

/**
 * Wire the real publish-reply path for replyBurst: one run-scoped Google
 * connection (fresh token → no OAuth call), `count` review+reply rows in the
 * claimable state (approved + authorized), and a GBP stub scope serving the
 * reply upsert. Cleanup deletes EXACTLY the rows it created (run-scoped ids,
 * the dataset-cleanup precedent). Returns undefined — capability darkness —
 * when the environment cannot run the path honestly.
 */
async function buildReplyPublicationSeam(deps: {
  probeOrgId: string | undefined
  gbpStubUrl: string | undefined
  encryptionKey: string
  db: {
    execute: (query: unknown) => Promise<{ rows: Array<Record<string, unknown>> }>
  }
  enqueuePublish: (replyId: string, jobId: string) => Promise<void>
}): Promise<ScenarioRunEnv['replyPublication']> {
  if (!deps.probeOrgId) {
    console.error(
      'replyBurst: BETA_ALLOWLIST_ORGS names no probe org — capability darkness; ' +
        'the scenario stays not-executed in this environment.',
    )
    return undefined
  }
  if (!deps.gbpStubUrl) {
    console.error(
      'replyBurst: --gbp-stub=<url> is required (the cell wires the GBP sandbox); ' +
        'the scenario stays not-executed in this environment.',
    )
    return undefined
  }
  const probeOrgId = deps.probeOrgId
  const gbpStubUrl = deps.gbpStubUrl.replace(/\/+$/, '')
  const propRows = await deps.db.execute(
    sql`SELECT id FROM properties
        WHERE organization_id = ${probeOrgId} AND processing_region = 'us' AND deleted_at IS NULL
        LIMIT 1`,
  )
  const prop = propRows.rows[0] as { id: string } | undefined
  if (!prop) {
    console.error(
      `replyBurst: no us-cell property for probe org — seed first (pnpm perf:seed-scale).`,
    )
    return undefined
  }

  const encryption = createTokenEncryptionAdapter(deps.encryptionKey)
  const runTag = randomUUID().slice(0, 8)
  const accountName = `perf-bqc8-${runTag}`
  const locationName = `accounts/${accountName}/locations/perf-loc`
  const connectionId = randomUUID()
  const createdReviews: string[] = []
  const createdReplies: string[] = []

  return {
    prepare: async (count) => {
      // scopes is text[]: a raw sql template flattens a JS array — pass the
      // Postgres array literal as the parameter (coerced to text[] by the
      // column type). Never put JS comments inside the sql template itself.
      await deps.db.execute(sql`
        INSERT INTO google_connections
          (id, organization_id, google_subject, encrypted_access_token,
           encrypted_refresh_token, token_expires_at, scopes, connected_by, visibility, status)
        VALUES
          (${connectionId}, ${probeOrgId}, ${accountName},
           ${encryption.encrypt('perf-stub-access-token')},
           ${encryption.encrypt('perf-stub-refresh-token')},
           ${new Date(Date.now() + 3_600_000)},
           ${'{https://www.googleapis.com/auth/business.manage}'},
           'perf-harness', 'private', 'active')`)
      const replyIds: string[] = []
      const stubReviews = []
      for (let i = 0; i < count; i++) {
        const reviewId = randomUUID()
        const replyId = randomUUID()
        const externalId = `perfRB-${runTag}-${i}`
        await deps.db.execute(sql`
          INSERT INTO reviews
            (id, organization_id, property_id, platform, external_id, external_location_id,
             google_connection_id, rating, reviewed_at, expires_at)
          VALUES
            (${reviewId}, ${probeOrgId}, ${prop.id}, 'google', ${externalId}, ${locationName},
             ${connectionId}, 5, ${new Date()}, ${new Date(Date.now() + 30 * 86_400_000)})`)
        await deps.db.execute(sql`
          INSERT INTO replies
            (id, review_id, organization_id, text, status, source, publication_state,
             created_by, approved_by, approved_at)
          VALUES
            (${replyId}, ${reviewId}, ${probeOrgId},
             ${`Synthetic perf probe reply ${runTag}-${i}`}, 'approved', 'internal', 'authorized',
             'perf-harness', 'perf-harness', ${new Date()})`)
        createdReviews.push(reviewId)
        createdReplies.push(replyId)
        replyIds.push(replyId)
        stubReviews.push({
          name: `${locationName}/reviews/${externalId}`,
          starRating: 'FIVE',
          createTime: new Date().toISOString(),
        })
      }
      const scopeResponse = await fetch(`${gbpStubUrl}/__control/scope`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account: { name: `accounts/${accountName}` },
          locations: [{ name: locationName, title: 'perf probe location' }],
          reviews: { [locationName]: stubReviews },
          replyBehavior: { mode: 'success' },
        }),
      })
      if (!scopeResponse.ok) {
        throw new Error(
          `GBP stub scope registration failed: HTTP ${scopeResponse.status}`,
        )
      }
      return replyIds
    },
    enqueuePublish: deps.enqueuePublish,
    publicationStates: async (replyIds) => {
      // Arrays expand to record lists in sql templates — pass a uuid[] literal.
      const idArray = `{${[...replyIds].join(',')}}`
      const rows = await deps.db.execute(
        sql`SELECT id, publication_state FROM replies WHERE id = ANY(${idArray}::uuid[])`,
      )
      return new Map(
        (rows.rows as Array<{ id: string; publication_state: string | null }>).map(
          (r) => [String(r.id), r.publication_state ?? ''],
        ),
      )
    },
    cleanup: async () => {
      if (createdReplies.length > 0) {
        const replyArray = `{${createdReplies.join(',')}}`
        await deps.db.execute(
          sql`DELETE FROM replies WHERE id = ANY(${replyArray}::uuid[])`,
        )
      }
      if (createdReviews.length > 0) {
        const reviewArray = `{${createdReviews.join(',')}}`
        await deps.db.execute(
          sql`DELETE FROM reviews WHERE id = ANY(${reviewArray}::uuid[])`,
        )
      }
      await deps.db.execute(
        sql`DELETE FROM google_connections WHERE id = ${connectionId}`,
      )
    },
  }
}

function isPurgeRunResult(value: unknown): value is PurgeRunResult {
  if (typeof value !== 'object' || value == null) return false
  const result = value as Record<string, unknown>
  return (
    (result.status === 'completed' || result.status === 'budget_exhausted') &&
    typeof result.batches === 'number' &&
    typeof result.purged === 'number' &&
    typeof result.failed === 'number' &&
    Array.isArray(result.batchRows) &&
    result.batchRows.every((rows) => typeof rows === 'number')
  )
}

function isFaultRunSummary(value: unknown, fault: string): value is FaultRunSummary {
  if (typeof value !== 'object' || value == null) return false
  const result = value as Record<string, unknown>
  const assertions = result.assertions
  const metrics = result.metrics
  return (
    result.fault === fault &&
    typeof result.injected === 'boolean' &&
    typeof result.recovered === 'boolean' &&
    Array.isArray(assertions) &&
    assertions.length > 0 &&
    assertions.every((assertion) => {
      if (typeof assertion !== 'object' || assertion == null) return false
      const row = assertion as Record<string, unknown>
      return (
        typeof row.check === 'string' &&
        row.check.length > 0 &&
        row.check.length <= 200 &&
        typeof row.passed === 'boolean' &&
        (row.detail == null ||
          (typeof row.detail === 'string' && row.detail.length <= 240))
      )
    }) &&
    typeof metrics === 'object' &&
    metrics != null &&
    Object.entries(metrics as Record<string, unknown>).every(
      ([key, metric]) =>
        /^[a-z][a-zA-Z0-9_]*$/.test(key) &&
        ((typeof metric === 'number' && Number.isFinite(metric)) ||
          (typeof metric === 'string' && /^[a-zA-Z0-9_.:/-]{1,120}$/.test(metric))),
    )
  )
}

function buildFaultController(runnerPath: string | undefined): ScenarioRunEnv['faults'] {
  if (!runnerPath) return undefined
  return {
    execute: async (fault) => {
      if (!isAbsolute(runnerPath)) {
        throw new Error('BQC8_FAULT_RUNNER must be an absolute executable path')
      }
      const output = await new Promise<string>((resolveOutput, rejectOutput) => {
        execFile(
          runnerPath,
          [fault],
          { timeout: 15 * 60_000, maxBuffer: 64 * 1024 },
          (error, stdout) => (error ? rejectOutput(error) : resolveOutput(stdout)),
        )
      })
      let parsed: unknown
      try {
        parsed = JSON.parse(output)
      } catch {
        throw new Error(`fault controller '${fault}' returned invalid JSON`)
      }
      if (!isFaultRunSummary(parsed, fault)) {
        throw new Error(`fault controller '${fault}' returned an invalid summary`)
      }
      return parsed
    },
  }
}

// ── Scenario run ─────────────────────────────────────────────────────

async function runScenario(
  name: string,
  executor: ScenarioExecutor | undefined = getScenarioExecutor(name),
): Promise<number> {
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
  const jobRedisUrl = getJobRedisUrl(env)
  if (!jobRedisUrl) {
    console.error('QUEUE_REDIS_URL is required for scenario runs (BullMQ producer seam).')
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
    // BQC-8.2 capacity options.
    fleetSize: numericArg('--fleet'),
    hotRatePerSec: numericArg('--hot-rate'),
    outageS: numericArg('--outage-s'),
    baselineS: numericArg('--baseline-s'),
    reads: numericArg('--reads'),
    burstSize: numericArg('--burst-size'),
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

  // BQC-8.2: arrival targets = the seeded dataset's real properties.
  // The probe org (BETA_ALLOWLIST_ORGS, wired for replyBurst) is EXCLUDED so
  // arrival load never turns into real GBP fetch attempts for allowlisted
  // orgs; every other org's sync jobs terminate at the BQC-3.2 dispatch gate
  // (production beta posture), which is exactly the runtime 8.2 re-executes.
  const seed = argValue('--seed') ?? 'perf-scale-v1'
  const probeOrgId = (env.BETA_ALLOWLIST_ORGS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0]
  type FleetTarget = Readonly<{
    propertyId: string
    organizationId: string
    ordinal: number
  }>
  const ARRIVAL_SCENARIOS = new Set([
    'steady',
    'burst',
    'singlePropertyBurst',
    'reconnect',
    'fleetDispatch',
    'drain',
  ])
  let fleetTargets: readonly FleetTarget[] = []
  if (ARRIVAL_SCENARIOS.has(name)) {
    const rows = await container.db.execute(
      sql`SELECT id, organization_id, slug FROM properties WHERE slug LIKE ${`perf-prop-${seedTag(seed)}-%`} AND deleted_at IS NULL`,
    )
    fleetTargets = (
      rows.rows as Array<{ id: string; organization_id: string; slug: string }>
    )
      .map((r) => ({
        propertyId: r.id,
        organizationId: r.organization_id,
        ordinal: Number(r.slug.split('-').pop()),
      }))
      .filter((t) => Number.isInteger(t.ordinal))
      .filter((t) => t.organizationId !== probeOrgId)
      .sort((a, b) => a.ordinal - b.ordinal)
    console.log(
      fleetTargets.length > 0
        ? `Arrival targets: ${fleetTargets.length} seeded properties (seed '${seed}'${probeOrgId ? ', probe org excluded' : ''})`
        : `No seeded properties for seed '${seed}' — falling back to synthetic identifier-only payloads`,
    )
  }
  // Deterministic per-run skew: ~30% of arrivals land on the hot 5% slice
  // (mirrors the dataset's review skew). Park-Miller LCG, seeded per run.
  const arrivalLcg = createLcg(parseInt(seedTag(seed), 16))
  const syntheticArrivalData = (seq: number): Record<string, unknown> => ({
    propertyId: `00000000-0000-4000-8000-${String(seq % 0xffffffffffff).padStart(12, '0')}`,
    organizationId: 'perf-harness',
    connectionId: `00000000-0000-4000-9000-${String(seq % 0xffffffffffff).padStart(12, '0')}`,
    locationName: 'perf-probe',
  })
  const arrivalData = (seq: number): Record<string, unknown> => {
    if (fleetTargets.length === 0) return syntheticArrivalData(seq)
    const hotCount = Math.max(1, Math.floor(fleetTargets.length * 0.05))
    const idx =
      arrivalLcg() < 0.3
        ? Math.floor(arrivalLcg() * hotCount)
        : hotCount + Math.floor(arrivalLcg() * (fleetTargets.length - hotCount))
    const target = fleetTargets[Math.min(idx, fleetTargets.length - 1)]
    return {
      propertyId: target.propertyId,
      organizationId: target.organizationId,
      connectionId: deterministicUuid(seed, 'perf-conn', seq),
      locationName: `perf-loc-${target.ordinal}`,
    }
  }
  // The hot property: ordinal 0 sits in the dataset's hot slice by construction.
  const hotArrivalJob =
    fleetTargets.length > 0
      ? {
          name: 'sync-property-reviews',
          data: () => ({
            propertyId: fleetTargets[0].propertyId,
            organizationId: fleetTargets[0].organizationId,
            connectionId: deterministicUuid(seed, 'perf-conn-hot', 0),
            locationName: `perf-loc-${fleetTargets[0].ordinal}`,
          }),
        }
      : undefined

  // dashboardMix/dashboardCold need a real property to read through the
  // governed path. The probe resolves getContainer() PER CALL so the
  // dashboardCold restart seam (closeContainer → cold singleton) takes effect.
  let dashboardProbe: (() => Promise<void>) | undefined
  if (name === 'dashboardMix' || name === 'dashboardCold') {
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
        `${name}: no properties in this database — seed first (pnpm perf:seed-scale).`,
      )
      return 1
    }
    const oid = organizationId(row.organization_id)
    const pid = propertyId(row.id)
    dashboardProbe = async () => {
      const live = getContainer()
      const end = live.clock()
      const start = new Date(end.getTime() - 30 * 86_400_000)
      await live.useCases.getDashboardData({
        organizationId: oid,
        propertyId: pid,
        portalId: null,
        startDate: start,
        endDate: end,
        timeRange: '30d',
      })
    }
  }
  // dashboardCold cold-start seam: reset the container singleton — the next
  // probe call rebuilds it with cold in-process caches (recorded as coldBasis).
  const restartReadPath = async (): Promise<void> => {
    await closeContainer()
  }

  // replyBurst: the real publication path, wired only when the environment
  // admits it (probe org allowlisted + the cell's GBP stub). Otherwise the
  // scenario fails closed and the pack row stays not-executed.
  let replyPublication: ScenarioRunEnv['replyPublication']
  if (name === 'replyBurst') {
    replyPublication = await buildReplyPublicationSeam({
      probeOrgId,
      gbpStubUrl: argValue('--gbp-stub'),
      encryptionKey: env.ENCRYPTION_KEY,
      db: container.db,
      enqueuePublish: async (replyId, jobId) => {
        await queue.add(
          'publish-reply',
          { replyId, organizationId: probeOrgId },
          { ...jobEnqueueOptions('publish-reply'), jobId },
        )
      },
    })
    if (!replyPublication) return 2 // capability darkness — not executed here
  }

  // BQC-8.3: run the actual scheduled purge handler through the production
  // queue, waiting for each bounded run before scheduling the next. This
  // prevents parallel sweeps from masking cursor or retention defects.
  const lifecycle: ScenarioRunEnv['lifecycle'] =
    name === 'retention'
      ? {
          runRetention: async () => {
            const initialNow = container.clock()
            const expiredBefore =
              await container.reviewRepo.countExpiredBeforeAcrossTenants(initialNow)
            const canaries =
              await container.reviewRepo.findExpiredBatchBeforeAcrossTenants(
                initialNow,
                null,
                12,
              )
            const timeoutMs = (options.timeoutS ?? SLOS.drainTimeout) * 1000
            let remaining = expiredBefore
            let purged = 0
            let batches = 0
            let bounded = true
            while (remaining > 0) {
              const job = await queue.add(
                'purge-expired-reviews',
                {},
                {
                  ...jobEnqueueOptions('purge-expired-reviews'),
                  jobId: `perf-retention-${randomUUID()}`,
                },
              )
              const run = await waitForJobResult(queue, job.id!, timeoutMs)
              if (!isPurgeRunResult(run)) {
                throw new Error('purge-expired-reviews returned an invalid run summary')
              }
              if (run.failed > 0) {
                throw new Error(
                  `purge-expired-reviews reported ${run.failed} failed rows`,
                )
              }
              bounded =
                bounded &&
                run.batches <= DEFAULT_MAX_BATCHES &&
                run.batchRows.length === run.batches &&
                run.batchRows.every((rows) => rows > 0 && rows <= DEFAULT_BATCH_SIZE)
              purged += run.purged
              batches += run.batches
              const next = await container.reviewRepo.countExpiredBeforeAcrossTenants(
                container.clock(),
              )
              if (next >= remaining) {
                throw new Error(
                  `purge made no progress: ${next} rows remain after a bounded run`,
                )
              }
              remaining = next
            }
            return {
              expiredBefore,
              purged,
              expiredAfter: remaining,
              batches,
              canariesChecked: canaries.length,
              // `expiredAfter === 0` proves every initial canary was removed
              // through the same governed lifecycle predicate.
              canariesRemaining: remaining === 0 ? 0 : canaries.length,
              bounded,
            }
          },
        }
      : undefined

  const faults = buildFaultController(process.env.BQC8_FAULT_RUNNER)

  // External collector: redis-cli INFO when the binary exists (the record's
  // collectors section states the coverage either way).
  const redisCli = spawnSync('redis-cli', ['--version'], { stdio: 'ignore' })
  const externalCollector =
    redisCli.status === 0
      ? createRedisInfoCollector({
          redisUrl: jobRedisUrl,
          clock: () => new Date(),
          run: (args) =>
            new Promise<string>((resolveRun, rejectRun) => {
              execFile('redis-cli', [...args], (err, stdout) =>
                err ? rejectRun(err) : resolveRun(stdout),
              )
            }),
        })
      : undefined

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
      : viaContainerFactory(() => getContainer().operationsSnapshot),
    arrivalJob: {
      name: 'sync-property-reviews',
      data: arrivalData,
    },
    hotArrivalJob,
    dashboardProbe,
    restartReadPath,
    replyPublication,
    externalCollector,
    lifecycle,
    faults,
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

// ── Fault dispatch ───────────────────────────────────────────────────

async function dispatchFault(name: string): Promise<number> {
  if (!(name in FAULTS)) {
    return failUsage(
      `unknown fault '${name}' — catalogue: ${Object.keys(FAULTS).join(', ')}`,
    )
  }
  const executor = getFaultExecutor(name)
  if (!executor) {
    return failUsage(`fault '${name}' has no registered executor`)
  }
  return runScenario(name, executor)
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
    process.exit(await dispatchFault(fault))
  }
  if (scenario) {
    process.exit(await runScenario(scenario))
  }
}

main().catch((err) => {
  console.error('perf harness failed:', err)
  process.exit(1)
})
