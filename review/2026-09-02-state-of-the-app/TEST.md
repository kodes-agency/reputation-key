# Tests and executable evidence — state of the app, 2026-09-02

## Verdict

The most consequential fact is that the release-labelled “deployed critical journeys” are six anonymous, read-only probes; they never authenticate, import a Google review, publish a reply, submit private feedback, or evaluate a goal on the deployed cell. The local suite is much stronger: real-PostgreSQL transaction/concurrency tests, real-Redis tests, domain matrices, 555 Storybook stories, and provider-stub E2E journeys represent a material improvement over the pre-rewrite estate. However, none of the three central loops is joined in one executable proof: Google import stops before reply, public feedback stops before manager handling, and goal browser tests stop before real metric facts and availability semantics. The live review branch is also red: 1 of 12,712 unit cases fails because a historical-oracle JSON file pins an English test title renamed by the CI split, so `check:coverage` produces no current coverage result. The quality gate now covers all executable TypeScript roots and the overall coverage ratchet now has a ceiling, fixing major pre-rewrite scope holes, but neither gate distinguishes observable behavior from source-shape or mock-plumbing assertions. Twenty-seven of 34 sampled real-Redis test declarations can return successfully without an assertion when Redis is unavailable, and PR retries may still turn a first-attempt Playwright failure green. At one tenant and six Properties, 335,888 lines of tests/stories plus a 31–42 minute push loop are disproportionate while the deployed and cross-context proofs that matter most remain absent. The rewrite therefore achieved strong component and seam evidence, but not the plan’s claimed end-to-end or deployed confidence.

## Scorecard

| Planned outcome (cite the package/§)                                                                                                                       | Current reality                                                                                                                                                                                                                                                                                                                                                          | Verdict     | Severity |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------- |
| Pure domain changes have table-driven boundary and invalid-transition proof (§4.2, `docs/comprehensive-beta-implementation-program-2026-08-25.md:140-150`) | 129 domain test files / 21,500 lines / 1,415 static declarations; the runtime-collected domain sample expanded to 2,007 cases. Tier 1 enforces 100% on glob-discovered pure rule files with no exemptions (`scripts/check-coverage.mjs:11-30,103-140,214-223`).                                                                                                          | GOOD        | —        |
| Repository/schema changes use real PostgreSQL, tenant-negative, rollback, and concurrent-writer tests (§4.2)                                               | The integration project selects repository and `.integration` tests, runs serially against migrated PostgreSQL (`vitest.config.ts:123-149`); sampled AI, Portal, Inbox, Review, Identity, Goal, Metric, Activity, Property, Staff, and Team repositories exercise real constraints and races.                                                                            | GOOD        | —        |
| Redis/queue/lease proof covers expiry, stale leadership, retry, duplicate delivery, replay (§4.2; SAFE-04 done)                                            | 16 Redis-bearing test files / 4,012 lines / 34 static declarations exist, including genuine multi-client lease/backoff checks (`google-refresh-coordination.adapter.integration.test.ts:25-178`). At least 27 declarations early-return if Redis is unavailable; the lease explicitly converts connection failure into `available:false` (`redis-test-lease.ts:70-108`). | IMPROVE     | medium   |
| Public endpoints have request-level policy tests plus browser journeys (§4.2)                                                                              | 59 request/server test files / 9,592 lines / 516 static declarations (587 collected cases) plus 72 critical browser cases. Many request tests mock the container, and no endpoint-to-journey manifest proves every active mutation has both halves.                                                                                                                      | IMPROVE     | medium   |
| Provider side effects prove ambiguity, reconciliation, and no unsafe retry (§4.2; RPL-01)                                                                  | `reply-lifecycle.spec.ts` drives server functions → BullMQ → provider stub → provider observation for success, transient failure, terminal rejection, and ambiguity (`e2e/critical/workflows/reply-lifecycle.spec.ts:1-16,194-267`).                                                                                                                                     | ACHIEVED    | —        |
| Projection proof includes duplicate/out-of-order, correction, rebuild, freshness, completeness, and parity (§4.2; IBX-01)                                  | Strong repository and cutover tests exist, but browser journeys use direct source/projection seeds and the three cross-context loops are not joined.                                                                                                                                                                                                                     | SUBSTANTIAL | medium   |
| UI states include success/error/empty/stale/conflict and keyboard behavior (§4.2)                                                                          | 95 story files export 555 stories; 361 explicit `play` declarations in 84 files. Every story gets render, console, and axe enforcement in the authoritative runner (`.storybook/test-runner.ts:1-12`; `.storybook/preview.tsx:77-93`), with targeted E2E stale-conflict coverage (`e2e/critical/workflows/inbox-handling-cycle.spec.ts:385-446`).                        | GOOD        | —        |
| FND-04’s high-risk focused regressions become permanent oracles (`docs/comprehensive-beta-implementation-program-2026-08-25.md:286-310`)                   | Focused tests now cover foreign tenancy, ambiguous provider outcomes, routing failure, lifecycle preservation, artifact containment, and other named seams. The immutable-oracle wrapper is brittle enough to block a behavior-preserving CI refactor, however.                                                                                                          | IMPROVE     | medium   |
| SAFE-05 completes a clean current coverage report without a global-100% claim (`docs/comprehensive-beta-implementation-program-2026-08-25.md:414-429`)     | Main’s preceding SHA completed coverage, and the ratchet is materially better. On reviewed HEAD `3f76a99c`, 12,706 unit cases pass, 5 skip, 1 source-marker oracle fails, and coverage aborts before producing a summary.                                                                                                                                                | IMPROVE     | medium   |
| Release evidence includes deployed critical journeys (§4.2; §5.2 edge 12)                                                                                  | The deployed project has six GET/render/refusal probes and is deliberately unauthenticated/read-only (`e2e/deployed/closed-beta-critical-journeys.spec.ts:1-19,77-120`). It is not a product critical journey.                                                                                                                                                           | SUBSTANTIAL | high     |
| No goals activation before Metric governance/availability parity (§5.2 edge 7; MET-01/GOA-01)                                                              | Metric and Goal each have strong isolated unit/DB tests, while browser evidence creates/lists/ends a goal but supplies no real rating/scan facts and asserts no `updating`/`insufficient`/`data through` transition (`e2e/critical/beta-product-journeys.spec.ts:503-640`).                                                                                              | SUBSTANTIAL | medium   |

## What was achieved

### TEST-A1 The pre-rewrite quality-gate scope holes were actually closed

**Evidence.** The old review found services, stories, `skipIf`/`runIf`, chained `.only`, and 146 runtime-fenced language cases outside or invisible to the gate (`/Users/bozhidardenev/tmp/rep-key-test-review-2026-08-21.md:124-163,504-535`). The current scanner covers `src`, `services`, `e2e`, `scripts`, `server`, `.railway`, and `.storybook`, including stories (`scripts/check-test-quality.mjs:5-14,184-206`), detects chained focus/conditional absence/specific failure mistakes (`:208-255`), audits stale registrations (`:258-277`), and fails runtime drift unless explicitly acknowledged (`:279-311`). A read-only run on this Node 26 workstation produced:

```text
[test-quality] NOTE — 5 runtime-fenced file(s) (~146 tests) do NOT run on this runtime
[test-quality] scanned 1662 test/spec/story files ... 95 *.stories.tsx
[test-quality] OK — no focused tests, no unregistered skips/fences, no generic-error acceptance, no unasserted async failures
```

The command required the explicit `ALLOW_RUNTIME_DRIFT=1`; `.nvmrc:1` and `package.json:6-8` pin Node 22.23.2 for authoritative execution.

**Why it matters.** This closes the exact excluded-region pattern that produced false greens before the rewrite.

**Recommendation.** Keep the widened roots and fail-closed runtime fence unchanged.

**Cost/risk of the fix.** Already paid; regression risk is low and guarded by the scanner’s own tests.

### TEST-A2 Coverage moved from a decorative stale floor to a two-arm ratchet

**Evidence.** The pre-rewrite consolidated review reported roughly 54% and only 1,018/1,661 directly associated production modules (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:183-192`); the dedicated review measured 5.83 percentage points of line slack and requested a max-drift assertion (`rep-key-test-review-2026-08-21.md:615-635`). The current gate includes untouched `src/**/*.{ts,tsx}` (`vitest.config.ts:54-74`), pins the 2026-08-29 unit measurement at 59.79% lines / 52.42% branches / 53.66% functions / 58.68% statements, and enforces floors plus 2.5pp overall / 1pp domain staleness ceilings (`scripts/check-coverage.mjs:32-93,142-171`).

**Why it matters.** Coverage regression and stale-baseline drift are now independently detectable; the plan explicitly rejected a global-100% claim.

**Recommendation.** Preserve the two-arm design, but implement TEST-I3 before treating the number as suite-wide confidence.

**Cost/risk of the fix.** Already paid; re-pinning remains an intentional review event.

### TEST-A3 Strictly duplicated browser journeys were removed and component interactions restored

**Evidence.** The pre-rewrite review named `property-crud`, `property-detail`, and `member-invitation` as strict duplicates and `team-management` as foldable (`/Users/bozhidardenev/tmp/rep-key-test-review-2026-08-21.md:439-471`); none exists in the current `e2e/**/*.spec.ts` tree. It also recorded the restoration of deleted Storybook plays (`/Users/bozhidardenev/tmp/rep-key-test-review-2026-08-21.md:121-135`). Current census finds 361 plays across 84 of 95 story files, including rating/feedback interactions (`src/components/features/guest/public-portal/guest-response-form.stories.tsx:108-128`) and the restored Link Tree interactions.

**Why it matters.** The rewrite did delete known duplicate weight rather than only adding new gates.

**Recommendation.** Continue the same evidence-preserving deletion standard in TEST-S4.

**Cost/risk of the fix.** Already paid; low risk because stronger owners remain.

## What is genuinely good

### TEST-G1 Real database tests protect the dangerous invariants

**Evidence.** Examples include: competing Organization closure lineage plus tenant denial (`src/contexts/identity/infrastructure/organization-lifecycle-command-store.integration.test.ts:165-309`); Property lifecycle fact rollback and wrong-cell refusal (`src/contexts/property/infrastructure/property-lifecycle-command-store.integration.test.ts:114-190`); Goal one-winner concurrent close and outbox rollback (`src/contexts/goal/infrastructure/repositories/goal-program-result-atomicity.test.ts:138,365`); operational-history sequence allocation, concurrent append, keyset access, hold, and redaction (`src/contexts/activity/infrastructure/operational-action-history-store.integration.test.ts:135-614`); and Staff responsibility interval/tenant guarantees (`src/contexts/staff/infrastructure/repositories/staff-participation.repository.test.ts:140-349`). The integration project is a distinct, migrated, single-worker PostgreSQL project (`vitest.config.ts:123-149`).

**Why it matters.** These tests exercise constraints and transactions that mocks cannot model; they are the strongest answer to the old tenant-predicate and atomicity findings.

**Recommendation.** Keep these suites even when pruning mock twins. Require every mock-store case proposed for retention to name the behavior not already held by the real-DB suite or a domain test.

**Cost/risk of the fix.** No fix needed. Their serial runtime is real but justified by shared-database isolation.

### TEST-G2 Domain and availability semantics are precise

**Evidence.** `src/contexts/metric/application/use-cases/query-goal-metric.test.ts:148-286` distinguishes verified zero, updating, pending receipts, insufficient samples, quarantined sources, governed Qualified Scan reads, invalid periods, and cross-Property subjects. Goal tests keep results reconciling until source completeness reaches period end and close verified zero without coercion (`src/contexts/goal/application/use-cases/goal-programs.test.ts:1272-1423`). The real Metric repository separately tests consumer permissions, minimum sample, correction lineage, ambiguous legacy exclusion, half-open periods, weighted averages, and retractions (`src/contexts/metric/infrastructure/repositories/metric.repository.test.ts:128-278`).

**Why it matters.** This directly protects the fixed §3.6 rule that missing or incomplete data is never displayed as zero.

**Recommendation.** Keep the unit/DB split; add only the missing joined fact-to-surface proof in TEST-S2.

**Cost/risk of the fix.** No redesign needed; the missing seam is bounded.

### TEST-G3 The reply publication saga is unusually strong

**Evidence.** The four E2E scenarios traverse real server functions, BullMQ, provider fixture behavior, durable state, read-back reconciliation, and UI (`e2e/critical/workflows/reply-lifecycle.spec.ts:1-16`). The happy path explicitly waits for a provider attempt, triggers the same review sync used in production, waits for the durable consumer to close Inbox work, renders “Confirmed on Google,” and proves one provider PUT with final content (`e2e/critical/workflows/reply-lifecycle.spec.ts:194-267`). The 500 retry, terminal 403, and ambiguous-success branches follow in the same file (`e2e/critical/workflows/reply-lifecycle.spec.ts:270-526`).

**Why it matters.** It proves the plan’s highest-risk external-side-effect semantics: write acceptance is not publication truth and ambiguity is reconciled before resend.

**Recommendation.** Protect this as the canonical publication owner; do not duplicate it in Inbox lifecycle tests.

**Cost/risk of the fix.** No fix needed; provider-stub drift remains governed separately.

### TEST-G4 Storybook’s runner is a real component gate, not a screenshot catalogue

**Evidence.** CI’s authoritative legacy runner applies render, play, axe, and console checks (`.storybook/main.ts:3-21`; `.storybook/test-runner.ts:1-12`), has exactly one story-scoped deliberate console suppression (`test-runner.ts:34-52`), creates a fresh QueryClient per story (`preview.tsx:13-32`), and defines explicit mobile/tablet/desktop viewports (`:59-75`). Current census: 95 files, 555 exported stories, 361 explicit plays; the 194 without plays still receive render/console/a11y checks.

**Why it matters.** It catches state, accessibility, and boundary-error regressions cheaply before full E2E.

**Recommendation.** Keep one authoritative runner. Update the stale “74 files / 379 tests” prose in `.storybook/main.ts:4` to generated/current counts or remove the number.

**Cost/risk of the fix.** Minutes; no behavioral risk.

### TEST-G5 Stratified test-body review: strong invariants, uneven user observability

The following is a manual classification of static declarations after reading names, setup, bodies, and assertions; `it.each` expansions mean declaration count is smaller than runtime case count. “Observable” means a public use-case/request/UI outcome; “Invariant” means domain/persistence/tenant/concurrency behavior; “Plumbing” means mock call order, exports, source text, catalogue shape, or harness self-tests. Percentages are reviewer-coded, not coverage output.

| Context / stratum                    | Representative files read                                                     | Static declarations / lines sampled | Observable | Invariant | Plumbing |
| ------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------: | ---------: | --------: | -------: |
| Integration                          | Google import processor; real-Redis refresh coordination                      |                          23 / 1,112 |        25% |       65% |      10% |
| Review                               | publication workflow; reply operations; mock + real command stores; reply E2E |                         117 / 3,286 |        10% |       70% |      20% |
| Inbox                                | mock + real command stores; handling-cycle E2E                                |                          73 / 4,846 |         5% |       60% |      35% |
| Identity                             | lifecycle use case + real command store                                       |                            19 / 766 |        20% |       75% |       5% |
| Portal                               | real command store + GuestResponseForm stories + public E2E                   |                          46 / 3,276 |        43% |       55% |       2% |
| AI                                   | real operation store + reply-suggestion use case                              |                          30 / 4,219 |        30% |       65% |       5% |
| Notification                         | handling-cycle consumer + Redis/PG delivery bridge                            |                             9 / 578 |        15% |       70% |      15% |
| Goal                                 | Goal service + domain model + real result atomicity                           |                          44 / 2,199 |        10% |       85% |       5% |
| Guest                                | integrity domain + lifecycle + server + story + E2E                           |                          95 / 2,586 |        30% |       60% |      10% |
| Property                             | lifecycle and command-store PostgreSQL suites                                 |                             8 / 480 |         0% |      100% |       0% |
| Metric                               | Goal query + aggregate + source-status DB suites                              |                            17 / 953 |        20% |       80% |       0% |
| Activity                             | action-history DB + recent-activity query                                     |                            17 / 913 |        35% |       65% |       0% |
| Dashboard                            | setup-checklist use case + DB repository                                      |                             8 / 441 |        60% |       40% |       0% |
| Staff                                | participation DB + server boundary                                            |                             9 / 517 |        33% |       57% |      10% |
| Team (quarantined migration context) | membership + People reconciliation DB                                         |                            13 / 700 |         0% |       90% |      10% |
| Shared governance/test harness       | entry catalogue; scenario executor; E2E error detector                        |                          79 / 2,730 |         0% |       20% |      80% |

**Why it matters.** The product contexts generally contain serious boundary tests; the weakest concentration is shared governance/harness and the mock twin of Inbox persistence. That is where subtraction should begin—not in real-DB or domain suites.

**Recommendation.** Require future test reviews to tag the observable contract owner and delete lower-layer twins that protect neither a unique failure nor a cheaper diagnostic.

**Cost/risk of the fix.** Manual triage is 1–2 days; deletion should land in small batches with the retained owner named.

## What should be improved

### TEST-I1 A historical evidence wrapper currently blocks coverage on an English test title

**Evidence.** The oracle index requires the literal string `runs the same coverage ratchet before merge and on main without a second unit run` (`docs/release-evidence/review/pre-fix-oracle-index-2026-08-26.json:855-868`). The validator reads current files and uses `content.indexOf(marker)` (`scripts/review/pre-fix-oracles.ts:263-285,461-479`). Commit `3f76a99c` legitimately renamed/reworked that test to `runs the unit ratchet and integration exactly once each, unconditionally` while preserving and strengthening the invariant (`src/shared/governance/gate-wiring.test.ts:82-112`). GitHub run `33682407475` on the reviewed HEAD reported 1 failed / 12,706 passed / 5 skipped and aborted coverage; the same suite passed on main SHA `1425966f` before the rename.

**Why it matters.** This is the pre-rewrite false-confidence failure mode in miniature: an evidence artefact, not application behavior, breaks the delivery gate and suppresses the actual coverage signal.

**Recommendation.** Delete current test-title strings from `currentRegressionProofs`. Give executable proofs stable IDs exported by the test/gate module, or assert the CI command multiplicity directly in one current gate test; historical artefact digests should stay immutable, but current proof locators must not be immutable prose.

**Cost/risk of the fix.** Hours. Risk is losing the link from historical finding to current proof; retain that link by stable machine ID, not source wording.

### TEST-I2 Real-Redis cases may pass without touching Redis

**Evidence.** `acquireRedisTestLease` explicitly turns unavailable local Redis into `{available:false}` (`src/shared/testing/redis-test-lease.ts:70-108`). A static census found 16 Redis-bearing files / 34 declarations; 27 declarations contain an early success-return, e.g. all three refresh coordination cases (`google-refresh-coordination.adapter.integration.test.ts:25-26,81-82,131-132`), notification delivery (`notification-delivery-bridge.integration.test.ts:105-106`), rate limiting, routing faults, durable cutover, and quarantine operations. These control-flow skips do not appear in the test-quality skip register or Vitest’s skipped count.

**Why it matters.** CI currently provisions Redis, so normal hosted execution should be real; nevertheless, the test result itself contains no assertion that the required dependency was reached. A service/env regression can convert 27 “real Redis” proofs into green no-ops—the exact minimum proof §4.2 forbids.

**Recommendation.** Add `REQUIRE_TEST_REDIS=1` in the integration CI job and make lease acquisition throw when required. Locally, use `describe.skipIf` with a registered, visibly skipped suite rather than returning from test bodies. Emit one run-level Redis proof receipt/count.

**Cost/risk of the fix.** Under one day. Local developers without Redis see honest skips; CI becomes more fail-closed.

### TEST-I3 The coverage number excludes the integration evidence that carries the largest risks

**Evidence.** Coverage invokes only `vitest run --project=unit` (`scripts/check-coverage.mjs:1-9,182-199`), while the 240 integration-selected files / 96,198 lines run separately (`vitest.config.ts:123-149`). The last completed snapshot is only a unit-execution view: 59.79% lines and 52.42% branches (`check-coverage.mjs:34-40`). Its permitted overall staleness band is 2.5pp—about 1,120 executable lines by the script’s own calculation (`:76-93`).

**Why it matters.** A repository may be excellently exercised against PostgreSQL while the coverage report still calls those lines uncovered; conversely, a mock-heavy unit suite can hold the aggregate while a real-DB path stops executing. The number cannot answer “is the complete suite exercising production code?”

**Recommendation.** Merge unit and integration V8 coverage into one report, retaining the fast unit floor as a separate diagnostic. Add per-context/boundary budgets only for active, high-consequence code; do not raise a global percentage for optics.

**Cost/risk of the fix.** 1–2 days plus a larger coverage artifact; likely no extra test execution because both projects already run. Baselines will change once and need an explicit re-pin.

### TEST-I4 A flaky first attempt can still be green on a pull request

**Evidence.** Playwright uses one CI retry (`playwright.config.ts:8-27,67-68`). CI appends `--fail-on-flaky-tests` only on `push`, not on `pull_request`, for critical, full, and compatibility runs (`.github/workflows/ci.yml:887-926` in the reviewed branch). The program says “Flaky retries do not turn a failing gate green” (`comprehensive-beta-implementation-program-2026-08-25.md:154`).

**Why it matters.** A PR can merge after a first-attempt failure even though the plan requires that failure to remain gating; main discovers it only after merge.

**Recommendation.** Pass `--fail-on-flaky-tests` on PR and push. Keep one retry solely to produce classification/diagnostics.

**Cost/risk of the fix.** One line per invocation. It will expose existing flakes and may initially slow merges, which is the intended signal.

### TEST-I5 Unit setup costs as much as or more than test execution

**Evidence.** On reviewed HEAD, three measured `check:coverage` attempts took 267–360 seconds. Vitest attributed 213–333 seconds to setup versus 145–290 seconds to tests; run `33682407475` specifically reported 227.11s setup and 140.67s tests. Every one of 1,302 unit files loads `src/test-setup.ts` through a four-fork pool (`vitest.config.ts:81-115`); that setup imports permissions/config and clears 23 environment keys at module load, `beforeAll`, and every `beforeEach` (`src/test-setup.ts:1-53`). A static census found 317 test files with at most two declarations (26,502 lines) and 505 with at most three (48,381 lines) across executable roots.

**Why it matters.** The feedback loop is dominated by harness/file overhead, not business assertions. Splitting CI jobs reduces wall clock but not compute or local latency.

**Recommendation.** First benchmark moving environment reset behind an opt-in helper used only by env-mutating suites and initialize the permission table once per worker. Then benchmark threads versus forks on the same case count. Do not disable isolation globally; require shuffle/repeat proof before accepting the faster configuration. Consolidate only source-shape/harness tests that share one artifact, preserving the repository’s source-mirroring convention for product tests.

**Cost/risk of the fix.** 2–4 days including three repeated benchmarks. Main risk is process-env leakage/order coupling; a measured shuffle gate is required.

### TEST-I6 The quality gate checks syntax smells, not assertion meaning

**Evidence.** Its complete body rules are focused tests, skip/fence registration, bare throws, and unasserted `.rejects` (`scripts/check-test-quality.mjs:208-255`); success explicitly claims only those four outcomes (`scripts/check-test-quality.mjs:326-341`). It does not require production invocation, assertion presence, observable outcome, or mutation sensitivity. Existing low-signal examples pass: `typeof export === 'function'` (`src/contexts/goal/application/public-api.test.ts:12-18`), a source substring for Google navigation (`src/components/features/guest/public-portal/guest-response-form.test.ts:4-13`), and a component’s shadcn `data-slot` (`src/components/features/guest/public-portal/guest-response-form.stories.tsx:101-106`).

**Why it matters.** More files/cases can satisfy governance without increasing product confidence.

**Recommendation.** Do not add a naive assertion-count regex. Extend changed-code review to require a named observable contract or registered shape-test category, and run small mutation samples on high-risk diffs. Delete the concrete low-signal cases in TEST-S4.

**Cost/risk of the fix.** 1–2 days for classification; mutation cost should be changed-code-only. A simplistic global rule would incentivize meaningless `expect` calls and is worse than no rule.

## What needs substantial change

### TEST-S1 “Deployed critical journeys” must become deployed product journeys

**Evidence.** The spec states that it is read-only, unauthenticated, creates nothing, and issues only GETs (`e2e/deployed/closed-beta-critical-journeys.spec.ts:1-19`). Its six tests cover liveness, readiness, dark metrics, landing render, sign-in render without signing in, and an unknown Portal refusal (`e2e/deployed/closed-beta-critical-journeys.spec.ts:77-120`). The release runner has 729 lines of authorization, digest, content-safety, report, and evidence binding around that suite (`scripts/release/run-deployed-critical-journeys.ts:1-29,67-125,197-240`), but the actual suite never uses its authorized synthetic Organization to prove a business operation.

**Why it matters.** §4.2 and Gate F require deployed critical journeys, not deployment health. Local provider stubs and Compose cannot prove that deployed web, worker, queues, database, policy, and sidecars form the running product. This is the clearest surviving instance of governance weight exceeding the evidence it wraps.

**Recommendation.** Keep the six probes as `deployed-smoke`. Replace the “critical journey” evidence with an operator-authorized synthetic tenant that performs and cleans up: authenticated Property/Google connection read, one provider-safe import/read path, one Portal rating/private-feedback-to-Inbox path, and one reply dry-run or authorized non-customer canary with reconciliation. If production mutation is not authorized, rename the Gate F evidence honestly and leave release closure blocked rather than calling smoke “critical journeys.”

**Cost/risk of the fix.** 1–2 weeks. Primary risks are production synthetic residue and provider side effects; use run-scoped IDs, explicit authorization, kill switches, cleanup receipts, and the existing content scanner.

### TEST-S2 Join the three core loops instead of proving adjacent halves with seeders

**Evidence.** (1) Google import E2E drives discovery/import/review sync/Inbox projection and ends on the Reviews UI (`e2e/critical/workflows/google-import-sync.spec.ts:1-4,82-108,401-429`); reply E2E starts by directly `seedReview` plus `seedReviewInboxItemWithCycle` (`e2e/critical/workflows/reply-lifecycle.spec.ts:97-132`). (2) Public Portal E2E submits rating/feedback/correction/withdrawal and ends on the guest receipt (`e2e/critical/guest-portal.spec.ts:92-147`); manager handling starts with `seedPrivateFeedbackInboxItem` (`e2e/critical/workflows/inbox-handling-cycle.spec.ts:236-258`). (3) Goal availability is strong behind faked Metric ports (`src/contexts/metric/application/use-cases/query-goal-metric.test.ts:94-135`; `src/contexts/goal/application/use-cases/goal-programs.test.ts:1272-1423`), while browser tests only create/display/end programs (`e2e/critical/beta-product-journeys.spec.ts:503-640`).

**Why it matters.** The untested seams are exactly where durable consumers, tenant attribution, projections, and freshness authority cross contexts. Every component can be green while the user loop is broken. IBX-01’s done clause explicitly asks for source-to-handling E2E and parity/replay (`docs/comprehensive-beta-implementation-program-2026-08-25.md:687-705`); Goal activation explicitly waits for Metric parity (`docs/comprehensive-beta-implementation-program-2026-08-25.md:215`).

**Recommendation.** Add three tracer tests, not more layer tests: `provider review → durable sync → Inbox → draft/publish → provider observation → closed`; `public rating+feedback → projection → manager handles → guest withdrawal/reopen invariants`; `guest fact → Metric receipt/projection → Goal result → UI availability/closure`. Reuse existing helpers but prohibit direct seeding beyond tenant/connection/Portal setup after the source event.

**Cost/risk of the fix.** 1–2 weeks total. These will initially expose asynchronous timing and cleanup defects; keep one canonical owner per loop and delete overlapping seeded E2E assertions afterward.

### TEST-S3 Remove the “wait until the user can click safely” workaround

**Evidence.** `waitForInboxItemSettled` polls `command_revision` for a six-second quiet window and can wait 45 seconds (`e2e/helpers/fixtures.ts:168-233`). Its comment records that an ordinary interaction otherwise hits `revision_conflict` as an unhandled page error in roughly 50% of local runs (`e2e/helpers/fixtures.ts:177-197`). `e2e/critical/workflows/activity-notification-facts.spec.ts:159,182` calls it before ordinary reopen and note actions. A separate two-tab stale-client test correctly expects a visible conflict (`e2e/critical/workflows/inbox-handling-cycle.spec.ts:385-446`), but it does not make the ordinary background-projection race safe.

**Why it matters.** IBX-01 requires the UI to report conflict/current state rather than overwrite or throw (`docs/comprehensive-beta-implementation-program-2026-08-25.md:695`). Synchronizing the test around a five-second relay hides a reachable user failure and makes E2E slower; it does not fix the source.

**Recommendation.** Delete `waitForInboxItemSettled`. Make projection-only convergence either preserve the command revision when command-relevant state is unchanged, or make every affected mutation catch conflict, refresh, and present the current state. Add the unsynchronized interaction as the regression test.

**Cost/risk of the fix.** 2–4 days. Changing revision semantics is high risk; prefer a bounded UI conflict/reload repair unless domain analysis proves the projection bump is spurious.

### TEST-S4 Prune mock/harness duplication and spend the saved budget on S1–S3

**Evidence.** The four largest suites alone are 10,539 lines for 112 static declarations: AI operation store 3,572/17, Portal command store 2,604/26, mock Inbox command store 2,413/46, real Inbox command store 1,950/23. Real DB AI/Portal/Inbox tests are expensive but high-value; the mock twins and harness self-tests carry the subtraction opportunity. Ten lowest-signal sampled tests are:

1. Oracle index exact English test-title marker (`docs/release-evidence/review/pre-fix-oracle-index-2026-08-26.json:855-862`)—currently red.
2. Goal “exports goalCompleted factory” (`src/contexts/goal/application/public-api.test.ts:12-14`).
3. Goal “exports deriveEntityScope helper” (`src/contexts/goal/application/public-api.test.ts:16-18`).
4. Goal event test checks only `_tag` (`src/contexts/goal/application/public-api.test.ts:20-38`).
5. Guest navigation reads source text and looks for one substring (`src/components/features/guest/public-portal/guest-response-form.test.ts:4-13`).
6. Catalogue “observable reachability” asserts catalogue literals plus `registry.getAll()` source text, not execution (`src/shared/governance/entry-point-catalogue.test.ts:1132-1149`).
7. Catalogue stale-row proof checks only file existence (`src/shared/governance/entry-point-catalogue.test.ts:1158-1164`).
8. Catalogue route coverage compares source discovery to catalogue rows, not route execution (`src/shared/governance/entry-point-catalogue.test.ts:1224-1247`).
9. `RatingFirst` asserts the button’s internal `data-slot`, not rating-first behavior (`src/components/features/guest/public-portal/guest-response-form.stories.tsx:101-106`).
10. Four sequential Inbox-store tests exercise a test helper’s in-memory call order/duplicate behavior inside a production infrastructure suite (`src/contexts/inbox/infrastructure/inbox-command-store.test.ts:2264-2413`).

Concrete reduction list (targets, not blind deletions):

| Change                                                                                                                                                                 |    Gross lines removed/rewritten | Retained owner                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------: | --------------------------------------------------------------------------------------------------------------------------------- |
| Delete the two `typeof` Goal export tests and fold the tag-only case into the domain event suite                                                                       |                               28 | constructor invalid-number test plus domain event tests                                                                           |
| Replace the source-substring Guest navigation test with the existing interactive Story/E2E destination checks                                                          |                               13 | `src/components/features/guest/public-portal/guest-response-form.stories.tsx:118-128`; `e2e/critical/guest-portal.spec.ts:98-112` |
| Remove the `data-slot` play while retaining the rendered/a11y story                                                                                                    |                                5 | Storybook render + rating-first E2E                                                                                               |
| Move/delete four direct tests of `createSequentialInboxCommandStore` from the atomic production-store suite                                                            |                              150 | application use-case tests that consume the helper; real command-store suite                                                      |
| Prune mock `src/contexts/review/infrastructure/reply-command-store.test.ts` from 1,619 lines/40 declarations to mock-only post-commit/fault seams (~10 declarations)   |                      target ~950 | 65 domain workflow declarations + 8 real-DB cases + 4 E2E cases                                                                   |
| Prune mock `inbox-command-store.test.ts` happy-path persistence duplicates; retain schema-minimization and post-commit ordering cases                                  | target ~900 beyond the 150 above | 23 real-DB command-store cases + use-case/E2E owners                                                                              |
| Collapse `e2e/error-detection.spec.ts` 404 lines/18 browser cases to one browser canary per signal plus the real-gate canary; move pure expiry/metadata tables to unit |                      target ~230 | 6 browser canaries + unit policy table                                                                                            |
| Table-drive 65 micro-cases in `src/contexts/review/domain/reply-publication-workflow.test.ts` (415 lines)                                                              |                   target 150–200 | same full transition matrix                                                                                                       |

Conservative target: remove or collapse roughly 2,400–2,500 lines without deleting a real-DB, provider, user-journey, or unique failure contract.

**Why it matters.** The estate is already near parity with production LOC; adding more seam tests without subtraction will make feedback slower while preserving the core-loop gaps.

**Recommendation.** Land each reduction with an explicit retained owner and run only the affected suites plus mutation samples for tenant/revision predicates. Redirect saved CI/review budget to S1–S3.

**Cost/risk of the fix.** 3–5 days. The risk is deleting a unique diagnostic hidden in a mock suite; mitigate by mapping each removed case to a named retained owner before deletion.

## Proportionality ledger

| Machinery                   |                                                                                                                                                                                                                                                 Measured price | What it buys for 1 tenant / 6 Properties                      | Judgment                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src` tests + stories       |                                                                                                                                     1,452 test files / 320,892 lines plus 95 story files / 14,996 lines = 335,888 lines, 88.3% of 380,495 non-test `src` lines | Broad local contracts and component states                    | Too much total weight while deployed/core-loop proofs are absent; prune, do not broadly add                                                            |
| Test-support implementation |                                                                                                                                                           `src/shared/testing`: 75 non-test TS/TSX files / 13,153 lines; its own tests: 34 files / 6,158 lines | DB/Redis leases, fakes, load/fault scenarios, E2E environment | Some is load-bearing, but this is a subsystem and must be budgeted like one                                                                            |
| E2E                         |                                                             25 specs / 6,472 lines; helpers+fixtures alone ≈5,486 lines; project listing: 72 critical product executions, 26 full (20 are error-harness cases), 20 compatibility executions, 6 deployed probes | Strong local browser and provider-stub confidence             | Support-to-spec ratio and harness cases are high; deployed depth is low                                                                                |
| Storybook                   |                                                                                                                                                                                                                   555 stories, 361 plays, 194 render/a11y-only | Excellent state/a11y coverage                                 | Proportionate and fast; keep, remove only internal-detail plays                                                                                        |
| Redis                       |                                                                                                                                                                                                       16 files / 34 declarations; 27 can pass via early return | Critical leases/rate limits/replay                            | Small count is acceptable if execution is fail-closed; today it is not self-attesting                                                                  |
| Coverage                    |                                                                                                                                                     Last complete unit snapshot 59.79% lines; up to 2.5pp / ~1,120 lines headroom; no integration contribution | Regression trend, pure-rule 100%                              | Honest but not complete-suite coverage; current HEAD has no result                                                                                     |
| Unit runtime                |                                                                                                                                                                       1,302 files / 12,712 cases; 267–360s wall measured; setup 213–333s versus tests 145–290s | Fast-ish broad logic feedback                                 | Per-file/setup architecture is now a first-order tax                                                                                                   |
| Push CI                     | `gh run view 33682407475 --json jobs`: reviewed branch E2E passed in 11m53s, integration in 5m24s, static in 6m00s; unit failed in 4m53s and beta acceptance was skipped. Comparison main run `33675157116` had ≈32m28s wall including 13m21s beta acceptance. | Full local/container/release confidence                       | Split lowers the pre-beta critical path, but current end-to-end wall and closure remain unproven until the prose-oracle failure is fixed and beta runs |
| Deployed evidence wrapper   |                                                                                                                                                                                                              729-line runner around a 118-line, six-probe spec | Digest/authorization/content-safe evidence packaging          | Governance-to-product-proof ratio is inverted                                                                                                          |

## Unverified / needs a runtime check

- **Current coverage percentage:** unavailable by construction. Reviewed HEAD’s one oracle failure makes `check:coverage` abort before `coverage-summary.json`; rerun after TEST-I1 under Node 22.23.2.
- **Actual deployed business loop:** [UNVERIFIED]. I did not run production journeys, per review constraints. A safe synthetic-tenant or authorized non-customer canary execution is required; the six current probes cannot verify it.
- **Mutation strength across the rewritten estate:** [UNVERIFIED]. The last measured campaign in the pre-rewrite review killed 11/12 sampled tenant-conjunct mutants (`/Users/bozhidardenev/tmp/rep-key-test-review-2026-08-21.md:38-61`); repeat changed-code mutation samples for Inbox/Review/Metric/Goal after pruning.
- **The manual observable/invariant/plumbing percentages:** grounded in the listed sample, not a full 12,712-case classification. A complete answer requires AST inventory plus human coding of every declaration; raw `expect` counts would not be meaningful.
- **Production provider truth:** local GBP fixture evidence is not live-provider evidence; the plan itself requires an authorized live drill (`docs/comprehensive-beta-implementation-program-2026-08-25.md:405-412`).

## Opinion (clearly separated, short)

The repository does not need more tests in aggregate. It needs fewer source-shape/mock twins, three joined local tracer journeys, and one honest deployed journey. The strongest material—real DB concurrency, provider reconciliation, domain matrices, and Storybook interaction/a11y—should be protected; the weakest material is governance that proves its own prose rather than the running product.
