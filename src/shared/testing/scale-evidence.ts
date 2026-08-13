// BQC-8.1 — scale-and-recovery evidence ingester: builds the reviewed
// markdown summary from MEASURED scenario result files, never from
// templates.
//
// The honesty rules of the slice, enforced here:
//   - A scenario/fault with no result file is "not executed in this
//     environment" — it never gets a measured value or a templated status.
//   - A result with zero samples or an empty monitoring series is a HARD
//     error (throw), not a row: evidence without measurement is worse than
//     no evidence.
//   - An executed scenario whose assertions failed produces a FAIL row and a
//     failing build (the CLI exits non-zero) — never a silent pass.
//   - Release identity (sha + policy versions + dataset hash) is mandatory,
//     and every result in one pack must come from the SAME candidate
//     (mixed shas/versions throw).

import { SLOS, SCENARIOS, FAULTS, type ScenarioRunRecord } from './scenarios/catalogue'

/** Hard evidence failure — the CLI maps this to exit 1 with no half-written truth. */
export class EvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidenceError'
  }
}

export type ReleaseIdentity = Readonly<{
  releaseId: string
  releaseSha: string
  policyVersions: Readonly<{
    capabilityPolicy: string
    policyStore: number | null
    routingPolicy: number
    sourceContentPolicy: number
  }>
  datasetHash: string
  datasetSeed: string
  datasetShape: Readonly<{ orgs: number; properties: number; reviews: number }>
  owner: string
  generatedAt: string
}>

export function validateReleaseIdentity(identity: ReleaseIdentity): void {
  if (!identity.releaseId)
    throw new EvidenceError('release identity: releaseId is required')
  if (!identity.releaseSha || identity.releaseSha === 'unknown')
    throw new EvidenceError(
      'release identity: release sha is required (flag, env, or git)',
    )
  if (!/^[0-9a-f]{64}$/.test(identity.datasetHash))
    throw new EvidenceError(
      'release identity: dataset manifest hash is required (sha256 hex)',
    )
  if (!identity.policyVersions.capabilityPolicy)
    throw new EvidenceError('release identity: capability policy version is required')
  if (typeof identity.policyVersions.routingPolicy !== 'number')
    throw new EvidenceError('release identity: routing policy version is required')
  if (typeof identity.policyVersions.sourceContentPolicy !== 'number')
    throw new EvidenceError('release identity: source-content policy version is required')
  if (!identity.datasetSeed)
    throw new EvidenceError('release identity: dataset seed is required')
  if (!identity.owner) throw new EvidenceError('release identity: owner is required')
  if (!identity.generatedAt)
    throw new EvidenceError('release identity: generatedAt is required')
}

export type EvidenceBuild = Readonly<{
  markdown: string
  executed: ReadonlyArray<{ key: string; passed: boolean }>
  notExecuted: readonly string[]
  faultsNotExecuted: readonly string[]
  /** Executed scenarios whose assertions failed — the CLI exits non-zero. */
  failures: readonly string[]
}>

/** Metric keys worth surfacing in the reviewed summary, in priority order. */
const KEY_METRICS = [
  'achievedRatePerSec',
  'targetRatePerSec',
  'enqueued',
  'reads',
  'readP95',
  'backlogSize',
  'drainMs',
  'remainingWaiting',
  // BQC-8.2 capacity metrics.
  'backgroundAchievedRatePerSec',
  'hotAchievedRatePerSec',
  'catchUpDrainMs',
  'dispatchRatePerSec',
  'projectedWindowS',
  'publishP95',
  'published',
  'maxQueueWaiting',
] as const

const METRIC_UNITS: Record<string, string> = {
  achievedRatePerSec: '/s',
  targetRatePerSec: '/s',
  readRatePerSec: '/s',
  injectionRatePerSec: '/s',
  backgroundAchievedRatePerSec: '/s',
  hotAchievedRatePerSec: '/s',
  catchUpRatePerSec: '/s',
  dispatchRatePerSec: '/s',
  enqueueP50: 'ms',
  enqueueP95: 'ms',
  enqueueP99: 'ms',
  readP50: 'ms',
  readP95: 'ms',
  readP99: 'ms',
  publishP50: 'ms',
  publishP95: 'ms',
  publishP99: 'ms',
  drainMs: 'ms',
  catchUpDrainMs: 'ms',
  projectedWindowS: 's',
}

function metricSummary(record: ScenarioRunRecord): string {
  const parts: string[] = []
  for (const key of KEY_METRICS) {
    const value = record.metrics[key]
    if (value !== undefined) parts.push(`${key}=${value}${METRIC_UNITS[key] ?? ''}`)
    if (parts.length === 4) break
  }
  return parts.join(' · ') || '—'
}

function versionsEqual(
  a: ScenarioRunRecord['versions'],
  b: ScenarioRunRecord['versions'],
): boolean {
  return (
    a.capabilityPolicy === b.capabilityPolicy &&
    a.policyStore === b.policyStore &&
    a.routingPolicy === b.routingPolicy &&
    a.sourceContentPolicy === b.sourceContentPolicy
  )
}

export function buildScaleEvidence(input: {
  results: readonly ScenarioRunRecord[]
  /** Raw file names stored alongside the summary (raw/<name>). */
  rawFiles: readonly string[]
  identity: ReleaseIdentity
}): EvidenceBuild {
  const { results, rawFiles, identity } = input
  validateReleaseIdentity(identity)

  if (results.length === 0) {
    throw new EvidenceError(
      'no scenario results — an evidence pack requires at least one executed scenario (identity is unprovable otherwise)',
    )
  }

  // Fail-closed validation of every result BEFORE any markdown is built.
  const seen = new Set<string>()
  for (const record of results) {
    if (!(record.scenario in SCENARIOS) && !(record.scenario in FAULTS)) {
      throw new EvidenceError(
        `result for unknown scenario or fault '${record.scenario}' — not in the catalogue`,
      )
    }
    if (seen.has(record.scenario)) {
      throw new EvidenceError(`duplicate result for scenario '${record.scenario}'`)
    }
    seen.add(record.scenario)
    if (record.samples.count <= 0) {
      throw new EvidenceError(
        `result for '${record.scenario}' has ${record.samples.count} samples — evidence requires measured samples`,
      )
    }
    if (record.monitoring.points <= 0) {
      throw new EvidenceError(
        `result for '${record.scenario}' has an empty monitoring series — evidence requires monitoring data`,
      )
    }
  }

  // One candidate per pack: identical release sha + policy versions across results.
  const first = results[0]
  for (const record of results.slice(1)) {
    if (
      record.releaseSha !== first.releaseSha ||
      !versionsEqual(record.versions, first.versions)
    ) {
      throw new EvidenceError(
        `mixed candidates in one pack: '${record.scenario}' ran on ${record.releaseSha} with different identity — ` +
          'an evidence pack covers exactly one release candidate',
      )
    }
  }

  const executed = results.map((r) => ({ key: r.scenario, passed: r.passed }))
  const failures = executed.filter((e) => !e.passed).map((e) => e.key)
  const notExecuted = Object.keys(SCENARIOS).filter((key) => !seen.has(key))
  const faultsNotExecuted = Object.keys(FAULTS).filter((key) => !seen.has(key))

  // ── Markdown ───────────────────────────────────────────────────────
  const executedRows = results
    .map((r) => {
      const durationS = (r.durationMs / 1000).toFixed(1)
      const verdict = r.passed ? 'PASS' : 'FAIL'
      const assertionCount = `${r.assertions.filter((a) => a.passed).length}/${r.assertions.length}`
      return (
        `| \`${r.scenario}\` | ${verdict} | ${durationS}s | ` +
        `${r.samples.count} (${r.samples.errors} err) | ${r.monitoring.points} | ` +
        `${metricSummary(r)} | ${assertionCount} |`
      )
    })
    .join('\n')

  const failedDetails = results
    .filter((r) => !r.passed)
    .flatMap((r) =>
      r.assertions
        .filter((a) => !a.passed)
        .map(
          (a) => `- \`${r.scenario}\`: ✗ ${a.check}${a.detail ? ` — ${a.detail}` : ''}`,
        ),
    )
    .join('\n')

  const scenarioRows = Object.entries(SCENARIOS)
    .map(([key, s]) => {
      const hit = results.find((r) => r.scenario === key)
      const status = hit
        ? hit.passed
          ? 'PASS (measured — see Executed runs)'
          : 'FAIL (SLO violation — see Executed runs)'
        : 'not executed in this environment'
      return `| \`${key}\` | ${s.name} | ${s.description} | ${status} |`
    })
    .join('\n')

  const faultRows = Object.entries(FAULTS)
    .map(([key, fault]) => {
      const hit = results.find((record) => record.scenario === key)
      const status = hit
        ? hit.passed
          ? 'PASS (measured — see Executed runs)'
          : 'FAIL (invariant violation — see Executed runs)'
        : 'not executed in this environment'
      return `| \`${key}\` | ${fault.name} | ${fault.invariant} | ${status} |`
    })
    .join('\n')

  const sloRows = Object.entries(SLOS)
    .map(([key, value]) => `| \`${key}\` | ${value} |`)
    .join('\n')

  const rawList =
    rawFiles.length > 0
      ? rawFiles.map((f) => `- \`raw/${f}\``).join('\n')
      : '- (no raw files copied — see --results dir)'

  const versions = identity.policyVersions
  const measuredOk = failures.length === 0

  const markdown = `# Scale and recovery evidence

**Release id:** ${identity.releaseId}  
**Release sha:** ${identity.releaseSha}  
**Policy versions:** capability=${versions.capabilityPolicy} · policyStore=${versions.policyStore ?? 'null'} · routing=${versions.routingPolicy} · sourceContent=${versions.sourceContentPolicy}  
**Dataset hash:** ${identity.datasetHash}  
**Dataset:** seed \`${identity.datasetSeed}\` — ${identity.datasetShape.orgs} orgs / ${identity.datasetShape.properties} properties / ${identity.datasetShape.reviews} reviews  
**Owner:** ${identity.owner}  
**Generated at:** ${identity.generatedAt}  
**Generator:** \`scripts/perf/write-scale-evidence.ts\` (BQC-8.1 — measured ingestion, no templated results)

## Executed runs (measured)

Environment: \`${first.environment}\` (harness: scripts/perf/load-test.ts; raw identifier-only data under \`raw/\`, ADR 0030).

| Scenario | Result | Duration | Samples | Monitoring points | Key metrics | Assertions |
| -------- | ------ | -------- | ------- | ----------------- | ----------- | ---------- |
${executedRows}
${failedDetails ? `\nFailed assertions:\n\n${failedDetails}\n` : ''}
## Scenario matrix (§9.2)

| Id | Name | Description | Status |
| -- | ---- | ----------- | ------ |
${scenarioRows}

## Fault matrix (§9.3)


| Id | Name | Invariant | Status |
| -- | ---- | --------- | ------ |
${faultRows}

## SLOs (from harness catalogue)

| Key | Value |
| --- | ----- |
${sloRows}

## Health probes (BQR-6.1 / 6.2)

| Probe | URL | Expected |
| ----- | --- | -------- |
| Liveness | \`GET /api/health/live\` | 200 \`{ status: "ok" }\` |
| Readiness | \`GET /api/health/ready\` | 200 when DB+Redis up; 503 degraded |
| Combined | \`GET /api/health\` | Same as readiness (compat) |
| Metrics | \`GET /api/health/metrics\` | Outbox lag, queue depths, worker heartbeat (ops-token gated, BQC-7.2) |

## RPO / RTO

| Metric | Target | Result | Evidence |
| ------ | ------ | ------ | -------- |
| RPO | ≤ ${SLOS.rpoTarget}s (15 min) | not executed in this environment | BQC-8.6 |
| RTO | ≤ ${SLOS.rtoTarget}s (4 hours) | not executed in this environment | BQC-8.6 |

## Raw data

Identifier-only performance data (ADR 0030 — no review text, PII, or tenant identifiers as content; probe/job ids are synthetic):

${rawList}

## Sign-off

- [${measuredOk ? 'x' : ' '}] Local harness execution recorded (${executed.length} scenario(s) measured${failures.length > 0 ? `, ${failures.length} FAILED: ${failures.join(', ')}` : ''})
- [ ] Full §9.2 scenario matrix executed at target scale (BQC-8.2/8.3)
- [ ] Fault matrix executed (BQC-8.4/8.5)
- [ ] RPO/RTO verified (BQC-8.6)
`

  return { markdown, executed, notExecuted, faultsNotExecuted, failures }
}
