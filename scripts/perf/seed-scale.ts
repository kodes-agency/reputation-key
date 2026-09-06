// BQC-8.1: deterministic scale dataset tool (was: non-deterministic SQL generator).
//
// All logic lives in src/shared/testing/scale-dataset.ts (deterministic plan,
// manifest, load/verify/clean with colocated tests) — this CLI is wiring only.
//
// Usage:
//   pnpm perf:seed-scale -- --orgs=100 --properties=5000 --reviews=500000
//   pnpm perf:seed-scale -- --source-lifecycle --orgs=100 --properties=5000 --reviews=500000
//   pnpm perf:seed-scale -- --seed=my-seed --orgs=2 --properties=20 --reviews=500
//   pnpm perf:seed-scale -- --dry-run               (plan + hash, no DB)
//   pnpm perf:seed-scale -- --verify                (prove DB == plan; exit 1 on drift)
//   pnpm perf:seed-scale -- --clean [--dry-run]     (delete EXACTLY this dataset)
//
// Options:
//   --seed=<string>      dataset seed (default: perf-scale-v1)
//   --base-time=<iso>    wall-clock anchor for reviewed_at/expires_at
//                        (default: now; NOT part of the manifest hash)
//   --manifest=<path>    manifest JSON path (default: scripts/perf/scale-dataset.json)
//
// Same seed + same shape ⇒ byte-identical manifest hash. Requires DATABASE_URL.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Pool } from 'pg'
import {
  planScaleDataset,
  loadScaleDataset,
  verifyScaleDataset,
  cleanScaleDataset,
  createManifest,
  serializeManifest,
  parseManifest,
} from '../../src/shared/testing/scale-dataset'

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`))
  return hit?.slice(flag.length + 1)
}

function numericArg(flag: string, fallback: number): number {
  const raw = argValue(flag)
  if (raw == null) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`Invalid ${flag}='${raw}' — expected a positive integer`)
    process.exit(2)
  }
  return n
}

const DEFAULT_MANIFEST = 'scripts/perf/scale-dataset.json'

async function main(): Promise<number> {
  const seed = argValue('--seed') ?? 'perf-scale-v1'
  const shape = {
    orgs: numericArg('--orgs', 50),
    properties: numericArg('--properties', 500),
    reviews: numericArg('--reviews', 50_000),
  }
  const dryRun = process.argv.includes('--dry-run')
  const verify = process.argv.includes('--verify')
  const clean = process.argv.includes('--clean')
  const sourceLifecycle = process.argv.includes('--source-lifecycle')
  const baseTimeArg = argValue('--base-time')
  const baseTime = baseTimeArg ? new Date(baseTimeArg) : new Date()
  if (Number.isNaN(baseTime.getTime())) {
    console.error(`Invalid --base-time='${baseTimeArg}' — expected an ISO date`)
    return 2
  }
  const manifestPath = resolve(process.cwd(), argValue('--manifest') ?? DEFAULT_MANIFEST)

  const plan = planScaleDataset({ seed, shape, sourceLifecycle })

  console.log('BQC-8.1 deterministic scale dataset')
  console.log('═'.repeat(60))
  console.log(`  Seed:        ${seed}`)
  console.log(`  Version:     ${plan.version}`)
  console.log(
    `  Shape:       ${shape.orgs} orgs / ${shape.properties} properties / ${shape.reviews} reviews`,
  )
  console.log(`  Plan hash:   ${plan.hash}`)
  console.log(
    `  Lifecycle:   ${sourceLifecycle ? 'fetch-clock fields populated' : 'capacity-only'}`,
  )

  if (dryRun && !clean) {
    console.log('\nDRY RUN — no data touched.')
    return 0
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL not set')
    return 1
  }
  console.log(`  Database:    ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`)
  const pool = new Pool({ connectionString: databaseUrl, max: 10 })

  try {
    if (clean) {
      const result = await cleanScaleDataset(pool, plan, { dryRun })
      console.log(
        `\n${dryRun ? 'Would delete' : 'Deleted'}: ${result.orgs} orgs / ${result.properties} properties / ${result.reviews} reviews (exact dataset ids only)`,
      )
      return 0
    }

    if (verify) {
      let expectedHash: string | undefined
      if (existsSync(manifestPath)) {
        expectedHash = parseManifest(readFileSync(manifestPath, 'utf8')).hash
        console.log(`  Manifest:    ${manifestPath} (${expectedHash.slice(0, 16)}…)`)
      } else {
        console.log('  Manifest:    (none — recomputing hash from seed+shape)')
      }
      const report = await verifyScaleDataset(pool, plan, { expectedHash })
      console.log('\nVerify:')
      for (const check of report.checks) {
        console.log(`  ${check.passed ? '✓' : '✗'} ${check.check} — ${check.detail}`)
      }
      if (!report.ok) {
        console.error('\nVERIFY FAILED — the database does not hold this exact dataset.')
        return 1
      }
      console.log('\nVERIFY OK')
      return 0
    }

    // Load.
    const result = await loadScaleDataset(pool, plan, {
      baseTime,
      now: () => performance.now(),
    })
    const seconds = (result.durationMs / 1000).toFixed(1)
    console.log(
      `\nLoaded ${result.orgs} orgs / ${result.properties} properties / ${result.reviews} reviews in ${seconds}s` +
        (result.reviews > 0
          ? ` (${Math.round(result.reviews / (result.durationMs / 1000)).toLocaleString()} reviews/s)`
          : ''),
    )

    const manifest = createManifest(plan, baseTime)
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, serializeManifest(manifest), 'utf8')
    console.log(`Manifest: ${manifestPath}`)
    console.log(`Hash:     ${manifest.hash}`)
    console.log('═'.repeat(60))
    console.log(
      'Next: --verify to prove the load, --clean to remove exactly this dataset.',
    )
    return 0
  } finally {
    await pool.end()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('seed-scale failed:', err)
    process.exit(1)
  })
