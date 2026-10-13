// The rules of the test-quality gate, apart from the walk and the register so
// they can be run on their own: `scripts/check-test-quality.mjs` applies them
// to the repository, `scripts/ci/test-quality-rules.test.ts` to single lines
// and to register entries written for the purpose. What each rule is for is
// stated in the gate's header.

/**
 * Files the gate governs. `*.metrics.ts` are the Playwright suites under
 * `e2e/storybook-metrics` (playwright.storybook.config.ts): until 2026-10-13
 * the pattern left them out, so a `.only` or a skip there was seen by nothing.
 */
export const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$|\.stories\.tsx$|\.metrics\.ts$/

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
// A matcher after `.rejects` that every rejection satisfies: the promise
// rejected with something, with something truthy, or with an Error of any
// kind. `toThrow(Error)` is the same acceptance in its synchronous spelling.
const ANY_REJECTION_RE =
  /\.rejects\s*\.\s*(?:toBeDefined\(|toBeTruthy\(|toBeInstanceOf\(\s*Error\s*\))/
const ANY_ERROR_CLASS_RE = /\.toThrow(?:Error)?\(\s*Error\s*\)/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A `.skip(` / `.todo(` / `.skipIf(` / `.runIf(` site: counted against the register. */
export function isSkipSite(line) {
  return SKIP_RE.test(line)
}

const LINE_RULES = [
  {
    matches: (line) => FOCUSED_RE.test(line),
    failure: (at) => `focused test (.only) at ${at} — remove the focus`,
  },
  {
    matches: (line) => BARE_THROW_RE.test(line) && !NOT_THROW_RE.test(line),
    failure: (at) =>
      `bare .toThrow() at ${at} accepts ANY error — assert the specific error class, tagged _tag/code, or message pattern`,
  },
  {
    matches: (line) => UNASSERTED_REJECTS_RE.test(line),
    failure: (at) =>
      `unasserted async failure at ${at} — '.rejects' must be followed by a matcher naming the expected error`,
  },
  {
    matches: (line) =>
      ANY_REJECTION_RE.test(line) ||
      (ANY_ERROR_CLASS_RE.test(line) && !NOT_THROW_RE.test(line)),
    failure: (at) =>
      `any-error matcher at ${at} accepts ANY failure (toBeDefined, toBeTruthy or the base Error class) — assert the specific error class, tagged _tag/code, or message pattern`,
  },
]

/** What is wrong with one line, skips aside; `at` is its `file:line`. */
export function lineFailures(line, at) {
  return LINE_RULES.filter((rule) => rule.matches(line)).map((rule) => rule.failure(at))
}

/**
 * A registered skip is debt with a reason, and a reason can stop being true
 * while the entry stays. Entries the gate checks live on every run (the
 * runtime fences, rule 5) cannot go stale that way; every other entry carries
 * a `reviewBy` date, and after it the gate fails until someone has looked.
 */
function reviewFailures(entry, today) {
  if (entry.runtimeFence) return []
  if (typeof entry.reviewBy !== 'string' || !ISO_DATE_RE.test(entry.reviewBy)) {
    return [
      `${entry.file}: skip register entry (owner ${entry.owner}) has no reviewBy date (YYYY-MM-DD) — say when its reason is next checked`,
    ]
  }
  if (entry.reviewBy >= today) return []
  return [
    `${entry.file}: skip register entry (owner ${entry.owner}) passed its review-by date ${entry.reviewBy} — check that its reason still holds, then re-enable the test or move the date`,
  ]
}

/**
 * Registered debt must stay within its registered count, must not go stale,
 * and must be looked at again by its review-by date. `today` is YYYY-MM-DD.
 */
export function registerFailures(entries, hits, today) {
  return entries.flatMap((entry) => {
    const count = hits.get(entry.file) ?? 0
    const failures = []
    if (count > entry.maxHits) {
      failures.push(
        `${entry.file}: ${count} skip/todo/skipIf/runIf hits exceed the registered ${entry.maxHits} (owner ${entry.owner})`,
      )
    }
    if (count === 0) {
      failures.push(
        `stale skip/todo/skipIf/runIf register entry: ${entry.file} (owner ${entry.owner}) has no hits — remove the entry`,
      )
    }
    return [...failures, ...reviewFailures(entry, today)]
  })
}
