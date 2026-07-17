# BQR validation: primary-source notes

**Date:** 2026-07-16  
**Scope:** External verification of five assertions raised during the BQR implementation review. Sources are limited to the documentation maintained by the relevant projects.

## 1. BullMQ failure and retry semantics

**Verdict: confirmed.** BullMQ defines a successful processor result as a completed job and a thrown processor exception as a failed job. Automatic retry applies to failed jobs when `attempts` is greater than one. BullMQ also says processors should throw `Error` objects. See [BullMQ: Workers](https://docs.bullmq.io/guide/workers) and [BullMQ: Retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs).

It follows that catching a handler error, logging it, and then resolving the processor does **not** activate BullMQ's failure/retry path; the worker observes a successfully resolved processor and completes the job. A retryable dispatcher failure must be re-thrown/rejected after any logging or bookkeeping. A deliberately non-retryable failure can instead use BullMQ's documented `UnrecoverableError`; see [BullMQ: Stop retrying jobs](https://docs.bullmq.io/patterns/stop-retrying-jobs).

**Review implication:** any RepKey processor branch described as “will be retried” must actually throw/reject and the job must have an `attempts` policy. Merely returning after malformed input, missing consumers, or a failed consumer is an acknowledgement, not a retry request.

## 2. Bounded PostgreSQL deletes

**Verdict: confirmed.** PostgreSQL's `DELETE` syntax has no direct `LIMIT` clause. The official documentation explicitly says this and demonstrates a bounded delete with a CTE that selects an ordered batch of `ctid` values using `FOR UPDATE ... LIMIT`, followed by `DELETE ... USING` against that batch. See [PostgreSQL: `DELETE`](https://www.postgresql.org/docs/current/sql-delete.html).

The documented shape is:

```sql
WITH delete_batch AS (
  SELECT row_to_delete.ctid
  FROM table_name AS row_to_delete
  WHERE <retention predicate>
  ORDER BY <stable batch order>
  FOR UPDATE
  LIMIT <batch size>
)
DELETE FROM table_name AS target
USING delete_batch AS batch
WHERE target.ctid = batch.ctid;
```

The operation is repeated until no rows remain. PostgreSQL notes that this use of `ctid` is safe in that repeated-query pattern. Where concurrent sweepers are possible, the related official batching guidance says `SKIP LOCKED` can reduce contention, with a final unbounded pass needed to avoid permanently overlooking locked matches; see [PostgreSQL: `UPDATE` batching guidance](https://www.postgresql.org/docs/current/sql-update.html).

**Review implication:** `DELETE FROM ... WHERE ... LIMIT n` is not valid PostgreSQL and cannot be accepted as an implemented retention batch.

## 3. Playwright `on-first-retry` with zero retries

**Verdict: confirmed.** Playwright documents `trace: 'on-first-retry'` as recording the first retry of a failed test, not the initial run. Its own example pairs the option with retries enabled in CI and explains that no first-run trace is recorded. See [Playwright: Trace Viewer](https://playwright.dev/docs/trace-viewer-intro).

Therefore, a configuration with `retries: 0` and `trace: 'on-first-retry'` produces no retry and consequently no trace. If zero retries are intentional, use a failure-retention trace mode or explicitly enable tracing for the run; the supported modes are listed in [Playwright's command-line documentation](https://playwright.dev/docs/test-cli). Playwright's CI debugging guidance recommends retaining traces for failures rather than tracing every passing test; see [Playwright: Best Practices](https://playwright.dev/docs/best-practices#debugging-on-ci).

**Review implication:** RepKey's current combination is internally ineffective as failure diagnostics and should not be counted as trace evidence.

## 4. Storybook component, console, and accessibility failures

**Verdict: confirmed, with separate behavior for each failure class.**

- Storybook's legacy test runner turns stories into browser tests. A story without a `play` function receives a render smoke test; a story with `play` also fails for play-function errors or failed assertions. This covers render/component failures. See [Storybook: Test runner](https://storybook.js.org/addons/%40storybook/test-runner).
- Browser `console.error` output is not the same gate. The test runner provides the explicit `--failOnConsole` flag to make browser console errors fail the suite. Without that flag, console errors can be reported without making the run fail. See the same [test-runner CLI documentation](https://storybook.js.org/addons/%40storybook/test-runner).
- Accessibility violations fail CI only when `parameters.a11y.test` is set to `'error'`; `'todo'` warns and `'off'` skips. See [Storybook: Accessibility tests](https://storybook.js.org/docs/writing-tests/accessibility-testing#test-behavior).
- For Vite-based Storybook projects, Storybook now recommends its Vitest addon. It transforms stories into component tests in browser mode, runs render smoke tests and `play` assertions, and can run accessibility checks alongside them. See [Storybook: Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon/index) and [the migration guidance](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon/migration-guide).

**Review implication:** RepKey's global `a11y.test: 'error'` is the correct fail-on-violation posture, but the legacy `test-storybook` script does not include `--failOnConsole`. Render/play success alone is therefore not evidence that the browser console remained error-free. The project currently carries both the legacy test runner and the Vitest addon; the later remediation plan should designate one authoritative component-test gate and make its failure policy explicit.

## 5. TanStack Router and colocated test files

**Verdict: confirmed.** TanStack Router considers all files under `routesDirectory` as route candidates by default. Its official configuration provides two exclusion mechanisms:

- `routeFileIgnorePrefix`, whose default is `-`, for files or directories such as `-components` that must not become routes;
- `routeFileIgnorePattern`, a regular-expression pattern for matching non-route files.

See [TanStack Router: File-Based Routing API](https://tanstack.com/router/latest/docs/api/file-based-routing#routefileignoreprefix) and its [`routeFileIgnorePattern` option](https://tanstack.com/router/latest/docs/api/file-based-routing#routefileignorepattern). The routing-concepts documentation also states that a `-` prefix excludes a file or directory from route generation; see [TanStack Router: Routing Concepts](https://tanstack.com/router/latest/docs/routing/routing-concepts).

**Review implication:** a file such as `src/routes/api/webhooks/gbp/notifications.test.ts` is a route candidate unless the project config excludes test files. The supported remedies are to move the test outside `src/routes`, prefix the non-route file with the configured ignore prefix, or configure a `routeFileIgnorePattern` that covers route-adjacent test files. Suppressing or accepting the generator warning without an exclusion leaves the route tree's input ambiguous.

## Bottom line

All five review assertions are supported by current official documentation. Four are direct documented behaviors; the statement that “catching and resolving completes the BullMQ job” and the zero-retry Playwright consequence are necessary inferences from the documented success/failure state transitions and retry-only trace mode, not independent undocumented claims.
