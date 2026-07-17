# BQC-6 — Trustworthy Verification and Experience Gates

**Status:** `not_started`  
**Estimate:** 8–12 engineering days  
**Dependencies:** BQC-1 through BQC-5 active paths stable  
**Unlocks:** release-candidate promotion and BQC-8 evidence

## 1. Outcome

A green gate means the tested behavior actually worked without uncaught runtime errors, hidden console failures, accidental provider calls, accessibility violations, or soft failures. Tests run from a clean clone with deterministic local dependencies and represent the real invite-only/dark-feature beta posture.

## 2. Findings owned

- STD-P1-05 — browser/component gates pass through errors.
- STD-P1-06 — architecture tests insufficient, together with BQC-5.
- STD-P2-06 — non-hermetic configuration and route/test hygiene.
- SPEC-P1-03 — shallow/blind experience evidence.
- Verification portion of every P0 finding.

## 3. Verification pyramid

| Level             | Purpose                                                    | Required adapter posture                               |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Pure domain       | Decision tables, invariants, time boundaries               | No I/O; explicit clock/IDs                             |
| Module contract   | Deep context interface behavior                            | In-memory only when a real second adapter exists       |
| PostgreSQL        | Transactions, schema, queries, tenancy, lifecycle          | Disposable migrated database                           |
| Redis/BullMQ      | Job semantics, retries, leases, redrive                    | Disposable Redis and real workers                      |
| Provider contract | Google/email behavior and mapping                          | Recorded/sandbox/fake adapter; no accidental live call |
| Component/browser | Rendering, interaction, accessibility, console cleanliness | Real browser                                           |
| Critical E2E      | Meaningful enabled workflow and dark denials               | Production composition with deterministic providers    |
| Staging smoke     | Deployed topology/config/provider sandbox                  | Approved staging identities only                       |

## 4. Slices

### BQC-6.1 — Hermetic test environment

- Create one validated test-environment builder for unit, integration, Storybook, and E2E.
- Supply deterministic Google/email/storage adapters by dependency injection.
- No bare test command requires real secrets or network.
- Refuse destructive tests against ordinary, shared, remote, or non-leased databases/Redis.
- Create, migrate, seed, and destroy isolated resources per suite/run.
- Remove implicit empty credential defaults that fail validation halfway through a run.

### BQC-6.2 — Fix client/runtime errors first

- Remove Node `crypto` from browser-reachable review code.
- Add global Playwright listeners for `pageerror`, unhandled rejection, failed critical network mutation, and unexpected `console.error`.
- Fail the test immediately with the original error and retain artifacts.
- Treat known benign console output through narrow, owned, expiring allowlists only.

### BQC-6.3 — One authoritative component/Storybook gate

Because the project is Vite-based, prefer Storybook's Vitest browser integration unless a measured compatibility issue justifies the legacy runner.

- Establish parity for render smoke, `play` assertions, and a11y.
- Make console errors fail.
- Fix `InboxDetailContent` pending-state/render errors, state-during-render warnings, circular story args, and CSS import ordering.
- Remove the redundant runner after parity; one authoritative result feeds release evidence.
- Add critical component stories for loading, empty, denied, error, stale/expired, long/translated/RTL, mobile, dark/light, reduced-motion, and keyboard states.

### BQC-6.4 — Correct Playwright diagnostics

- Choose retries intentionally; do not pair `retries: 0` with `trace: on-first-retry`.
- Prefer failure-retained trace/screenshot/video on the first failing run; use retries only for independently justified infrastructure instability.
- Upload artifacts for both critical and full failures.
- Exclude colocated tests from TanStack route generation via the supported prefix/pattern or move them out of `routes`.
- Make web-server logs finite and non-recursive so one client error does not flood CI output.

### BQC-6.5 — Critical enabled workflow suite

Each test must perform and verify a meaningful transition:

1. Invite-only authentication/session and forbidden public registration.
2. Operator-allowlisted property activation and wrong-property denial.
3. Google connection/import/sync through deterministic provider contract.
4. Review arrival → durable inbox projection within the defined SLO.
5. Inbox triage: status, assignment, note, escalation/resolve with persistence.
6. Manual reply draft/edit/approve/publish with success, transient failure, terminal rejection, and ambiguous reconciliation.
7. Disconnect/suspension immediately stops queued protected work.
8. Review expiry makes source content unavailable and removes copies.
9. Limited dashboard shows governed property data and no cross-property/raw-expired data.
10. In-app notification/activity show content-safe facts.

A Retry button or rendered shell is not success unless the scenario explicitly tests failure recovery and verifies the recovered state.

### BQC-6.6 — Dark-context negative suite

Directly navigate/call/enqueue/trigger Team, Portal, Guest, Goal, Badge, Leaderboard, outbound non-auth email, auto-publish, and AI paths. Verify no read, mutation, event effect, scheduled effect, upload, export, or external call occurs. Do not globally enable them for beta regression tests.

### BQC-6.7 — Residual full suite hardening

- Rewrite registration, invitation, reset, navigation, staff, and team expectations to match the declared beta posture.
- Use a fake mail outbox for identity mail and assert delivery intent/content classification without calling Resend.
- Convert intentionally dark positive tests to negative policy tests or move them to post-beta feature suites.
- Remove `continue-on-error` after the suite is deterministic and green.
- Full browser suite becomes required for release-candidate promotion.

### BQC-6.8 — Accessibility, responsive, theme, and performance

For enabled workflows verify:

- keyboard-only and focus order/visibility;
- screen-reader smoke and accessible names/errors/live regions;
- 200%/400% zoom and text reflow;
- mobile/tablet/desktop and touch target behavior;
- light/dark/high-contrast where supported;
- reduced motion;
- long names/reviews/translations, RTL, emoji, missing values, slow/error states;
- performance budgets for route payload, interaction latency, bundle/chunk size, and Core Web Vitals.

Wire the web-vitals module or remove it; do not keep a no-op control.

### BQC-6.9 — Coverage and test-quality gates

- Enforce master-plan domain/changed-code thresholds.
- Track project baseline and ratchet upward.
- Add mutation/property testing selectively for authorization, lifecycle, priority-independent review rules, and state machines.
- Detect skipped/focused tests, unasserted async failures, and tests that accept both success and generic error without checking expected outcome.
- Quarantine flaky tests only with owner, reproduction, expiry, and non-release status; no required workflow may remain quarantined.

## 5. CI policy

- Critical and full E2E, authoritative component tests, a11y, and production builds are hard gates.
- Required evidence jobs have no `continue-on-error`.
- A test failure caused by environment setup is still a failure; its artifacts must make the cause visible.
- CI configuration uses the same capability manifest as beta except explicit test identities/providers.
- Test-only capabilities cannot leak into the built production artifact/configuration.

## 6. Evidence

- Clean-clone command transcript and environment manifest.
- Deliberate error-injection proof for browser console/pageerror/network/a11y gates.
- Component-runner parity and legacy-runner removal decision.
- Critical workflow and dark-context matrices.
- Full E2E green run with artifacts.
- Accessibility/responsive/theme/performance report.
- Coverage, mutation sample, skip/flaky register.

## 7. Exit matrix

| Criterion                                                            | Required result |
| -------------------------------------------------------------------- | --------------- |
| Bare documented unit/integration/component/E2E commands are hermetic | Pass            |
| Uncaught browser/console/network errors fail required tests          | Pass            |
| One authoritative component/a11y runner is hard-gated                | Pass            |
| Playwright failure artifacts work with configured retries            | Pass            |
| Critical tests verify meaningful enabled transitions                 | Pass            |
| Every dark context has blocking negative evidence                    | Pass            |
| Full E2E is hard and green for beta posture                          | Pass            |
| Accessibility/responsive/theme/performance budgets pass              | Pass            |
| Coverage and flaky-test policy is enforced                           | Pass            |

## 8. Out of scope

- Positive product tests for dark contexts.
- Cross-browser exhaustive matrix on every PR; use critical smoke per supported browser and fuller scheduled/release coverage.
- Visual redesign unrelated to an acceptance defect.
