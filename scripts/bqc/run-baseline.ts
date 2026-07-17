// BQC-0.5 — re-run and pin the baseline.
//
// Executes every program gate, captures command / environment / duration /
// result / artifact path into baseline.json, and writes one log per gate.
// Results are recorded VERBATIM — a failing gate is a failing gate; nothing
// is reinterpreted as an expected pass.
//
// Usage:
//   pnpm bqc:run-baseline                # full battery (~20–30 min)
//   pnpm bqc:run-baseline --only=format,types,lint   # subset, for re-runs
//
// Required env for DB/e2e gates (mirrors CI; point DATABASE_URL at a
// dedicated scratch database — never a dev database):
//   DATABASE_URL REDIS_URL BETTER_AUTH_SECRET BETTER_AUTH_URL RESEND_API_KEY
//   GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET ENCRYPTION_KEY OAUTH_STATE_SECRET
//   E2E_TEST_EMAIL E2E_TEST_PASSWORD
//   BETA_E2E_GLOBAL_CAPABILITIES BETA_E2E_EXECUTION_IDENTITY

import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(
  process.cwd(),
  'docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/completion-program-2026-07',
)

type Gate = Readonly<{
  id: string
  command: string
  /** Per-gate env overrides. */
  env?: Readonly<Record<string, string>>
  /** Skip the gate when this env var is missing. */
  requiresEnv?: string
}>

type GateResult = Readonly<{
  id: string
  command: string
  skipped: boolean
  skipReason?: string
  startedAt?: string
  durationMs?: number
  exitCode?: number
  result: 'pass' | 'fail' | 'skipped'
  logPath?: string
}>

// Order: fast static gates → DB gates → builds → browser gates.
const GATES: ReadonlyArray<Gate> = [
  { id: 'format', command: 'pnpm format:check' },
  { id: 'types', command: 'pnpm typecheck' },
  { id: 'lint', command: 'pnpm lint' },
  {
    id: 'migrations',
    command: 'echo "y" | pnpm auth:migrate && pnpm db:migrate && pnpm audit:auth-schema',
    requiresEnv: 'DATABASE_URL',
  },
  { id: 'unit', command: 'pnpm test:unit' },
  {
    id: 'integration',
    command: 'pnpm test:integration',
    requiresEnv: 'DATABASE_URL',
    // vitest.config's integration project prefers TEST_DATABASE_URL (default
    // test:test@localhost/test). Forward the baseline database explicitly so
    // the gate runs against the migrated scratch DB, never a stale local one.
    env: { TEST_DATABASE_URL: process.env.DATABASE_URL ?? '' },
  },
  { id: 'build-web', command: 'pnpm build' },
  { id: 'build-worker', command: 'pnpm build:worker' },
  { id: 'storybook-build', command: 'pnpm build-storybook' },
  { id: 'storybook-test', command: 'pnpm test:storybook' },
  { id: 'dependency-audit', command: 'pnpm audit' },
  { id: 'fallow-dead-code', command: 'node_modules/.bin/fallow dead-code' },
  { id: 'fallow-duplication', command: 'node_modules/.bin/fallow dupes' },
  { id: 'fallow-health', command: 'node_modules/.bin/fallow health' },
  {
    id: 'seed-e2e',
    command: 'pnpm seed:e2e-user',
    requiresEnv: 'E2E_TEST_EMAIL',
  },
  {
    id: 'e2e-critical',
    command: 'pnpm test:e2e --project=critical',
    requiresEnv: 'E2E_TEST_EMAIL',
    env: { CI: '1' },
  },
  {
    id: 'e2e-full',
    command: 'pnpm test:e2e --project=full',
    requiresEnv: 'E2E_TEST_EMAIL',
    env: { CI: '1' },
  },
]

function sh(command: string): string {
  return execSync(command, { encoding: 'utf8' }).trim()
}

function main(): void {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : undefined

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const evidenceDir = resolve(ROOT, 'evidence', `baseline-${stamp}`)
  mkdirSync(evidenceDir, { recursive: true })

  const sha = sh('git rev-parse HEAD')
  const lockfileSha256 = createHash('sha256')
    .update(readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml')))
    .digest('hex')
  const journal = JSON.parse(
    readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string }> }
  const migrationVersion = journal.entries.at(-1)?.tag ?? 'unknown'

  const environment = {
    sha,
    branch: sh('git rev-parse --abbrev-ref HEAD'),
    lockfileSha256,
    migrationVersion,
    node: process.version,
    pnpm: sh('pnpm --version'),
    platform: `${process.platform}/${process.arch}`,
    nodeEnv: process.env.NODE_ENV ?? '(unset)',
    database:
      (process.env.DATABASE_URL ?? '').replace(/.*\//, '').split('?')[0] || '(unset)',
    redisConfigured: Boolean(process.env.REDIS_URL),
    capturedAt: new Date().toISOString(),
  }

  console.log(`BQC-0.5 baseline @ ${sha.slice(0, 9)} → ${evidenceDir}`)

  const results: GateResult[] = []
  for (const gate of GATES) {
    if (only && !only.has(gate.id)) continue
    if (gate.requiresEnv && !process.env[gate.requiresEnv]) {
      console.log(`── ${gate.id}: SKIPPED (missing ${gate.requiresEnv})`)
      results.push({
        id: gate.id,
        command: gate.command,
        skipped: true,
        skipReason: `missing env ${gate.requiresEnv}`,
        result: 'skipped',
      })
      continue
    }

    const startedAt = new Date()
    process.stdout.write(`── ${gate.id}: running… `)
    const proc = spawnSync(gate.command, {
      shell: true,
      env: { ...process.env, ...gate.env },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const durationMs = Date.now() - startedAt.getTime()
    const exitCode = proc.status ?? 1

    const logPath = resolve(evidenceDir, `${gate.id}.log`)
    writeFileSync(
      logPath,
      [
        `$ ${gate.command}`,
        `started: ${startedAt.toISOString()}  durationMs: ${durationMs}  exit: ${exitCode}`,
        '',
        proc.stdout ?? '',
        proc.stderr ?? '',
      ].join('\n'),
    )

    const result = exitCode === 0 ? 'pass' : 'fail'
    console.log(`${result} (${Math.round(durationMs / 1000)}s)`)
    results.push({
      id: gate.id,
      command: gate.command,
      skipped: false,
      startedAt: startedAt.toISOString(),
      durationMs,
      exitCode,
      result,
      logPath,
    })
  }

  const failed = results.filter((r) => r.result === 'fail')
  const manifest = {
    schemaVersion: 1,
    kind: 'bqc-baseline',
    environment,
    gates: results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.result === 'pass').length,
      failed: failed.length,
      skipped: results.filter((r) => r.result === 'skipped').length,
      // Verbatim record — failures are listed, never reinterpreted.
      failedGates: failed.map((r) => r.id),
    },
  }
  const manifestPath = resolve(evidenceDir, 'baseline.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(
    `\nBaseline: ${manifest.summary.passed}/${manifest.summary.total} pass` +
      (failed.length
        ? ` — FAILED: ${failed.map((r) => r.id).join(', ')}`
        : ' — all green') +
      `\nManifest: ${manifestPath}`,
  )
  // Non-zero exit when any gate failed, so CI/operators can rely on it.
  process.exit(failed.length ? 1 : 0)
}

main()
