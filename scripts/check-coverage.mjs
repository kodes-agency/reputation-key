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
// ── Tier 2 — project baseline ratchet (fails on DECREASE *and* on DRIFT) ──
//
// Measured 2026-08-27 on codex/comprehensive-program-continuation (v8 provider,
// unit project, all:true over src/**; 986 test files, 9983 passed + 4 skipped =
// 9987 tests):
//
//   scope    lines   branches  functions  statements
//   overall  56.57   50.94     48.92      55.49      (all of src/**)
//   domain   98.08   94.09     98.90      97.27      (contexts/*/domain/** + shared/domain/**)
//
// The FLOORS below sit PIN_MARGIN_PP under those measurements. Two consecutive
// full runs on 2026-08-21 differed by 0.01pp on overall branches and statements
// (source files enter and leave the all:true include set as work lands), so a
// floor pinned at exactly-measured fails the floor arm on jitter alone. The
// margin is baked into the ready-to-paste literal the gate emits, so the next
// person to re-pin inherits it without having to know about this.
//
// The previous pin was 2026-08-21 at 7313 tests (overall
// 54.01/48.47/45.69/53.11, domain 96.84/92.27/98.95/96.07). This 2026-08-27
// re-pin follows meaningful branch restoration: tier-1 is still exact 100%,
// and the domain aggregate rose rather than accepting the temporary regression
// caused by newly added decision modules. A floor-only ratchet decays silently,
// because nothing ever forces a stale baseline upward. The ratchet therefore
// keeps its ceiling too:
//
//   floor   — measured < floor                → coverage regressed; fix the tests
//   ceiling — measured > floor + MAX_DRIFT_PP → floors are stale; re-pin them here
//
// (Because the floor already carries PIN_MARGIN_PP of slack, the real headroom
// before the ceiling trips is MAX_DRIFT_PP + PIN_MARGIN_PP.)
//
// The two arms fail with different messages on purpose: they are read by
// different authors who need different next actions. A floor breach says
// "restore the coverage you removed". A ceiling breach prints a ready-to-paste
// FLOORS literal, because the only correct response is to re-pin (and to
// record the new date + test count in this header).
//
// MAX_DRIFT_PP is per-scope, because a percentage point means different things
// in the two pools:
//
//   overall 2.50pp — the pool is 44,791 lines / 35,776 branches / 11,093
//     functions / 48,501 statements, so 2.50pp is ~1,120 lines of slack. A 1.00pp
//     band was tried and rejected: one ordinary session of test-writing moved
//     overall lines from 53.03 to 54.01 (~0.98pp) on 2026-08-21 alone, so a
//     1.00pp ceiling would fire on routine work and train authors to bump the
//     number reflexively — the same decay as today's 5.8pp slack, just faster.
//     2.50pp absorbs a session of honest test addition and still catches the
//     5.83pp rot that accumulated here over three weeks, twice over.
//
//   domain 1.00pp — the pool is only 2,866 lines / 2,983 branches / 732
//     functions / 3,118 statements and sits at 98.08%, so 1.00pp is ~29 lines.
//     Only 55 domain lines are uncovered at all: moving a full
//     percentage point there is a deliberate, reviewable event, never churn.
//     Undetectable regression is also far more expensive in domain code, so
//     the band that would be too tight for src/** is the right one here.

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
  overall: { lines: 56.52, branches: 50.89, functions: 48.87, statements: 55.44 },
  domain: { lines: 98.03, branches: 94.04, functions: 98.85, statements: 97.22 },
}

/**
 * Maximum permitted headroom between a measured metric and its pinned floor, in
 * percentage points, per scope. See the header for why these are 2.50 / 1.00.
 */
const MAX_DRIFT_PP = { overall: 2.5, domain: 1.0 }

/**
 * Slack baked into a freshly pinned floor, in percentage points.
 *
 * DO NOT REMOVE THIS AND PIN FLOORS AT EXACTLY-MEASURED. It looks like
 * redundant fudge and it is not. Measured 2026-08-21: two consecutive full runs
 * of the same suite reported overall branches 48.48 then 48.47, and overall
 * statements 53.12 then 53.11 — source files enter and leave the all:true
 * include set as unrelated work lands, so the denominators move by a few units
 * between runs. A floor pinned at exactly-measured therefore fails the FLOOR
 * arm on that jitter alone, on a tree where nobody removed a single test, and
 * the failure text accuses the author of a regression that did not happen. One
 * such false failure is enough to get the whole ratchet disabled.
 *
 * 0.05pp is ~22 lines of the 44,791-line pool: five times the observed jitter,
 * and negligible against the 2.50pp/1.00pp ceilings that force the re-pin.
 */
const PIN_MARGIN_PP = 0.05

/**
 * The value to pin as a floor for a given measurement. Used for the
 * ready-to-paste literal the gate emits on a ceiling breach, so whoever re-pins
 * inherits the margin without needing to know it exists.
 */
const pinValue = (measured) => Math.floor((measured - PIN_MARGIN_PP) * 100) / 100

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

/** Floors and measurements carry at most 2 decimals, so a rounded diff is exact. */
const driftPp = (measured, floor) => Math.round((measured - floor) * 100) / 100

let staleFloors = false
for (const scope of ['overall', 'domain']) {
  for (const metric of METRICS) {
    const measured = totals[scope][metric]
    const floor = FLOORS[scope][metric]
    if (measured < floor) {
      failures.push(
        `tier-2 ${scope} ${metric}: ${measured}% < floor ${floor}% — coverage regressed; ` +
          'the ratchet only moves up (restore coverage, or justify a deliberate floor change in the script header)',
      )
      continue
    }
    const drift = driftPp(measured, floor)
    const maxDrift = MAX_DRIFT_PP[scope]
    if (drift > maxDrift) {
      staleFloors = true
      failures.push(
        `tier-2 ${scope} ${metric}: ${measured}% exceeds floor ${floor}% by ${drift}pp ` +
          `(max drift ${maxDrift}pp for ${scope}) — the floor is STALE, so the gate can no ` +
          'longer detect a real regression of that size. Re-pin the floors to the measured ' +
          'values and update the provenance header (date + test count) in this script.',
      )
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────

console.log(`[coverage] tier-1: ${TIER1_FILES.length} pure-domain-rule files checked`)
for (const scope of ['overall', 'domain']) {
  console.log(
    `[coverage] tier-2 ${scope}: ` +
      METRICS.map((k) => {
        const drift = driftPp(totals[scope][k], FLOORS[scope][k])
        return `${k} ${totals[scope][k]}% (floor ${FLOORS[scope][k]}%, ${drift >= 0 ? '+' : ''}${drift}pp)`
      }).join('  '),
  )
}

if (failures.length > 0) {
  console.error(`[coverage] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  if (staleFloors) {
    console.error('')
    console.error(
      `[coverage] re-pin the tier-2 floors (measured minus the ${PIN_MARGIN_PP}pp jitter margin) —` +
        ' paste this over the FLOORS literal and update the provenance header:',
    )
    console.error('')
    console.error('const FLOORS = {')
    for (const scope of ['overall', 'domain']) {
      console.error(
        `  ${scope}: { ${METRICS.map((k) => `${k}: ${pinValue(totals[scope][k])}`).join(', ')} },`,
      )
    }
    console.error('}')
    console.error('')
  }
  process.exit(1)
}
console.log('[coverage] OK — tier-1 pure domain rules at 100%; baselines held')
