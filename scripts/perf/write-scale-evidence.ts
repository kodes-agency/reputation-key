// BQC-8.1: scale-and-recovery evidence ingester (was: template writer).
//
// Reads MEASURED scenario results (scripts/perf/load-test.ts output) plus the
// deterministic dataset manifest, and generates the reviewed markdown summary
// via src/shared/testing/scale-evidence.ts. Nothing here invents a result:
// scenarios/faults without result files are "not executed in this
// environment", and the command FAILS (exit 1) when:
//   - a result file is malformed, has zero samples, or an empty monitoring series;
//   - the raw time-series file for an executed scenario is missing/empty;
//   - results mix release shas/policy versions (one candidate per pack);
//   - release identity (sha, policy versions, dataset hash) is incomplete;
//   - an executed scenario violated its SLO (the failing summary IS written).
//
// Usage:
//   pnpm perf:evidence -- --release-id=rc-2026-08-01 --results=path/to/results
//   pnpm perf:evidence -- --dataset-manifest=path/to/scale-dataset.json
//
// Defaults (local-draft pack):
//   --results           docs/release-evidence/beta/<release-id>/raw
//   --dataset-manifest  docs/release-evidence/beta/<release-id>/scale-dataset.json
//   --out               docs/release-evidence/beta/<release-id>/scale-and-recovery.md
//   --release-sha       RELEASE_SHA > RAILWAY_GIT_COMMIT_SHA > `git rev-parse HEAD`
//   --owner             $USER

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import {
  parseResult,
  type ScenarioRunRecord,
} from '../../src/shared/testing/scenarios/catalogue'
import { parseManifest } from '../../src/shared/testing/scale-dataset'
import {
  buildScaleEvidence,
  EvidenceError,
} from '../../src/shared/testing/scale-evidence'

function argValueStrict(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`))
  return hit?.slice(flag.length + 1)
}

function fail(message: string): never {
  console.error(`perf:evidence failed: ${message}`)
  process.exit(1)
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

/** Validate the raw time-series sibling of an executed scenario result. */
function validateRawFile(path: string, scenario: string): void {
  if (!existsSync(path)) {
    fail(
      `executed scenario '${scenario}' is missing its raw time-series file (${basename(path)})`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`raw file ${basename(path)} is not valid JSON`)
  }
  const raw = parsed as Record<string, unknown>
  const monitoring = raw.monitoring as Record<string, unknown> | undefined
  if (!Array.isArray(raw.samples) || raw.samples.length === 0) {
    fail(`raw file ${basename(path)} has no samples — evidence requires measured samples`)
  }
  if (
    !Array.isArray(monitoring?.points) ||
    (monitoring.points as unknown[]).length === 0
  ) {
    fail(
      `raw file ${basename(path)} has an empty monitoring series — evidence requires monitoring data`,
    )
  }
}

function main(): number {
  const releaseId = argValueStrict('--release-id') ?? 'local-draft'
  const packDir = resolve(process.cwd(), 'docs/release-evidence/beta', releaseId)
  const resultsDir = resolve(
    process.cwd(),
    argValueStrict('--results') ?? join(packDir, 'raw'),
  )
  const manifestPath = resolve(
    process.cwd(),
    argValueStrict('--dataset-manifest') ?? join(packDir, 'scale-dataset.json'),
  )
  const outPath = resolve(
    process.cwd(),
    argValueStrict('--out') ?? join(packDir, 'scale-and-recovery.md'),
  )
  const releaseSha =
    argValueStrict('--release-sha') ??
    process.env.RELEASE_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    gitSha()
  const owner = argValueStrict('--owner') ?? process.env.USER ?? ''

  // ── Ingest result files ────────────────────────────────────────────
  if (!existsSync(resultsDir)) {
    fail(
      `results dir does not exist: ${resultsDir} — run scenarios first (pnpm perf:run)`,
    )
  }
  const resultFiles = readdirSync(resultsDir)
    .filter((f) => f.endsWith('.result.json'))
    .sort()
  if (resultFiles.length === 0) {
    fail(`no *.result.json in ${resultsDir} — run scenarios first (pnpm perf:run)`)
  }

  const results: ScenarioRunRecord[] = []
  const rawFiles: string[] = []
  try {
    for (const file of resultFiles) {
      const record = parseResult(readFileSync(join(resultsDir, file), 'utf8'))
      const rawName = file.replace(/\.result\.json$/, '.raw.json')
      validateRawFile(join(resultsDir, rawName), record.scenario)
      results.push(record)
      rawFiles.push(file, rawName)
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }

  // ── Release identity ───────────────────────────────────────────────
  if (!existsSync(manifestPath)) {
    fail(
      `dataset manifest missing: ${manifestPath} — load the dataset first (pnpm perf:seed-scale)`,
    )
  }
  let manifest
  try {
    manifest = parseManifest(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }

  // One candidate: the pack sha must equal every result's sha.
  for (const record of results) {
    if (record.releaseSha !== releaseSha) {
      fail(
        `release sha ${releaseSha.slice(0, 12)} does not match '${record.scenario}' result sha ${record.releaseSha.slice(0, 12)} — one candidate per pack`,
      )
    }
  }

  const identity = {
    releaseId,
    releaseSha,
    policyVersions: results[0].versions,
    datasetHash: manifest.hash,
    datasetSeed: manifest.seed,
    datasetShape: manifest.shape,
    owner,
    generatedAt: new Date().toISOString(),
  }

  // ── Build + write ──────────────────────────────────────────────────
  let built
  try {
    built = buildScaleEvidence({ results, rawFiles, identity })
  } catch (err) {
    if (err instanceof EvidenceError) fail(err.message)
    throw err
  }

  // Make the pack self-contained: copy the raw files under <release>/raw/.
  const packRawDir = join(packDir, 'raw')
  mkdirSync(packRawDir, { recursive: true })
  for (const file of rawFiles) {
    const source = join(resultsDir, file)
    const target = join(packRawDir, file)
    if (source !== target) copyFileSync(source, target)
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, built.markdown, 'utf8')

  console.log(`Wrote ${outPath}`)
  console.log(
    `Executed: ${built.executed.map((e) => `${e.key}=${e.passed ? 'PASS' : 'FAIL'}`).join(', ')}`,
  )
  console.log(
    `Not executed: ${built.notExecuted.length} scenarios, ${built.faultsNotExecuted.length} faults (honest rows, not evidence)`,
  )
  if (built.failures.length > 0) {
    console.error(
      `SLO violations: ${built.failures.join(', ')} — the summary records the failure`,
    )
    return 1
  }
  return 0
}

try {
  process.exit(main())
} catch (err) {
  console.error('perf:evidence failed:', err)
  process.exit(1)
}
