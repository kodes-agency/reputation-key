# BQR implementation validation report

**Review date:** 2026-07-16  
**Reviewed branch:** `feat/bqr-6-4-staging-checklist`  
**Reviewed head:** `29b02187`  
**Pinned comparison baseline:** `da0f3add36d735d13816735923e32acdb7a77a9e`  
**Change size:** 276 files, 7,747 insertions, 1,715 deletions  
**Purpose:** establish an evidence-backed current-state baseline from which a detailed beta-quality remediation plan can be written.

**Remediation plan:** [Beta Quality Completion Program](completion-program-2026-07/README.md)

## 1. Executive verdict

The BQR work was needed and has improved the codebase. It added a truthful containment model, capability vocabulary, a versioned outbox envelope, real durable consumers, an atomic review-sync tracer bullet, source-lifecycle fields, property-region metadata, centralized authorization helpers, stronger architecture tests, health primitives, and a materially better CI/E2E foundation.

It has **not**, however, completed the BQR program as currently summarized in the program README. Several changes are good scaffolds or tracer bullets that were documented as completed cutovers. The most consequential gaps are:

1. durable state changes and their outbox/consumer receipts are not generally atomic;
2. Google review source-content retention is not enforced end to end and the implemented policy intentionally retains a field Google identified as raw review content;
3. authorization, property scoping, property allowlisting, suspension, and dark-capability decisions are not authoritative across every execution path;
4. processing region is metadata, not yet an execution-routing control;
5. required browser, staging, scale, recovery, security, and release evidence is either soft-gated, blind to runtime errors, failing, or still a template;
6. several changes preserve or introduce clean-architecture boundary violations rather than completing the intended deep-module cutovers.

**Release judgment:** do not start the real-property pilot and do not treat Phase 17/18 as implementation-ready. Synthetic/disposable data remains the correct posture until the P0 plan-compliance findings are closed with executable evidence.

This is not a recommendation to discard the BQR work. The right move is to preserve the useful foundations, correct the status documents, and finish the production paths they were designed to support.

## 2. Review model

The review used two deliberately separate axes:

- **Standards adherence:** whether the implementation follows the repository's architecture rules, ADRs, code-quality conventions, and official technology behavior.
- **Plan/specification adherence:** whether the implementation actually satisfies the BQR outcomes, exit criteria, beta posture, scale target, and release-evidence claims.

A related concern can appear on both axes when it violates both an engineering rule and a promised outcome. The severities are not merged or re-ranked across axes.

### Finding summary

| Axis                         |  P0 |  P1 |  P2 |  Total | Worst severity |
| ---------------------------- | --: | --: | --: | -----: | -------------- |
| Standards adherence          |   2 |   6 |   6 | **14** | **P0**         |
| Plan/specification adherence |   3 |   6 |   2 | **11** | **P0**         |
| Combined inventory           |   5 |  12 |   8 | **25** | —              |

The combined inventory is a count of review records, not a merged priority ranking. Remediation ordering must preserve the two-axis distinction and the dependency sequence in section 10.

### Severity definitions

| Severity | Meaning                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Stop-line for real Google data, pilot, or a claimed completed gate; risks policy, data integrity, authorization, or silent loss. |
| P1       | Must be resolved before beta acceptance; material correctness, operability, test-evidence, or architecture weakness.             |
| P2       | Quality debt that should be planned before or during beta hardening; raises change cost or hides defects.                        |
| P3       | Local polish or maintainability improvement without an immediate beta stop-line.                                                 |

### Evidence collected

- Read the BQR master plan, phase plans, truthful baseline, relevant ADRs, context rules, operations documents, release-evidence templates, and current status summaries.
- Reviewed the full baseline-to-head change set and current production seams across all 16 contexts.
- Traced routes, server functions, use cases, repositories, jobs, consumers, schedules, worker registration, capability checks, authorization checks, review lifecycle, region fields, health endpoints, and deployment configuration.
- Ran clean static, build, unit, integration, Storybook, browser, audit, architecture-health, dead-code, and duplication checks where locally executable.
- Checked disputed behavior against primary official BullMQ, PostgreSQL, Playwright, Storybook, and TanStack Router documentation. See [the primary-source appendix](bqr-validation-primary-sources-2026-07-16.md).

## 3. BQR phase validation

The table below uses implementation evidence rather than PR merge state.

| Phase | Documented status                                         | Validated status                                      | Assessment                                                                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BQR-0 | Complete/merged                                           | **Substantially achieved, with containment defects**  | The narrow beta posture and truthful-baseline approach were valuable. Durable dispatch remains default-off. Portal write/upload controls can nevertheless be opened through `portal.read`, and environment overrides are not restricted to test execution.                                               |
| BQR-1 | README says complete; phase file says in progress/partial | **Partial**                                           | Canonical schemas and architecture tests improved. Semantic migration parity, dependency direction, and dual access models remain unresolved.                                                                                                                                                            |
| BQR-2 | Complete                                                  | **Tracer bullet complete; phase exit not complete**   | Envelope, registration, review create/update atomic producer, and real inbox consumers exist. Most producers remain non-atomic; projection and receipt are separate commits; retry semantics are wrong; crash evidence is partial. The phase document itself records these residuals.                    |
| BQR-3 | Complete                                                  | **Not accepted**                                      | Lifecycle fields and jobs exist, but unchanged refetch persistence, read-time expiry, purge safety, bounded pagination, replicated source content, and region enforcement do not satisfy the outcome.                                                                                                    |
| BQR-4 | Complete                                                  | **Partial**                                           | The centralized helper is adopted at many server seams and review events improved. Property scoping is generally absent, grants are unwired, background paths do not consistently re-authorize, active events still carry protected content, and the phase's own exit table contains Partial/No results. |
| BQR-5 | In progress                                               | **In progress; evidence is not reliable enough**      | Hard CI shells and Storybook a11y posture improved. The critical suite is shallow and can pass through browser errors; full E2E is soft and currently fails 6/11; Storybook reports render errors without failing.                                                                                       |
| BQR-6 | Code/docs complete; staging human-gated                   | **Scaffolding complete; operational evidence absent** | Probe helpers, scripts, checklists, and evidence templates exist. The load script is a scenario catalogue, evidence rows are emitted as pending, production topology is not defined, and no staging load/fault/RPO/RTO proof exists.                                                                     |
| BQR-7 | Not started                                               | **Not started**                                       | Correctly human-gated. Its prerequisites are not yet met.                                                                                                                                                                                                                                                |

The program README (`BQR-0…5 complete`) and master plan (`BQR-0…1 complete; BQR-2 in progress`) cannot both be authoritative. Until the status model is corrected, completion percentages and downstream dependencies will remain misleading.

## 4. Standards-adherence findings

### P0

#### STD-P0-01 — Blocked portal writes can be authorized by the read capability

**Evidence**

- `src/shared/auth/authorization-policy.ts:111-114` maps `portal.create`, `portal.update`, and `portal.delete` to `portal.read`.
- Portal mutation functions in `src/contexts/portal/server/portals.ts`, `portal-groups.ts`, `portal-links.ts`, and `portal-link-categories.ts` directly assert `portal.read`.
- ADR 0032 defines `portal.write` and `portal.upload` as blocked controls, not aliases of the read gate.

**Impact**

Opening authenticated portal reads for a cohort also opens create/update/delete behavior. This breaks fail-closed capability design and makes the documented beta posture false.

**Planning requirement**

Create explicit read/write/upload capabilities, map every command to the correct capability, deny blocked capabilities independently of permission grants, and add negative tests at server, use-case/job, and worker entry points.

#### STD-P0-02 — Durable consumers do not co-commit projection state and receipt

**Evidence**

- `src/contexts/inbox/infrastructure/outbox-consumers.ts` applies projection work and records the receipt as separate operations.
- `docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/phase-bqr2-durable-runtime.md:138-139` acknowledges that the receipt is not co-committed with the projection.
- The master plan requires one PostgreSQL boundary for “projection + receipt”.

**Impact**

A crash between the commits can produce projection-without-receipt and repeated side effects, or a receipt without all required state if future ordering changes. Idempotency is incidental rather than guaranteed.

**Planning requirement**

Move each consumer family behind an owning-context `applyOnce` port implemented by one repository transaction. Test crashes before projection, between writes, and after commit.

### P1

#### STD-P1-01 — Application layers depend on outbox infrastructure through a barrel

`src/shared/outbox/index.ts` re-exports infrastructure helpers, and production application use cases across many contexts import `#/shared/outbox`. There are roughly 60 `emitAndRecord` call sites across about 50 production files. This violates `src/contexts/CONTEXT.md`, which requires dependencies to point inward and transactions to be hidden by the owning context.

The barrel makes the dependency look abstract without changing its direction. Each command-owning context needs a command store or unit-of-work port that owns state, event creation, and transaction semantics.

#### STD-P1-02 — Property authorization is absent or fail-open on most protected server calls

The reviewed production server functions contain 83 `requireAuthorized` calls and none supplies `propertyId`. No reviewed caller supplies `assignedPropertyIds`. `checkAuthorization` checks assigned-property membership only when the assigned set is present, so an `assigned-properties` scope without that set can pass.

`PropertyAccessGrant` exists in schema/domain form but is not wired through a repository/use case into the authorization context. Staff access still reads legacy staff assignments even though ADR 0039 says participation is not authorization.

This is an authorization-model completion problem, not merely missing syntax. The decision context must be built from an authoritative grant source and must fail closed when required scope data is unavailable.

#### STD-P1-03 — Protected content still crosses event and activity boundaries

ADR 0030 declares content-in-event a P0 leak class, but active event families still include:

- inbox note text in `src/contexts/inbox/domain/events.ts`;
- reply rejection reason in `src/contexts/review/domain/events.ts`;
- invitation email in `src/contexts/identity/domain/events.ts`.

Activity and notification handlers copy these values into job payloads, notification bodies, or activity JSON. This multiplies retention locations and bypasses the identifier-only contract. The review-created/updated improvements are good but do not complete the repository-wide policy.

#### STD-P1-04 — Health metrics bypass application boundaries and expose internal diagnostics publicly

`src/routes/api/health/metrics.ts` obtains the database directly and constructs readers in the route. That violates both the route rule and the context rule against direct database access. The endpoint is also unauthenticated while returning internal database/queue diagnostics.

Liveness may be public and shallow. Detailed readiness and operational metrics should be private/authenticated, exposed by a dedicated application-facing health API, and separated from process liveness.

#### STD-P1-05 — Browser/component gates can remain green through runtime errors

- Critical Playwright passed 7/7 while the dev server repeatedly reported an unhandled `node:crypto.createHash` browser error.
- Storybook's suite passed 379 tests while logging `InboxDetailContent` render errors and React state-during-render warnings.
- The Storybook command does not use `--failOnConsole`.
- Playwright uses `retries: 0` with `trace: 'on-first-retry'`, which records no trace because no retry occurs.

These are not merely noisy logs: they mean a green gate does not prove a clean browser execution. Official behavior is documented in the primary-source appendix.

#### STD-P1-06 — Executable architecture checks prove presence, not required semantics

The new tests are useful regression tripwires, but several string-scan production files and can skip ungated paths. Schema parity checks verify table/column registration but not index direction, partial predicates, constraints, defaults, foreign keys, or migration behavior. The Fallow CI gate uses `new-only`, leaving a large inherited baseline outside the required gate.

Tests should assert behavior at the real composition boundary and compare database metadata or generated SQL, not only source-string presence.

### P2

#### STD-P2-01 — Review domain imports a Node-only hashing implementation

`src/contexts/review/domain/rules.ts` imports `createHash` from `node:crypto`. The module enters the client bundle and causes the observed browser runtime error. A pure domain layer also should not depend on a Node runtime adapter.

Move hashing behind a port/application service or use a deliberately universal implementation outside the domain. Add a client-bundle boundary test.

#### STD-P2-02 — Canonical schema does not semantically match migrations

Review and review-sync migrations define descending and partial indexes that the Drizzle schemas do not fully represent. The current parity test passes because it checks names/columns, not index order or predicates. This creates two authoritative database models and can lead to drift in generated migrations or query planning.

#### STD-P2-03 — Composition and worker registration require shotgun surgery

`src/composition.ts`, `src/bootstrap.ts`, and `src/worker/index.ts` form a large registration cluster. Adding a command, consumer, or job often requires coordinated edits across global files. The files are approximately 591, 349, and 325 lines respectively and already rank among the complexity hotspots.

Prefer per-context runtime modules that return explicit server APIs, workers, consumers, and schedules, assembled by a small composition root.

#### STD-P2-04 — Domain decisions use ambient wall-clock time

Multiple domain/application paths in badge, guest, staff, activity, metric, portal, and identity use `new Date()` or `Date.now()` directly despite the injectable-clock decision in ADR 0017. This weakens deterministic testing and makes replayed jobs/event handling time-dependent.

#### STD-P2-05 — Dead code, complexity, and duplication remain high

The full architecture-health scan reported:

- health score 71/B;
- 120 functions above the configured complexity threshold;
- 386 untested files and 795 untested exports;
- 22 unused files, 190 unused exports, 14 boundary violations, and 24 stale suppressions;
- 9.7% duplication, 331 clone families, and 14,266 duplicated lines.

Important apparently unused modules include the security-header plugin, dashboard cache, health endpoints, operator commands, and web-vitals integration. Framework entry-point false positives must be triaged, but the aggregate is significant planning evidence.

`.fallowrc.json` also contains three duplicate `regression` keys; JSON keeps only the last one. The configuration should be made unambiguous before its results are treated as policy.

#### STD-P2-06 — Test and development configuration is not hermetic

- Bare `pnpm test:unit` failed because test-default Google credentials are empty while environment validation rejects them; supplying placeholders made the suite pass.
- `src/routes/api/webhooks/gbp/notifications.test.ts` is treated as a route candidate and generates a router warning.
- E2E setup attempts real email-provider calls with an invalid placeholder key, producing repeated errors.
- The web build warns about large chunks and the Node-only crypto dependency.

Local and CI tests need deterministic, explicit environment fixtures and no accidental network/provider execution.

## 5. Plan/specification-adherence findings

### P0

#### SPEC-P0-01 — The BQR-2 durable-runtime outcome is not implemented beyond a tracer bullet

The review-sync create/update path correctly uses `ReviewCommandStore`, but most event-producing commands still call non-atomic `emitAndRecord`. Purge emits then deletes. Consumers commit state and receipt separately. The dispatcher catches processing errors and resolves the job. Missing consumers and malformed payloads also log/return while messages say they will be retried.

BullMQ marks a processor successful when it resolves and failed when it throws. Automatic attempts apply to failed jobs. The current dispatcher therefore acknowledges several retryable failures instead of activating retry behavior.

The phase cannot be considered complete until:

1. every enabled producer family commits state plus outbox in one owning-context transaction;
2. every enabled consumer co-commits projection plus receipt;
3. malformed/non-retryable and transient/retryable failures have explicit, tested policies;
4. crash/reorder/duplicate/poison/stalled/redrive evidence passes at the real worker boundary;
5. durable dispatch can replace, rather than coexist ambiguously with, the in-process primary path.

#### SPEC-P0-02 — Google source-content lifecycle and retention are not enforced end to end

This finding combines several independent failures of ADR 0031, Google's written response, and BQR-3:

- BQR-3 explicitly retains review `rating` as an “operational fact”, while Google's response names review text, star ratings, reviewer information, replies, and Google identifiers as raw review content subject to refresh/removal requirements.
- Inbox scrubbing clears only `snippet` and `reviewerName`; ratings and other replicated source fields remain.
- Durable review events include source-linked identifiers, and there is no production caller for outbox/receipt retention purges.
- `purgePublishedBefore` and `purgeReceiptsBefore` use `DELETE ... LIMIT`, which is not valid PostgreSQL syntax. PostgreSQL documents a CTE batching pattern instead.
- Stable-content refetch calls repository `upsert`, but its conflict update omits `lastFetchedAt`, `contentExpiresAt`, `contentHash`, and related source timestamps. The test double can pass while PostgreSQL behavior remains stale.
- Normal review and dashboard reads do not universally exclude expired source content.
- Refresh and purge queries cap work at 5,000 rows without a cursor/repeat-until-empty loop, which is unsafe at the stated 500,000-review monthly scale.
- Refresh enqueue failures are caught and the job resolves; a later purge can proceed without proof of a successful refresh.
- Purge emits `review.expired` and then deletes non-atomically; the inbox scrub handler catches failures, so canonical deletion can occur while a projection retains protected content.

This is the strongest reason not to ingest real Google review data yet. The eventual plan needs a complete inventory of every raw/source-derived field and every copy in review, inbox, activity, outbox, job, log, cache, backup, and test data, with an executable retain/refresh/scrub/delete rule for each.

#### SPEC-P0-03 — Capability and authorization policy is not authoritative across production paths

The master plan requires the capability decision at routes, commands, workers, consumers, schedules, and operator paths. Current enforcement is concentrated in server functions.

Material gaps include:

- property allowlisting always returns true and suspension always returns false in the production capability store;
- queued import, sync, publication, durable consumers, and schedules do not consistently re-evaluate the capability at execution time;
- goal, badge, and leaderboard event handlers are registered unconditionally even though the contexts are dark;
- several dark route shells remain directly navigable and depend on later server failures;
- assigned-property authorization fails open when assignment context is absent;
- the explicit property-grant model is not wired;
- `BETA_E2E_GLOBAL_CAPABILITIES` is not restricted to test/CI mode, so a production environment mistake can globally open non-core capabilities;
- portal writes can be opened through the read capability.

The beta gate must use one fail-closed decision model with persisted cohort/property policy and an immutable audit trail. Interactive access alone is not sufficient; delayed work must re-check policy immediately before side effects.

### P1

#### SPEC-P1-01 — Property-region routing is metadata, not an enforced processing route

Property creation/import resolves and stores `processingRegion`, which is useful groundwork. No reviewed provider adapter, queue selection, worker deployment, database boundary, or AI/provider execution consumes it as an enforcement decision. Active properties may remain `unresolved`, historical backfill is not included, and there is no demonstrated no-fallback failure at the execution boundary.

The Phase PRE17 requirement was property-region routing. It is satisfied only when the selected region determines the actual processing resources/provider endpoint and unresolved or unavailable routes fail closed with visible operations state.

#### SPEC-P1-02 — Worker and scheduled-job failures can be silently acknowledged

The outbox dispatcher, refresh scheduler, and unknown-job branches catch/log/return in situations that require retry, quarantine, or an operator-visible terminal state. `src/worker/index.ts` logs unknown job names and resolves them, effectively completing/dropping the job. This conflicts with the plan's visible-failure, poison-message, retry, and redrive requirements.

Every job type needs an explicit failure taxonomy: retryable, unrecoverable/quarantine, idempotent no-op, and operator intervention. Unknown work must never be accepted as success.

#### SPEC-P1-03 — BQR-5's hard browser evidence is too shallow and currently blind

The critical suite contains seven mostly shell-level checks. The inbox check accepts a visible Retry action as successful loading and performs no meaningful triage mutation. The suite also enables registration and team capabilities that are not the real invite-only beta posture.

The full suite is `continue-on-error` in CI and locally produced 4 passes, 1 skip, and 6 failures. Failures cover registration, invitations, navigation, password reset, staff, and team paths. Team is intentionally dark for beta, so its product behavior need not be enabled, but the test and capability posture must agree; a deliberately dark feature should have a blocking negative test, not a soft positive test.

#### SPEC-P1-04 — BQR-6 provides plans and templates, not scale/recovery proof

`scripts/perf/load-test.ts` describes scenarios and thresholds but does not execute a load. `scripts/perf/write-scale-evidence.ts` writes “pending staging” rows. The local release-evidence directory contains templates/drafts rather than signed results. No observed run proves:

- 5,000 properties and 500,000 new reviews/month;
- queue oldest-age/lag and drain behavior;
- source refresh before expiry;
- provider throttling and reconnect behavior;
- poison/stalled/redrive behavior;
- backup restore, RPO ≤ 15 minutes, or RTO ≤ 4 hours;
- regional failure without cross-region fallback.

The staging dependency is legitimate, but “code/docs complete” must not be confused with an accepted operational gate.

#### SPEC-P1-05 — Production topology and observability are incomplete

`railway.json` defines a minimal single process with no production health-check path, predeploy migration, explicit web/worker separation, worker replica model, or regional topology. There is no production-container definition even though the master gate requires production-container builds.

Health primitives exist but the operational surface does not yet cover release/config versions, oldest job age, stalled jobs, Google freshness, ambiguous reply publication, retention backlog, regional routing failures, alert routing, or tested operator commands. Several of the intended modules are currently unused.

#### SPEC-P1-06 — Required security and release gates are missing

The dependency audit currently has no high/critical production advisory, which is good. CI nevertheless lacks the master plan's explicit dependency, license, secret, artifact/container, and release-evidence gates. No evidence bundle binds a commit, migrations, environment policy, test results, scans, deployment, recovery run, and human approvals into one release manifest.

### P2

#### SPEC-P2-01 — Status documents contradict their own gates and each other

Examples:

- the program README says BQR-0 through BQR-5 are complete;
- the master plan says BQR-0/1 complete and BQR-2 in progress;
- BQR-1 is marked in progress and records partial criteria;
- BQR-2 is marked complete while recording non-atomic producers, non-co-committed receipts, partial crash evidence, and default-off dispatch;
- BQR-4 is marked complete while its exit table contains Partial and No;
- BQR-5 is explicitly in progress;
- BQR-6 is code/docs complete while all staging proof remains pending.

Statuses should be mechanically derived from a gate manifest where possible: `not_started`, `implementation_in_progress`, `implementation_complete`, `evidence_pending`, and `accepted` are meaningfully different states.

#### SPEC-P2-02 — Evidence files do not yet prove a release candidate

The release-evidence tree has a README, template, and local draft scale file but no immutable release manifest, command outputs, CI run references, scan results, staging deployment identifiers, fault/load observations, recovery timings, alert verification, known-risk acceptance, or sign-offs. This is adequate scaffolding, not release evidence.

## 6. Context-by-context assessment

Every context was considered against the beta posture in the master plan.

| Context      | Intended beta posture  | Current assessment                                          | Principal planning concerns                                                                                                                                                                            |
| ------------ | ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity     | Enabled                | **Partial**                                                 | Invite/session foundations exist. PropertyAccessGrant is not authoritative; assigned scope can fail open; invitation email crosses event boundaries; registration/email tests are not deterministic.   |
| Property     | Enabled                | **Partial**                                                 | Lifecycle and region model improved. Allowlist/suspension store is a no-op; unresolved active properties remain possible; property-scoped authorization is not passed to the policy seam.              |
| Integration  | Allowlisted properties | **Partial/high risk**                                       | OAuth/import/sync foundations exist. Execution-time capability and region checks are incomplete; retry/receipt/notification freshness and provider-failure evidence are missing.                       |
| Review       | Enabled                | **Partial/high risk**                                       | Strongest BQR tracer bullet. Raw-content retention, stable-refetch persistence, read-time expiry, purge safety, outbox retention, browser hashing, and non-atomic reply/purge families remain.         |
| Inbox        | Enabled                | **Partial/high risk**                                       | Real consumers and scrub fields exist. Projection+receipt is non-atomic; raw content is denormalized; purge/scrub ordering is unsafe; replay/repair and meaningful E2E triage evidence are incomplete. |
| Dashboard    | Limited                | **Partial**                                                 | Useful bounded views exist. Some reads bypass governed source expiry; materialized/cache strategy and invalidation are not production-proven; unused cache module suggests an incomplete cutover.      |
| Metric       | Internal projection    | **Partial**                                                 | Projection model exists. Idempotency/durable coupling and permitted-field governance need end-to-end proof; avoid enabling staff gamification from Google data.                                        |
| Notification | In-app only            | **Partial**                                                 | In-app behavior exists. Protected rejection content is copied into notification paths; durable delivery/receipt and non-auth outbound-email fail-closed evidence need completion.                      |
| Activity     | Limited                | **Partial/high privacy risk**                               | Collaboration feed exists. Free text/email/reasons are persisted through event handlers; retention and audit-vs-activity ownership remain unclear.                                                     |
| Staff        | Minimal enabled        | **Partial**                                                 | Participation features exist. Legacy staff assignments influence access despite the explicit grant model; full E2E staff shell fails.                                                                  |
| Team         | Dark                   | **Containment incomplete/evidence confused**                | Server capability checks exist, but handlers are assembled and CI opens team globally for positive tests. Replace beta positive expectations with fail-closed negative evidence until promoted.        |
| Portal       | Dark                   | **Containment defect**                                      | `portal.read` is non-core, but read capability authorizes write/delete paths. Upload/write need independent blocked controls at every entry point.                                                     |
| Guest        | Dark                   | **Mostly server-contained; background/public audit needed** | Public server seams are gated. Public-edge/session/media/scan/click jobs and cross-context dependency need negative tests; guest infrastructure imports a portal domain error.                         |
| Goal         | Dark                   | **Server-contained only**                                   | UI/routes and event handlers remain assembled; complex build path; direct clock use. Deny reads, commands, events, jobs, and schedules at authoritative execution seams.                               |
| Badge        | Dark                   | **Server-contained only**                                   | Evaluation handlers remain registered and can mutate if events bypass the server; direct clock use; workers/configuration need negative evidence.                                                      |
| Leaderboard  | Dark                   | **Server-contained only**                                   | Read functions are gated but recomputation/event/runtime assembly must fail closed; UI route posture should be explicit.                                                                               |
| AI           | Dark/not implemented   | **Correctly absent**                                        | Do not add provider calls until consent, redaction, retention, region execution, quota, audit, and beta foundations have accepted evidence.                                                            |

## 7. Executed quality-gate results

Results describe the reviewed head in the local environment. A pass is not upgraded beyond what the gate actually asserts.

| Gate                                    | Result                                                             | Interpretation                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Formatting                              | Pass                                                               | No formatting blocker found.                                                                                        |
| Typecheck                               | Pass                                                               | Static types are green.                                                                                             |
| ESLint                                  | Pass                                                               | Configured lint rules are green.                                                                                    |
| Web production build                    | Pass with warnings                                                 | Build completes; warns about Node crypto in browser, route-candidate test, and chunk size.                          |
| Worker build                            | Pass                                                               | Worker bundle builds. Runtime job semantics remain a separate concern.                                              |
| Storybook build                         | Pass                                                               | Static Storybook builds.                                                                                            |
| Unit test, bare command                 | **Fail**: 36 files/142 tests reached before env validation failure | Not hermetic; empty Google test defaults conflict with config validation.                                           |
| Unit test with explicit placeholder env | Pass: 304 files/3,343 tests                                        | Strong unit baseline once environment is supplied. No enforced coverage threshold.                                  |
| Fresh migrations + integration tests    | Pass: 16 files/159 tests                                           | Useful database evidence, but semantic schema parity and production-scale behavior are not covered.                 |
| Storybook tests                         | Pass: 74 files/379 tests, with console/render errors               | A11y `test: error` posture is correct; console errors are not a failure condition.                                  |
| Critical Playwright                     | Pass: 7/7, with repeated unhandled browser error                   | Not acceptable as clean critical-path evidence.                                                                     |
| Full Playwright                         | **Fail**: 4 passed, 1 skipped, 6 failed                            | Registration, invite, navigation, reset, staff, and team expectations fail. CI masks this with `continue-on-error`. |
| Production dependency audit             | Pass high/critical; 1 moderate, 2 low                              | No current high/critical production advisory. Formal policy/scanning gate absent.                                   |
| Full dependency audit                   | 3 moderate, 2 low; 0 high/critical                                 | Track and triage; no immediate P0 advisory.                                                                         |
| Fallow health                           | **Fail**: 71/B                                                     | 120 high-complexity functions; 386 untested files; 59.5% file coverage; 795 untested exports.                       |
| Fallow dead-code/boundaries             | **Fail**: 254 findings                                             | Includes unused intended controls and 14 boundary violations; triage framework false positives before deletion.     |
| Fallow duplication                      | 9.7%                                                               | 331 clone families, 604 clone groups, 14,266 duplicated lines.                                                      |
| Production-container build              | **Not present**                                                    | Required master gate cannot run.                                                                                    |
| Staging load/fault/recovery             | **Not executed**                                                   | Evidence files remain pending.                                                                                      |

## 8. Positive improvements to preserve

The later remediation plan should build on, not undo, these changes:

1. **Truthful containment vocabulary.** The enabled/limited/dark context matrix is the correct operating model for an internal beta.
2. **Typed/versioned durable envelope.** `ConsumerEvent` parsing and schema registration are a sound basis for durable processing.
3. **Atomic review command-store tracer bullet.** It demonstrates the correct direction: the context hides its transaction and outbox write.
4. **Real inbox consumers.** Replacing no-op receipts with projection work was necessary; the remaining task is transactional co-commit and operational hardening.
5. **Source lifecycle and region domain types.** Fetch timestamps, content expiry/hash, routing region, provenance, and lock rules are useful model improvements even though production enforcement is incomplete.
6. **Central authorization/capability vocabulary.** One decision seam is the right target. The work now needs authoritative data and coverage across all execution types.
7. **Architecture test intent.** The new checks catch regressions that previously had no executable guard. They should be deepened from source presence to composition/runtime behavior.
8. **Health, scale, and evidence scaffolding.** Probes, scenario catalogues, checklists, and templates make the missing work visible and can become executable gates.
9. **Expanded tests and fixtures.** The suite is substantially larger and surfaces real drift. The next step is to make it deterministic and failure-sensitive.

## 9. Remediation workstreams for the later detailed plan

This section is intentionally a planning map, not an implementation plan. Dependencies matter more than parallel feature output.

### Workstream A — Rebaseline truth and freeze unsafe data paths

- Correct phase/status documents and introduce evidence-aware states.
- Keep real Google content and durable dispatcher disabled.
- Restrict E2E capability overrides to test mode.
- Fix portal capability aliasing immediately.
- Define the exact pilot capability manifest and assert it at boot.

### Workstream B — Complete source-data governance first

- Reconcile ADR 0031 and BQR-3 with Google's written field list, including star rating, Google identifiers, reviewer data, and replies.
- Build a field/copy/retention inventory for every store and transport.
- Correct stable-refetch persistence, read-time expiry, cursor-based refresh/purge, and valid bounded SQL.
- Make scrub/delete/receipt atomic or compensatable and observable.
- Add retention backlog, oldest-content-age, refresh success, scrub failure, and purge failure alerts.
- Prove behavior with real PostgreSQL and clock-controlled lifecycle tests.

### Workstream C — Make policy authoritative

- Persist organization/property capability, allowlist, suspension, and consent state.
- Wire PropertyAccessGrant as the authorization source; remove inferred access from staff/team/portal participation.
- Fail closed when property scope is required but missing.
- Apply one policy-decision contract at routes, commands, workers, consumers, schedules, and operator commands.
- Add dark-context negative suites for all execution paths.

### Workstream D — Finish durable runtime by vertical slice

- Introduce owning-context command stores and consumer `applyOnce` ports.
- Migrate one enabled event family end to end before the next: review/reply, inbox, notification/activity, metric/dashboard, integration.
- Define retryable vs unrecoverable errors and dead-letter/redrive behavior.
- Fail unknown job names.
- Add crash, duplicate, reorder, poison, stalled, lease-expiry, and redrive component tests.
- Remove the in-process path as primary only after durable equivalence is proven.

### Workstream E — Turn region metadata into execution routing

- Resolve/backfill every active property's region or block processing.
- Route queue, worker, provider endpoint, and data boundary from the property-owned decision.
- Prohibit silent cross-region fallback in code and deployment topology.
- Capture region and policy version in usage/audit records without raw content.
- Test regional unavailability and explicit operator recovery.

### Workstream F — Repair architecture and composition

- Split context public contracts from shared infrastructure barrels.
- Move Node/runtime implementations out of domain code.
- Modularize per-context runtime registration and shrink global composition/worker files.
- Eliminate direct route-to-database access.
- Make clock, IDs, hashing, and provider time explicit dependencies.
- Strengthen semantic schema parity and dependency rules.

### Workstream G — Establish trustworthy beta experience gates

- Fix the client crypto runtime failure and fail E2E on uncaught page/server errors.
- Make unit tests hermetic and provider-free.
- Choose one authoritative Storybook component gate and fail browser console errors.
- Align E2E capabilities with the actual beta posture; test dark features negatively.
- Exercise meaningful mutations and visible failures for each enabled critical flow.
- Remove `continue-on-error` only after the residual suite is deterministic and green, or record a time-bounded approved exception outside required evidence.

### Workstream H — Production operations and release evidence

- Define repeatable production web/worker/container topology, migrations, health checks, scaling, and region placement.
- Add private operational metrics, alert rules, dashboards, runbooks, and tested operator commands.
- Execute the 5,000-property/500,000-review staging model and provider-throttle scenarios.
- Rehearse backup restore, poison/redrive, worker loss, Redis/database degradation, and regional failure.
- Generate an immutable release manifest binding commit, migrations, config-policy versions, CI, scans, staging results, RPO/RTO, risks, and sign-offs.

### Workstream I — Context quality and debt reduction

- Triage Fallow findings into true dead code, framework entry points, intended future controls, and suppressions with owners/expiry.
- Reduce the highest-risk complexity hotspots before adding AI orchestration.
- Establish domain coverage and mutation/property tests for pure rules instead of relying on an unenforced “100%” statement.
- Consolidate duplicated query, authorization, error, and registration patterns only where a deeper interface results.

## 10. Recommended dependency order

```text
Truthful rebaseline and containment
    -> source-data governance stop-lines
    -> authoritative capability + property authorization
    -> durable producer/consumer vertical slices
    -> enforced property-region execution
    -> trustworthy experience and architecture gates
    -> production topology, scale, fault, recovery, and release evidence
    -> BQR-7 real-property pilot
    -> Phase 17/18 implementation planning and execution
```

Architecture cleanup and test repair can proceed alongside the first four workstreams only where it does not activate unsafe paths or create a second model.

## 11. Acceptance conditions before detailed Phase 17/18 planning

Detailed AI product planning can continue conceptually, but implementation planning should not be baselined against the current runtime until all of the following are true:

1. one authoritative and accepted BQR status manifest exists;
2. Google raw-content fields and every retained copy have executable lifecycle rules;
3. enabled commands and consumers are transactionally durable and retry-correct;
4. organization/property capability, consent, suspension, grant, and region decisions fail closed across delayed work;
5. the property-region decision controls actual provider/worker execution;
6. critical and full beta suites are deterministic, failure-sensitive, and green for the declared beta posture;
7. production topology, security scans, alerts, scale, recovery, and release evidence have been executed rather than templated;
8. BQR-7 begins only after the release gate has zero unresolved P0/P1 findings or explicit policy-approved exceptions where the master plan permits them.

## 12. Review limitations

- No staging or production environment was available, so provider, regional infrastructure, alerts, restore, and load claims could only be validated as code/evidence presence.
- External provider behavior was not invoked; local E2E intentionally used placeholder credentials and revealed that some tests still attempt provider calls.
- Static dead-code tools can misclassify framework-discovered entry points. Their totals are signals requiring triage, not an instruction to delete every reported symbol.
- The review inspected the current repository and the BQR change range. It is not a penetration test, formal privacy/legal opinion, or substitute for the Google-project, security, privacy, and operations sign-offs required by BQR-7.

## 13. Final assessment

The codebase is better than before the BQR effort, and the clean-architecture direction is still recoverable. The deviation is not that BQR introduced too much structure; it is that several cross-cutting foundations stopped at shared helpers, barrels, source-scanning tests, or tracer bullets while documentation promoted them to completed production seams.

The highest-quality route to beta is therefore not a rewrite and not immediate Phase 17 work. It is a disciplined completion program: make data governance and policy authoritative, deepen context-owned transaction boundaries, make execution region-aware, make failures observable and retry-correct, and require evidence that can fail. Once those are true, the existing context/domain structure will be a credible base for AI rather than an additional layer over unresolved correctness risk.
