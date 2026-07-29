#!/usr/bin/env node
// BQC-6.9 — coverage gate (two tiers). Wired as `pnpm check:coverage` and as a
// CI step in the check job (ci.yml, after "Test").
//
// The script RUNS the unit suite itself with v8 coverage
// (`vitest run --project=unit --coverage.enabled=true`), then enforces both
// tiers against coverage/coverage-summary.json. Hermetic: the unit project
// needs no database, so the gate reproduces identically locally and in CI.
// Coverage defaults (include/exclude/reporters) live in vitest.config.ts.
//
// ── Tier 1 — pure domain rules: 100% lines/branches/statements/functions ──
//
// CONTEXT.md §Testing: "Required: 100% domain coverage"; BQC-5 §6: "100%
// branch/statement for pure domain rules". The honest reading of "pure domain
// rules" (measured at HEAD, BQC-6.9) is exactly this set:
//
//   a) src/contexts/<ctx>/domain/rules.ts and *-rules.ts — discovered by glob,
//      so a new context's rules module is gated automatically.
//   b) src/shared/domain/*.ts — the shared-kernel decision modules — EXCLUDING:
//        ids.ts         branded-ID constructors/parsers (data definition, not rules)
//        index.ts       barrel re-export (no logic)
//        logger.port.ts port interface (types only)
//        brand.ts       type-level utility (no runtime code)
//        clock.ts       type-level utility (no runtime code)
//      and *.test.ts.
//
// Every tier-1 file reached 100% by ADDING TESTS in BQC-6.9 (see the slice
// report) — the exemption register below is EMPTY and must stay narrow:
//
//   EXEMPTIONS (owner + reason + uncovered line-class) — none registered.
//
// ── Tier 2 — project baseline ratchet (fails on any DECREASE) ──
//
// Floors measured 2026-07-29 on HEAD of feat/bqc-6-9-coverage-quality-gates
// (v8 provider, unit project, all:true over src/**; 4318 tests):
//
//   scope    lines   branches  functions  statements
//   overall  47.20   42.61     39.93      46.77      (all of src/**)
//   domain   96.04   89.79     97.92      95.80      (contexts/*/domain/** + shared/domain/**)
//
// The ratchet only moves UP: a PR that lowers any metric below its floor
// fails; a PR that raises a metric should update the floor deliberately in
// this header (record the new date + numbers).

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SUMMARY = join(ROOT, 'coverage', 'coverage-summary.json')

// ── Tier 1 set ──────────────────────────────────────────────────────

const SHARED_DOMAIN_EXCLUDES = new Set([
  'ids.ts', // branded-ID constructors/parsers — data definition, not rules
  'index.ts', // barrel re-export — no logic
  'logger.port.ts', // port interface — types only
  'brand.ts', // type-level utility — no runtime code
  'clock.ts', // type-level utility — no runtime code
])

/** src/contexts/<ctx>/domain/rules.ts + *-rules.ts (glob-discovered). */
function contextRulesFiles() {
  const out = []
  for (const ctx of readdirSync(join(ROOT, 'src', 'contexts'), { withFileTypes: true })) {
    if (!ctx.isDirectory()) continue
    const domainDir = join(ROOT, 'src', 'contexts', ctx.name, 'domain')
    if (!existsSync(domainDir)) continue
    for (const f of readdirSync(domainDir)) {
      if (f === 'rules.ts' || (f.endsWith('-rules.ts') && !f.endsWith('.test.ts'))) {
        out.push(`src/contexts/${ctx.name}/domain/${f}`)
      }
    }
  }
  return out.sort()
}

/** src/shared/domain/*.ts minus tests and the excluded non-rule modules. */
function sharedDomainFiles() {
  return readdirSync(join(ROOT, 'src', 'shared', 'domain'))
    .filter(
      (f) =>
        f.endsWith('.ts') && !f.endsWith('.test.ts') && !SHARED_DOMAIN_EXCLUDES.has(f),
    )
    .map((f) => `src/shared/domain/${f}`)
    .sort()
}

const TIER1_FILES = [...contextRulesFiles(), ...sharedDomainFiles()]

// ── Tier 2 floors (ratchet — see header for measurement provenance) ──

const FLOORS = {
  overall: { lines: 47.2, branches: 42.61, functions: 39.93, statements: 46.77 },
  domain: { lines: 96.04, branches: 89.79, functions: 97.92, statements: 95.8 },
}

const METRICS = ['lines', 'branches', 'functions', 'statements']

// ── Run vitest with coverage ────────────────────────────────────────

console.log('[coverage] running unit suite with v8 coverage…')
const run = spawnSync(
  process.execPath,
  [
    join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--project=unit',
    '--coverage.enabled=true',
    '--coverage.reporter=json-summary',
    '--coverage.reportsDirectory=coverage',
  ],
  { cwd: ROOT, stdio: 'inherit' },
)
if (run.status !== 0) {
  console.error('[coverage] vitest run failed — fix the suite before the gate can pass')
  process.exit(run.status ?? 1)
}
if (!existsSync(SUMMARY)) {
  console.error(`[coverage] ${SUMMARY} not produced — check the coverage config`)
  process.exit(1)
}

const raw = JSON.parse(readFileSync(SUMMARY, 'utf-8'))
const summary = new Map()
for (const [absPath, m] of Object.entries(raw)) {
  summary.set(absPath.startsWith(ROOT) ? absPath.slice(ROOT.length + 1) : absPath, m)
}

const failures = []

// ── Tier 1: 100% on pure domain rules ───────────────────────────────

for (const file of TIER1_FILES) {
  const m = summary.get(file)
  if (!m) {
    failures.push(`tier-1 file missing from coverage data: ${file} (config drift?)`)
    continue
  }
  for (const metric of METRICS) {
    if (m[metric].pct < 100) {
      failures.push(
        `tier-1 ${file}: ${metric} ${m[metric].pct}% < 100% (${m[metric].covered}/${m[metric].total}) — ` +
          'add the missing test; register an exemption (owner+reason+line-class) only for genuinely unreachable defensive code',
      )
    }
  }
}

// ── Tier 2: baseline ratchet ────────────────────────────────────────

const pct = (c, t) => (t === 0 ? 100 : Math.floor((c / t) * 10000) / 100)

// Domain aggregate: contexts/*/domain/** + shared/domain/** (all files).
const domainAgg = {
  lines: [0, 0],
  branches: [0, 0],
  functions: [0, 0],
  statements: [0, 0],
}
for (const [file, m] of summary) {
  if (file === 'total') continue
  const isDomain =
    (file.startsWith('src/contexts/') && file.includes('/domain/')) ||
    file.startsWith('src/shared/domain/')
  if (!isDomain) continue
  for (const metric of METRICS) {
    domainAgg[metric][0] += m[metric].covered
    domainAgg[metric][1] += m[metric].total
  }
}

const totals = {
  overall: Object.fromEntries(METRICS.map((k) => [k, summary.get('total')[k].pct])),
  domain: Object.fromEntries(
    METRICS.map((k) => [k, pct(domainAgg[k][0], domainAgg[k][1])]),
  ),
}

for (const scope of ['overall', 'domain']) {
  for (const metric of METRICS) {
    const measured = totals[scope][metric]
    const floor = FLOORS[scope][metric]
    if (measured < floor) {
      failures.push(
        `tier-2 ${scope} ${metric}: ${measured}% < floor ${floor}% — coverage regressed; ` +
          'the ratchet only moves up (restore coverage, or justify a deliberate floor change in the script header)',
      )
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────

console.log(`[coverage] tier-1: ${TIER1_FILES.length} pure-domain-rule files checked`)
for (const scope of ['overall', 'domain']) {
  console.log(
    `[coverage] tier-2 ${scope}: ` +
      METRICS.map((k) => `${k} ${totals[scope][k]}% (floor ${FLOORS[scope][k]}%)`).join(
        '  ',
      ),
  )
}

if (failures.length > 0) {
  console.error(`[coverage] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('[coverage] OK — tier-1 pure domain rules at 100%; baselines held')
