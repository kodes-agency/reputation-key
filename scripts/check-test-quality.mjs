#!/usr/bin/env node
// BQC-6.9 — test-quality gate. Wired into `pnpm lint` (CI check job runs it
// via the Lint step) and runnable directly as `pnpm check:test-quality`.
//
// ── SCOPE (widened 2026-08-21 — three holes that let this gate be evaded) ──
//
//   src/**, services/**, e2e/**   *.test.ts(x) / *.spec.ts(x)
//   src/**/*.stories.tsx          the Storybook estate
//
// `services/**` is in the unit project's include (vitest.config.ts:91) — it is
// the AI egress-gateway + execution-admission plane — and `*.stories.tsx` is a
// hard CI gate (the `storybook-test` job). Both ran every day while being
// unscanned by the gate that governs them.
//
// ── Five rules ──
//
//   1. Focused tests — `.only`, in every chained form vitest accepts
//      (`describe.only(`, `it.concurrent.only(`, `test.only.each(`). ALWAYS
//      fail; a focused test silently shrinks the suite in CI.
//   2. Conditionally-absent tests — `.skip(` / `.todo(` / `.skipIf(` /
//      `.runIf(`. Fail unless registered in SKIP_REGISTER with owner + reason
//      and within the registered hit count. `runIf`/`skipIf` matter MORE than
//      `skip`: they retire tests on a *runtime* predicate, so coverage
//      disappears with the suite still green and exit 0.
//   3. Generic-error acceptance — bare `.toThrow()` / `.toThrowError()` with
//      NO argument: the test passes for ANY error, so it cannot distinguish
//      the expected failure from an unrelated one. ALWAYS fail; assert the
//      specific error class, the tagged `_tag`/`code`, or a message pattern
//      instead. `.not.toThrow()` is exempt — asserting success is precise.
//      The register that carried the pre-existing `services/**` debt is gone:
//      all 22 sites across 11 files were narrowed on 2026-08-21, so there is
//      nothing left to suppress and no expiry left to rot.
//   4. Unasserted async failure — `.rejects` with no matcher naming the
//      expected error (e.g. a line ending in `.rejects;`).
//   5. Runtime-fence liveness — SKIP_REGISTER entries marked `runtimeFence`
//      execute ONLY on the pinned runtime (node 22.23.2 / ICU 78.2 /
//      Unicode 17.0 — the triple every Dockerfile asserts and every ci.yml job
//      installs). Under CI a drifted runtime FAILS: it means a governed
//      AI-language admission table stopped being verified while `pnpm test`
//      still exited 0. Off CI it is a warning — developers legitimately run
//      newer Node, and that is exactly why the drift must be caught in CI.
//
// ── SKIP/TODO/SKIPIF/RUNIF REGISTER (owner + reason + maxHits — keep narrow) ──
//
//   - src/shared/architecture/domain-error-convention.test.ts (owner: engineering)
//     Conditional presence fallback: contexts with domain/ but no
//     domain/errors.ts module are legitimately absent from the BQR-1.2
//     convention check, so the per-context test registers as skipped.
//
//   - The five ICU-fenced AI-language files (owner: engineering). Measured
//     2026-08-21: these account for ALL 146 tests the unit project reports as
//     skipped on a non-pinned runtime, per file —
//
//       ai-review-language-catalogue.test.ts       79
//       ai-reply-language-verifier.test.ts         38
//       ai-language-script-consistency.test.ts     21
//       ai-zh-orthography-verifier.test.ts          7
//       ai-reply-template-catalogue.test.ts         1
//                                                 ———
//                                                 146
//
//     Until 2026-08-21 SKIP_RE was /\.(?:skip|todo)\(/, which matches none of
//     them: the gate printed "no unregistered skips" against 146 absent tests.
//     They are declared here, and rule 5 fails CI if the fences go inactive.
//
// ── Mutation-sample evidence (BQC-6.9 §4, run 2026-07-29) ──
//
// N=5 manual mutants seeded one at a time in critical decision code; EVERY
// mutant was caught by the existing suite (suite + assertion below), then
// reverted (git checkout). See the slice report for the full log.
//
//   #  mutant (file — change)                                          caught by (suite › assertion)
//   —  ——————————————————————————————————————————————————————————————  ————————————————————————————————————————————————————
//   1  source-content-lifecycle.ts — isContentEligibleForRead:         eligible-reads.test.ts ›
//      `contentExpiresAt > now` → `>= now` (expiry boundary)           'denies content at the exact expiry boundary'
//   2  reply-publication-workflow.ts — dropped the                     reply-publication-workflow.test.ts ›
//      `outcome_unknown → reconciling` transition-map entry            'allows outcome_unknown → reconciling'
//   3  permissions.ts — canForContext: `has(permission)` →             auth-context-helpers.test.ts ›
//      `!has(permission)` (inverted permission check)                  'uses effectivePermissions when present (ignores the role table)'
//   4  goal-type-rules.ts — rolling-window boundary:                   goal-type-rules.test.ts ›
//      `rollingWindowDays <= 0` → `< 0` (off-by-one)                   'rolling: zero window rejected'
//   5  processing-routing.ts — assertRegionResolved fail-closed        processing-routing.test.ts ›
//      throw removed (region guard open)                               'throws region_unresolved for unresolved/europe/global' + null (4 tests)
//
// Exploratory 6th mutant (NOT in the sample): an off-by-one INSIDE
// goal/ui/helpers.ts computeElapsedFraction's millisecond math escapes —
// its only pin is `toBeCloseTo(0.5, 1)` (±0.05 tolerance). Recommendation:
// pin exact fractions (or day-granularity inputs) in helpers.test.ts.
// Mutant 4 above covers the goal decision-boundary off-by-one instead.

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The runtime triple asserted at image build (Dockerfile:61,105;
// Dockerfile.ai-egress-gateway:11,31; Dockerfile.ai-execution-admission:12,28)
// and installed by every ci.yml job (`node-version: 22.23.2`). The fenced
// AI-language suites execute on this runtime and only on this runtime.
const PINNED_RUNTIME = { node: '22.23.2', icu: '78.2', unicode: '17.0' }
const RUNTIME_DRIFT = Object.entries(PINNED_RUNTIME)
  .filter(([key, want]) => process.versions[key] !== want)
  .map(([key, want]) => `${key} ${process.versions[key]} ≠ ${want}`)

/**
 * @type {ReadonlyArray<{
 *   file: string, owner: string, reason: string, maxHits: number,
 *   runtimeFence?: boolean, skippedTests?: number,
 * }>}
 */
const SKIP_REGISTER = [
  {
    file: 'src/shared/architecture/domain-error-convention.test.ts',
    owner: 'engineering',
    reason:
      'conditional presence fallback — contexts without a domain errors module are legitimately absent from the convention check',
    maxHits: 1,
  },
  {
    file: 'src/shared/ai-review-language-catalogue.test.ts',
    owner: 'engineering',
    reason:
      'describe.runIf pair fencing the 24-group review-language catalogue on the pinned runtime (node 22.23.2 / ICU 78.2 / Unicode 17.0) — the group mapping is generated from that exact ICU, so a different runtime must fail closed rather than assert a foreign table; the negative fence asserts that fail-closed path',
    maxHits: 2,
    runtimeFence: true,
    skippedTests: 79,
  },
  {
    file: 'src/shared/ai-reply-language-verifier.test.ts',
    owner: 'engineering',
    reason:
      'describe.runIf pair fencing CLD3 primary-language detection on the pinned ICU; the negative fence asserts catalogue-output validation is rejected on a non-pinned runtime',
    maxHits: 2,
    runtimeFence: true,
    skippedTests: 38,
  },
  {
    file: 'src/shared/ai-language-script-consistency.test.ts',
    owner: 'engineering',
    reason:
      'describe.runIf pair fencing the Script_Extensions admission table on the pinned ICU; the negative fence asserts the verifier fails closed before consulting a table generated by another ICU runtime',
    maxHits: 2,
    runtimeFence: true,
    skippedTests: 21,
  },
  {
    file: 'src/shared/ai-zh-orthography-verifier.test.ts',
    owner: 'engineering',
    reason:
      'describe.runIf pair fencing Han-orthography (Hans/Hant) evidence on the pinned ICU; the negative fence asserts the fail-closed path',
    maxHits: 2,
    runtimeFence: true,
    skippedTests: 7,
  },
  {
    file: 'src/shared/ai-reply-template-catalogue.test.ts',
    owner: 'engineering',
    reason:
      'single it.runIf(isAiReviewLanguageRuntimeAvailable()) — the whole-catalogue leakage/language/script/orthography validation needs the pinned ICU; the rest of the file runs unconditionally',
    maxHits: 1,
    runtimeFence: true,
    skippedTests: 1,
  },
]

const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$|\.stories\.tsx$/

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules') walk(p, out)
    } else if (TEST_FILE.test(ent.name)) {
      out.push(p)
    }
  }
  return out
}

const files = [
  ...walk(join(ROOT, 'src')),
  ...walk(join(ROOT, 'services')),
  ...walk(join(ROOT, 'e2e')),
]

// `.only` in every chained form vitest accepts — `describe.only(`,
// `it.concurrent.only(`, `test.only.each(`. The old regex required `.only(`
// immediately after the global, so both chained forms evaded it.
//
// The previous `fdescribe|fit` alternation is gone. Those are Jest/Jasmine
// globals and this repo has neither (vitest + playwright, no jest dependency),
// so it could never match a real focus: 0 hits across all 867 files in scope
// when measured on 2026-08-21. It was not merely dead, it was a liability —
// its `[^\w]` prefix class admits `.`, so with `*.stories.tsx` now in scope an
// ordinary `chart.fit(` call would have failed the gate.
const FOCUSED_RE = /(?:^|[^\w.])(?:describe|it|test)(?:\.\w+)*\.only\s*[(.]/
const SKIP_RE = /\.(?:skip|todo|skipIf|runIf)\(/
const BARE_THROW_RE = /\.toThrow(?:Error)?\(\s*\)/
const NOT_THROW_RE = /\.not\.toThrow(?:Error)?\(/
const UNASSERTED_REJECTS_RE = /\.rejects\s*(?:;|$)/

const skipRegister = new Map(SKIP_REGISTER.map((r) => [r.file, r]))
const skipHits = new Map() // file -> count

const failures = []

for (const abs of files) {
  const file = relative(ROOT, abs).split('\\').join('/')
  const lines = readFileSync(abs, 'utf-8').split('\n')
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`
    if (FOCUSED_RE.test(line)) {
      failures.push(`focused test (.only) at ${at} — remove the focus`)
    }
    if (SKIP_RE.test(line)) {
      skipHits.set(file, (skipHits.get(file) ?? 0) + 1)
      if (!skipRegister.has(file)) {
        failures.push(
          `unregistered .skip/.todo/.skipIf/.runIf at ${at} — unskip, or register with owner+reason in scripts/check-test-quality.mjs`,
        )
      }
    }
    if (BARE_THROW_RE.test(line) && !NOT_THROW_RE.test(line)) {
      failures.push(
        `bare .toThrow() at ${at} accepts ANY error — assert the specific error class, tagged _tag/code, or message pattern`,
      )
    }
    if (UNASSERTED_REJECTS_RE.test(line)) {
      failures.push(
        `unasserted async failure at ${at} — '.rejects' must be followed by a matcher naming the expected error`,
      )
    }
  })
}

// Registered debt must stay within its registered count and must not go stale.
// No register currently carries an expiry; if one is reintroduced, the expiring
// exception pattern already exists in check-licenses.mjs.
function auditRegister(label, entries, hits) {
  for (const reg of entries) {
    const n = hits.get(reg.file) ?? 0
    if (n > reg.maxHits) {
      failures.push(
        `${reg.file}: ${n} ${label} hits exceed the registered ${reg.maxHits} (owner ${reg.owner})`,
      )
    }
    if (n === 0) {
      failures.push(
        `stale ${label} register entry: ${reg.file} (owner ${reg.owner}) has no hits — remove the entry`,
      )
    }
  }
}

auditRegister('skip/todo/skipIf/runIf', SKIP_REGISTER, skipHits)

// Rule 5 — the fenced suites must actually be running, everywhere.
//
// This used to hard-fail only inside GitHub Actions, on the argument that CI was
// the only place the runtime could be guaranteed. That is no longer true: the
// runtime is pinned in .nvmrc, named exactly by engines.node, resolved by every
// CI job through node-version-file, and asserted by the local-stack
// orchestrator. Drift is now a fixable local condition, so it fails locally too
// — with ALLOW_RUNTIME_DRIFT=1 as the explicit, noisy acknowledgement.
const fenced = SKIP_REGISTER.filter((r) => r.runtimeFence)
const fencedTests = fenced.reduce((sum, r) => sum + (r.skippedTests ?? 0), 0)
if (RUNTIME_DRIFT.length > 0) {
  const detail =
    `${fenced.length} runtime-fenced file(s) (~${fencedTests} tests) do NOT run on this runtime ` +
    `(${RUNTIME_DRIFT.join(', ')})`
  // Fails everywhere now, not just in GitHub Actions. The runtime is pinned and
  // enforced (.nvmrc + engines.node + the local-stack assert), so drift is a
  // fixable local condition rather than an unavoidable fact about contributors'
  // machines — and the old warn-locally branch is exactly how ~150 governed
  // AI-language assertions sat silently skipped on a Node 26 workstation while
  // the suite still exited 0.
  if (process.env.ALLOW_RUNTIME_DRIFT === '1') {
    console.warn(
      `[test-quality] NOTE — ${detail}. Skipped by ALLOW_RUNTIME_DRIFT=1; the fenced suites did NOT run.`,
    )
  } else {
    failures.push(
      `runtime-fence drift — ${detail}. The pinned runtime (.nvmrc, node ${PINNED_RUNTIME.node}) is what ` +
        'makes these suites run at all; on a drifted runtime the governed AI-language admission tables ' +
        'stop being verified and the suite still exits 0. Run `fnm use` (or `nvm use`), or set ' +
        'ALLOW_RUNTIME_DRIFT=1 to acknowledge the gap.',
    )
  }
}

const storyCount = files.filter((f) => f.endsWith('.stories.tsx')).length

/** Split hit counts into the registered and unregistered halves. */
function tally(hits, register) {
  let known = 0
  let unknown = 0
  for (const [file, n] of hits) {
    if (register.has(file)) known += n
    else unknown += n
  }
  return `${known} registered${unknown > 0 ? ` + ${unknown} UNREGISTERED` : ''}`
}

console.log(
  `[test-quality] scanned ${files.length} test/spec/story files across src+services+e2e ` +
    `(incl. ${storyCount} *.stories.tsx); ` +
    `skip|todo|skipIf|runIf: ${tally(skipHits, skipRegister)} site(s) in ${skipHits.size} file(s) ` +
    `(${SKIP_REGISTER.length} register entries; ${fenced.length} runtime-fenced, ` +
    `~${fencedTests} tests retired off the pinned runtime)`,
)

if (failures.length > 0) {
  console.error(`[test-quality] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  '[test-quality] OK — no focused tests, no unregistered skips/fences, no generic-error acceptance, no unasserted async failures',
)
