# BQC-0.5 — Pinned Baseline (2026-07-17)

**Runner:** `pnpm bqc:run-baseline` (`scripts/bqc/run-baseline.ts`)
**Pinned to:** commit `927614bce728f8c42d922720f149b6ea1b046354`, migration `0011_people-access-and-attribution`, lockfile SHA-256 `948a751d…b197287` (full values in `baseline.json`)
**Environment:** local engineering machine (macOS/arm64, Node 22), dedicated scratch database `repkey_bqc05_baseline` (created for this run; no dev/shared database touched), local Redis, `NODE_ENV=test`
**Verbatim summary:** 13/17 gates pass. Four gates fail and are recorded as failures. Nothing here is reinterpreted as an expected pass; classification below only assigns ownership.

## Gate results

| Gate                                              | Result          | Duration | Log                      |
| ------------------------------------------------- | --------------- | -------: | ------------------------ |
| format                                            | pass            |       6s | `format.log`             |
| types                                             | pass            |       7s | `types.log`              |
| lint                                              | pass            |       5s | `lint.log`               |
| migrations (auth + drizzle + auth-schema verify)  | pass            |       8s | `migrations.log`         |
| unit (3396 tests)                                 | pass            |      12s | `unit.log`               |
| integration (repository + migration verification) | pass            |       6s | `integration.log`        |
| build-web                                         | pass            |       3s | `build-web.log`          |
| build-worker                                      | pass            |       1s | `build-worker.log`       |
| storybook-build                                   | pass            |       6s | `storybook-build.log`    |
| storybook-test                                    | pass            |      12s | `storybook-test.log`     |
| dependency-audit                                  | **fail**        |       2s | `dependency-audit.log`   |
| fallow-dead-code                                  | **fail**        |      <1s | `fallow-dead-code.log`   |
| fallow-duplication                                | pass            |      <1s | `fallow-duplication.log` |
| fallow-health                                     | **fail**        |      <1s | `fallow-health.log`      |
| seed-e2e                                          | pass            |       1s | `seed-e2e.log`           |
| e2e-critical (7 tests, hard gate)                 | pass            |      11s | `e2e-critical.log`       |
| e2e-full (10 tests + 1 skipped)                   | **fail** (6/10) |     116s | `e2e-full.log`           |

## Failure classification (ownership, not excusal)

1. **dependency-audit — 5 known vulnerabilities (2 low, 3 moderate).**
   Includes the esbuild dev-server advisory (GHSA-g7r4-m6w7-qqqr, dev-only reach). No high/critical. Owner: BQC-7 (SPEC-P1-06 security gates). Not gated in CI today — recorded here as the authoritative dependency state.

2. **fallow-dead-code — 258 issues (22 files, 194 exports, 24 stale suppressions).**
   This is the documented `.fallowrc.json` regression-baseline state; CI gates on `new-only` so it passes there. Owner: BQC-5 (STD-P2-05).

3. **fallow-health — 120 above threshold; maintainability 90.6 (rated "good").**
   Existing complexity hotspots. Owner: BQC-5 (STD-P2-05).

4. **e2e-full — 6 failures, all on the registration path** (`auth` register, `member-invitation`, `navigation` property tabs, `reset-password`, `staff-assignment`, `team-management`; the 4 seeded-account specs pass).
   **Root cause captured during this baseline:** the browser throws uncaught `Module "node:crypto" has been externalized for browser compatibility. Cannot access "node:crypto.createHash" in client code`; the registration submit dies client-side and no `/api/auth/sign-up` request ever reaches the server (verified with a controlled dev server + `DEBUG=pw:browser`). This is open finding **STD-P2-01** (Node crypto in review domain/client — BQC-5 primary, BQC-6 supporting) manifesting in the browser.
   **Environment note:** CI's full suite passes on the same code, so a timing/environment dimension remains to isolate (owner: BQC-6, SPEC-P1-03/STD-P1-05). Locally the failure is 100% reproducible.

## Reproduction

```bash
createdb repkey_bqc05_baseline   # or any dedicated scratch DB — never a dev DB
NODE_ENV=test \
DATABASE_URL=postgresql://<user>@localhost:5432/repkey_bqc05_baseline \
REDIS_URL=redis://localhost:6379 \
BETTER_AUTH_SECRET=<32+ chars> BETTER_AUTH_URL=http://localhost:3000 \
RESEND_API_KEY=<placeholder ok> GOOGLE_CLIENT_ID=<placeholder> GOOGLE_CLIENT_SECRET=<placeholder> \
ENCRYPTION_KEY=<64 hex> OAUTH_STATE_SECRET=<64 hex> \
E2E_TEST_EMAIL=test@example.com E2E_TEST_PASSWORD=password123 \
BETA_E2E_GLOBAL_CAPABILITIES=identity.register,organization.create,team.use \
BETA_E2E_EXECUTION_IDENTITY=local-baseline-e2e \
pnpm bqc:run-baseline
```

Results land in a new `evidence/baseline-<timestamp>/` directory; the runner exits non-zero when any gate fails.

## Process notes

- A first capture (`baseline-2026-07-17T08-16-25`, discarded) exposed two runner-side issues — the runner itself failed the format gate, and the integration gate needed `TEST_DATABASE_URL` forwarded (vitest.config defaults to `test:test@localhost/test`). Both were fixed in the runner commit before this pinned run.
- The correlation-id uniqueness unit test (`correlation-id.test.ts`) is probabilistic over 2^32 (≈1-in-8600 collision odds per run; observed once in PR #211's CI). It passed both baseline runs but should be made statistically sound (owner: BQC-6).
