# E2E flake register

Every e2e failure that passed on a re-run of the **same commit** gets a row here.

## Why this file exists

Before it, the only record of a recurring flake was a comment inside the spec
that suffered from it — `google-import-sync.spec.ts` carried "six CI failures"
in prose. That made the base rate invisible: nobody could say whether a red e2e
job was unlucky or whether one test had been eating a 10-minute rerun every
other day. A register makes the cost countable, which is what justifies fixing
(or quarantining) a test instead of re-running it.

## The policy this register serves

- `retries: 1` in CI (`playwright.config.ts`). A flake reports as `flaky`
  instead of failing the job, so nobody pays a manual rerun to classify it.
- Pushes to `main` add `--fail-on-flaky-tests`: the release path refuses a suite
  that only passes on retry. A flake therefore cannot accumulate silently — it
  blocks the release until it is fixed or explicitly quarantined.
- Locally `retries: 0`, so a flake is visible while you work on it.

A row here is not a shrug. Three rows for one spec is a bug report with
evidence, and the fix belongs in the spec or the code under it.

## How to add a row

Take the values from the failing run's log and artifacts (the e2e job uploads
`e2e-artifacts-critical` / `e2e-artifacts-full` and
`e2e-local-stack-evidence`). Reproduce locally with:

```bash
pnpm local:doctor                      # runtime, docker, ports, stale containers
pnpm e2e:stack:up
for i in 1 2 3 4 5; do pnpm e2e:stack:reseed && pnpm test:e2e --project=critical -g "<title>"; done
pnpm e2e:stack:down
```

`reseed` matters: most critical specs assume first-run state, so repeating one
against a stack it already mutated produces failures that are not the flake.

## Register

| First seen | Spec / test                                                                                    | Signature                                                                                                                | Occurrences                                                 | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-22 | `critical/workflows/google-import-sync.spec.ts:175` — pages discovery, imports create + relink | Import settles `completed_with_issues`; the **relink** item cancelled `authorization_changed`, `retryRevision: 0`        | 2 in 4 CI runs, plus 6 recorded earlier in the spec comment | **Partly fixed.** One confirmed cause removed: a routine token refresh bumps `credential_generation` alone, and the frozen comparisons treated that as revocation (`sameExpectedConnection` now monotonic, `credentialGeneration` in `FROZEN_VECTOR_EXCLUDED_KEYS`). No recurrence in 8 local runs + 6 CI runs since. All six `authorization_changed` deny sites now log `google_import.authorization_changed_detail` with expected-vs-observed counters, so a recurrence names its own cause. |
| 2026-08-22 | `critical/workflows/reply-lifecycle.spec.ts:256` — (c) terminal 403 → publish_failed           | `waitFor timed out after 30000ms across 119 probe(s): reply terminally publish_failed`; passed on rerun of the same SHA  | 1                                                           | **Fixed.** Worker-polling wait had a 30s budget; now inherits the 90s default with `diagnose`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-22 | `critical/workflows/reply-lifecycle.spec.ts:199` — (b) transient 500 heals through retryQueued | `waitFor timed out after 45000ms across 179 probe(s): reply published after the transient retry` (local, loaded machine) | 1                                                           | **Fixed.** Same class as `:256`; now inherits the 90s default with `diagnose`.                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Known non-flakes — do not add these

Failures that look intermittent but are environmental, so a rerun "fixes" them
and the register would fill with noise:

- **Repeated critical runs against one stack.** `guest-portal.spec.ts:52/:114`,
  `beta-product-journeys.spec.ts:402` and `accessibility.spec.ts:181` fail on the
  second and later runs because they assume first-run seed state. Use
  `pnpm e2e:stack:reseed` between runs.
- **Wrong Node major.** The stack fails `ENOBUFS` mid-boot and the ICU-fenced
  suites skip themselves. `pnpm local:doctor` catches it.
