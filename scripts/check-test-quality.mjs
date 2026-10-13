#!/usr/bin/env node
// BQC-6.9 — test-quality gate. Wired into `pnpm lint:ci` (CI check job runs it
// via the Lint step) and runnable directly as `node scripts/check-test-quality.mjs`.
//
// ── SCOPE (widened 2026-08-21 — three holes that let this gate be evaded) ──
//
//   src/**, services/**, e2e/**, scripts/**, server/**,
//   .storybook/**                 *.test.ts(x) / *.spec.ts(x)
//   src/** and .storybook/**      *.stories.tsx
//   e2e/**                        *.metrics.ts (added 2026-10-13: the twenty
//                                 Storybook Playwright suites were a fourth
//                                 hole; no workflow runs them either, so this
//                                 gate is the only thing that reads them)
//
// `services/**` is in the unit project's include (vitest.config.ts:91) — it is
// the AI egress-gateway + execution-admission plane — and `*.stories.tsx` is a
// hard CI gate (the `storybook-test` job). Both ran every day while being
// unscanned by the gate that governs them.
//
// ── Six rules (the line rules and the register audit live in
//    ./test-quality-rules.mjs, tested by scripts/ci/test-quality-rules.test.ts) ──
//
//   1. Focused tests — `.only`, in every chained form vitest accepts
//      (`describe.only(`, `it.concurrent.only(`, `test.only.each(`). ALWAYS
//      fail; a focused test silently shrinks the suite in CI.
//   2. Conditionally-absent tests — `.skip(` / `.todo(` / `.skipIf(` /
//      `.runIf(`. Fail unless registered in SKIP_REGISTER with owner + reason
//      and within the registered hit count. `runIf`/`skipIf` matter MORE than
//      `skip`: they retire tests on a *runtime* predicate, so coverage
//      disappears with the suite still green and exit 0.
//      A reason can stop being true while its entry stays, so an entry also
//      carries `reviewBy` (YYYY-MM-DD) and fails the gate after that date
//      until someone has checked the reason and moved it. The runtime fences
//      need none: rule 5 checks them on every run.
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
//   6. Any-error acceptance after `.rejects` — `.rejects.toBeDefined()`,
//      `.rejects.toBeTruthy()`, `.rejects.toBeInstanceOf(Error)`, and
//      `.toThrow(Error)` in either spelling. Every failure satisfies them: a
//      `TypeError` from an unconfigured mock passes a test titled "answers
//      not found". ALWAYS fail; the 22 sites that existed on 2026-10-13 were
//      narrowed the day the rule landed.
//
// ── What the gate does NOT see ──
//
// It reads one line at a time and knows nothing about what an assertion
// compares. Three kinds of weak test pass it, and only review catches them:
// an assertion on a value the test built itself, a test that uses the code
// under test as its own oracle, and a run that reaches no assertion at all (an
// early return, or an absence asserted after a fixed sleep).
//
// ── SKIP/TODO/SKIPIF/RUNIF REGISTER (owner + reason + maxHits + reviewBy — keep narrow) ──
//   - Every entry that is not a runtime fence carries `reviewBy`. The date is
//     not an expiry of the skip: on the day after it the gate fails, whoever
//     picks that up checks the reason against the product as it then is, and
//     either re-enables the test or writes the next date. Three months is the
//     horizon used so far.
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
// N=4 manual mutants seeded one at a time in critical decision code; EVERY
// mutant was caught by the existing suite (suite + assertion below), then
// reverted. See the slice report for the full log.
//
//   #  mutant (file — change)                                          caught by (suite › assertion)
//   —  ——————————————————————————————————————————————————————————————  ————————————————————————————————————————————————————
//   1  source-content-lifecycle.ts — isContentEligibleForRead:         eligible-reads.test.ts ›
//      `contentExpiresAt > now` → `>= now` (expiry boundary)           'denies content at the exact expiry boundary'
//   2  reply-publication-workflow.ts — dropped the                     reply-publication-workflow.test.ts ›
//      `outcome_unknown → reconciling` transition-map entry            'allows outcome_unknown → reconciling'
//   3  permissions.ts — canForContext: `has(permission)` →             auth-context-helpers.test.ts ›
//      `!has(permission)` (inverted permission check)                  'uses effectivePermissions when present (ignores the role table)'
//   4  processing-routing.ts — assertRegionResolved fail-closed        processing-routing.test.ts ›
//      throw removed (region guard open)                               'throws region_unresolved for unresolved/europe/global' + null (4 tests)

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TEST_FILE,
  isSkipSite,
  lineFailures,
  registerFailures,
} from './test-quality-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The exact Node version comes from the same .nvmrc every CI job installs.
// Node bundles ICU, so those two attested runtime values remain explicit.
const PINNED_RUNTIME = {
  node: readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim(),
  icu: '78.2',
  unicode: '17.0',
}
const RUNTIME_DRIFT = Object.entries(PINNED_RUNTIME)
  .filter(([key, want]) => process.versions[key] !== want)
  .map(([key, want]) => `${key} ${process.versions[key]} ≠ ${want}`)

/**
 * @type {ReadonlyArray<{
 *   file: string, owner: string, reason: string, maxHits: number,
 *   runtimeFence?: boolean, skippedTests?: number, reviewBy?: string,
 * }>}
 */
const SKIP_REGISTER = [
  {
    file: 'e2e/critical/workflows/dashboard-governance.spec.ts',
    owner: 'engineering',
    reason:
      'Member login is a dark capability in the closed beta: 52635b32 made only owner/admin tokens beta-interactive, so a Member cannot resolve tenant context and the sign-in fails before any assertion. The test asserts Member-scoped dashboard governance, which is real coverage — it returns when the capability is activated, not by relaxing the fence',
    maxHits: 1,
    skippedTests: 1,
    reviewBy: '2027-01-13',
  },
  {
    file: 'e2e/critical/workflows/property-access.spec.ts',
    owner: 'engineering',
    reason:
      'same dark capability as dashboard-governance: the test signs in as a Member to prove a property-scoped account cannot see another property. The scoping property is worth keeping and comes back with Member login',
    maxHits: 1,
    skippedTests: 1,
    reviewBy: '2027-01-13',
  },
  {
    file: 'e2e/storybook-metrics/guest-vitals.metrics.ts',
    owner: 'engineering',
    reason:
      'test.skip(STORYBOOK_STATIC_DIR === null, …) over the LCP and CLS describe: a paint time is only meaningful from the production Storybook build, which `pnpm test:guest:quality` serves (STORYBOOK_METRICS_STATIC); against the dev server the block is skipped. No workflow runs that script, so in CI these tests run nowhere: at review, either the guest quality run has a job or this entry says again why not',
    maxHits: 1,
    reviewBy: '2027-01-13',
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
  ...walk(join(ROOT, 'scripts')),
  ...walk(join(ROOT, 'server')),
  ...walk(join(ROOT, '.storybook')),
]

const skipRegister = new Map(SKIP_REGISTER.map((r) => [r.file, r]))
const skipHits = new Map() // file -> count

const failures = []

for (const abs of files) {
  const file = relative(ROOT, abs).split('\\').join('/')
  const lines = readFileSync(abs, 'utf-8').split('\n')
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`
    failures.push(...lineFailures(line, at))
    if (isSkipSite(line)) {
      skipHits.set(file, (skipHits.get(file) ?? 0) + 1)
      if (!skipRegister.has(file)) {
        failures.push(
          `unregistered .skip/.todo/.skipIf/.runIf at ${at} — unskip, or register with owner+reason+reviewBy in scripts/check-test-quality.mjs`,
        )
      }
    }
  })
}

// Registered debt must stay within its registered count, must not go stale,
// and must be looked at again by its review-by date. The date is read in UTC,
// as the audit, license and container-scan gates read theirs.
const today = new Date().toISOString().slice(0, 10)
failures.push(...registerFailures(SKIP_REGISTER, skipHits, today))

// Rule 5 — the fenced suites must actually be running, everywhere.
//
// A drifted runtime fails because .nvmrc is the repository's exact source of
// truth and every CI job resolves it through node-version-file.
// ALLOW_RUNTIME_DRIFT=1 remains the explicit, noisy local acknowledgement.
const fenced = SKIP_REGISTER.filter((r) => r.runtimeFence)
const fencedTests = fenced.reduce((sum, r) => sum + (r.skippedTests ?? 0), 0)
if (RUNTIME_DRIFT.length > 0) {
  const detail =
    `${fenced.length} runtime-fenced file(s) (~${fencedTests} tests) do NOT run on this runtime ` +
    `(${RUNTIME_DRIFT.join(', ')})`
  // The .nvmrc pin is enforceable locally and in CI. The old warning branch
  // allowed governed AI-language assertions to sit silently skipped.
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
  `[test-quality] scanned ${files.length} test/spec/story files across all executable TypeScript roots ` +
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
  '[test-quality] OK — no focused tests, no unregistered or unreviewed skips/fences, no generic-error acceptance, no unasserted async failures',
)
