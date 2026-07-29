#!/usr/bin/env node
// BQC-6.9 — test-quality gate. Wired into `pnpm lint` (CI check job runs it
// via the Lint step) and runnable directly as `pnpm check:test-quality`.
//
// Scans src/**/*.test.ts(x) and e2e/**/*.spec.ts for four test smells:
//
//   1. Focused tests — `.only(` / `fdescribe(` / `fit(`. ALWAYS fail; a
//      focused test silently shrinks the suite in CI.
//   2. Skipped tests — `.skip(` / `.todo(`. Fail unless registered below
//      with owner + reason (and within the registered hit count).
//   3. Generic-error acceptance — bare `.toThrow()` / `.toThrowError()` with
//      NO argument: the test passes for ANY error, so it cannot distinguish
//      the expected failure from an unrelated one. Assert the specific error
//      class, the tagged `_tag`/`code`, or a message pattern instead.
//      `.not.toThrow()` is exempt — asserting success is precise.
//   4. Unasserted async failure — `.rejects` with no matcher naming the
//      expected error (e.g. a line ending in `.rejects;`).
//
// SKIP/TODO REGISTER (owner + reason + maxHits — keep narrow):
//
//   - src/shared/architecture/domain-error-convention.test.ts (owner: engineering)
//     Conditional presence fallback: contexts with domain/ but no
//     domain/errors.ts module are legitimately absent from the BQR-1.2
//     convention check, so the per-context test registers as skipped.
//   - e2e/post-beta/guest-portal.spec.ts (owner: engineering)
//     portal.read is dark for beta; the suite is excluded from both
//     Playwright projects (testIgnore 'post-beta/' in playwright.config.ts)
//     and the runtime skip guards accidental inclusion. Re-enable with the
//     capability posture change + a portal seed fixture.
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

/** @type {ReadonlyArray<{ file: string, owner: string, reason: string, maxHits: number }>} */
const SKIP_REGISTER = [
  {
    file: 'src/shared/architecture/domain-error-convention.test.ts',
    owner: 'engineering',
    reason:
      'conditional presence fallback — contexts without a domain errors module are legitimately absent from the convention check',
    maxHits: 1,
  },
  {
    file: 'e2e/post-beta/guest-portal.spec.ts',
    owner: 'engineering',
    reason:
      'portal.read dark for beta; suite testIgnored from Playwright projects — runtime skip guards accidental inclusion until posture change + portal seed fixture',
    maxHits: 1,
  },
]

const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/

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

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'e2e'))]

const FOCUSED_RE =
  /(?:^|[^\w.])(?:describe|it|test)\.only\(|(?:^|[^\w])(?:fdescribe|fit)\(/
const SKIP_RE = /\.(?:skip|todo)\(/
const BARE_THROW_RE = /\.toThrow(?:Error)?\(\s*\)/
const NOT_THROW_RE = /\.not\.toThrow(?:Error)?\(/
const UNASSERTED_REJECTS_RE = /\.rejects\s*(?:;|$)/

const register = new Map(SKIP_REGISTER.map((r) => [r.file, r]))
const skipHits = new Map() // file -> count

const failures = []

for (const abs of files) {
  const file = relative(ROOT, abs)
  const lines = readFileSync(abs, 'utf-8').split('\n')
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`
    if (FOCUSED_RE.test(line)) {
      failures.push(`focused test (.only/fdescribe/fit) at ${at} — remove the focus`)
    }
    if (SKIP_RE.test(line)) {
      skipHits.set(file, (skipHits.get(file) ?? 0) + 1)
      const reg = register.get(file)
      if (!reg) {
        failures.push(
          `unregistered .skip/.todo at ${at} — unskip, or register with owner+reason in scripts/check-test-quality.mjs`,
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

// Registered skips must stay within their registered count and not rot.
for (const reg of SKIP_REGISTER) {
  const hits = skipHits.get(reg.file) ?? 0
  if (hits > reg.maxHits) {
    failures.push(
      `${reg.file}: ${hits} skip/todo hits exceed the registered ${reg.maxHits} (owner ${reg.owner})`,
    )
  }
  if (hits === 0) {
    failures.push(
      `stale skip-register entry: ${reg.file} (owner ${reg.owner}) has no skip/todo hits — remove the entry`,
    )
  }
}

console.log(
  `[test-quality] scanned ${files.length} test/spec files; ` +
    `${skipHits.size} file(s) with registered skips (${SKIP_REGISTER.length} registered)`,
)

if (failures.length > 0) {
  console.error(`[test-quality] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  '[test-quality] OK — no focused tests, no unregistered skips, no generic-error acceptance, no unasserted async failures',
)
