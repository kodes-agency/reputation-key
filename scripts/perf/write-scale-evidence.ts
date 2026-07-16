// BQR-6.3: Write scale-and-recovery evidence from harness catalog + local proof status.
//
// Does NOT run multi-hour staging load. It freezes the scenario/fault inventory,
// SLOs, health probe checklist, and links to PRE17C local proof so a release
// pack can be cut without copy-paste drift.
//
// Usage:
//   pnpm exec tsx scripts/perf/write-scale-evidence.ts
//   pnpm exec tsx scripts/perf/write-scale-evidence.ts --release-id=rc-2026-07-16
//   pnpm exec tsx scripts/perf/write-scale-evidence.ts --out=path/to/scale-and-recovery.md

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { SCENARIOS, FAULTS, SLOS } from './load-test'

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`))
  return hit?.slice(flag.length + 1)
}

function buildMarkdown(releaseId: string, generatedAt: string): string {
  const scenarioRows = Object.entries(SCENARIOS)
    .map(([key, s]) => `| \`${key}\` | ${s.name} | ${s.description} | pending staging |`)
    .join('\n')

  const faultRows = Object.entries(FAULTS)
    .map(([key, f]) => `| \`${key}\` | ${f.name} | ${f.invariant} | pending staging |`)
    .join('\n')

  const sloRows = Object.entries(SLOS)
    .map(([key, value]) => `| \`${key}\` | ${value} |`)
    .join('\n')

  return `# Scale and recovery evidence

**Release id:** ${releaseId}  
**Generated at:** ${generatedAt}  
**Generator:** \`scripts/perf/write-scale-evidence.ts\` (BQR-6.3)

## Local scale (required)

Source of truth: [\`docs/performance/pre17c-scale-evidence.md\`](../../../performance/pre17c-scale-evidence.md)

| Dimension | Target | Local proof (2026-07-14) |
| --------- | ------ | ------------------------ |
| Organizations | 100 | 100 |
| Properties | 5,000 | 5,000 |
| Reviews | 500,000 | 500,000 |
| Dashboard warm (rollup) | ≤ 500ms | 2.6ms |
| Insert throughput | ≥ 20/s | ~34k reviews/s (bulk seed) |

Commands:

\`\`\`bash
DATABASE_URL=... pnpm exec tsx scripts/perf/seed-scale.ts --orgs=100 --properties=5000 --reviews=500000
pnpm exec tsx scripts/perf/load-test.ts   # catalog of scenarios/faults
\`\`\`

## SLOs (from harness)

| Key | Value |
| --- | ----- |
${sloRows}

## Health probes (BQR-6.1 / 6.2)

| Probe | URL | Expected |
| ----- | --- | -------- |
| Liveness | \`GET /api/health/live\` | 200 \`{ status: "ok" }\` |
| Readiness | \`GET /api/health/ready\` | 200 when DB+Redis up; 503 degraded |
| Combined | \`GET /api/health\` | Same as readiness (compat) |
| Metrics | \`GET /api/health/metrics\` | Outbox lag, queue depths, worker heartbeat |

## Scenarios (§9.2) — staging execution matrix

| Id | Name | Description | Status |
| -- | ---- | ----------- | ------ |
${scenarioRows}

## Fault injections (§9.3) — staging execution matrix

| Id | Name | Invariant | Status |
| -- | ---- | --------- | ------ |
${faultRows}

## RPO / RTO

| Metric | Target | Result | Evidence |
| ------ | ------ | ------ | -------- |
| RPO | ≤ ${SLOS.rpoTarget}s (15 min) | pending staging | |
| RTO | ≤ ${SLOS.rtoTarget}s (4 hours) | pending staging | |

## Exceptions

- Staging load/fault execution requires environment credentials (human/env).
- Local scale proof satisfies volume/query tractability only — not full PRE17C sign-off.
- \`OUTBOX_DISPATCHER_ENABLED\` remains default-off until explicit exit.

## Sign-off

- [x] Local volume/query proof linked
- [x] Scenario + fault inventory frozen in evidence pack
- [ ] Staging scenarios executed
- [ ] Fault injections executed
- [ ] RPO/RTO verified
`
}

function main(): void {
  const releaseId = argValue('--release-id') ?? 'local-draft'
  const defaultOut = resolve(
    process.cwd(),
    'docs/release-evidence/beta',
    releaseId,
    'scale-and-recovery.md',
  )
  const outPath = resolve(process.cwd(), argValue('--out') ?? defaultOut)
  const generatedAt = new Date().toISOString()
  const md = buildMarkdown(releaseId, generatedAt)

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, md, 'utf8')
  console.log(`Wrote ${outPath}`)
  console.log(
    `Scenarios: ${Object.keys(SCENARIOS).length}; faults: ${Object.keys(FAULTS).length}`,
  )
}

main()
