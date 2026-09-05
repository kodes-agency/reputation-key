# Architecture and runtime wiring — state of the app, 2026-09-02

## Verdict

The most consequential fact is that the deployable isolation described as executable is not on the production web or operator call paths: only the worker calls a projected builder, while HTTP/server functions and operator scripts obtain the complete 69-key container. The one-container/projection proof is therefore test-only for two of the three deployables, and the request edge remains a 204-call service locator across 61 production files. The rewrite did achieve real static boundaries, an injectable ambient-config boundary, per-container consumer/job registries, an atomic outbox pattern, and runtime-backed event/job catalogues. It did not remove composition-time private-context wiring or runtime build-order cycles: 4,215 production lines still construct the graph, including 58 runtime imports of context application/domain/infrastructure internals and five explicit deferred cross-context bindings. The durable fact machinery is structurally credible, but a valid default-off dispatcher configuration can still accept the currently enabled Google Import v2 capability and never enqueue its item jobs, while the Inbox cutover flags do not actually control durable consumer dispatch when the global dispatcher is on. The catalogues are executable rather than decorative, but 11,691 catalogue/guard-test lines predominantly prove names, literals, and registrations; they do not prove the plan's executed end-to-end reachability or atomicity claim for every active row. ARC-01 and ARC-03 therefore have strong achieved slices, but their planned outcome is not honestly closed as a whole.

## Scorecard

| Planned outcome (cite the package/§)                                                                                                                                                                              | Current reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Verdict     | Severity |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------- |
| FND-03: bidirectional executable inventory and every active row has an executed reachability test (`docs/comprehensive-beta-implementation-program-2026-08-25.md:266-285`)                                        | 542 entry points, 109 event families, and 38 job families are bidirectionally source-checked; job/runtime policy consumes the rows. However, 443/542 entry points claim only `direct_declaration`, 61 `source_composed`, and 38 `boot_registry`; source existence/composition is not execution (`src/shared/governance/entry-point-catalogue.ts:874-891`; `src/shared/governance/entry-point-catalogue.test.ts:1158-1376`).                                                                | IMPROVE     | medium   |
| SAFE-05/FND-02: runtime artifacts contain only their deployable surface and forbidden tools are absent (`docs/comprehensive-beta-implementation-program-2026-08-25.md:323-335,414-429`)                           | Dedicated sidecar runtime stages copy only their named bundles and remove package managers (`Dockerfile.google-egress-gateway:24-43`; `Dockerfile.ai-egress-gateway:27-47`). Source-level web/operator capability containment is false because those paths use the unprojected container (`src/composition.ts:920-926`; `src/contexts/inbox/server/inbox-status.ts:24-43`; `scripts/ops/gbp-subscribe.ts:49-60`). Built-image absence was not re-proved in this review.                    | SUBSTANTIAL | high     |
| ARC-01: versioned envelope, atomic state+fact, bus only as accelerator, recovery authority (`docs/comprehensive-beta-implementation-program-2026-08-25.md:439-460`)                                               | The reviewed Inbox transition co-commits state and fact and has an idempotent durable Activity consumer/repair path. The envelope has no command ID or aggregate type, causation is nullable and “null today,” and aggregate version is optional (`src/shared/outbox/envelope.ts:26-75`). Dispatcher/cutover activation can still make the durable path absent or unexpectedly dual.                                                                                                       | IMPROVE     | high     |
| ARC-02: one executable job/schedule authority and no readiness lie; Import v2 cannot accept without its dispatcher (`docs/comprehensive-beta-implementation-program-2026-08-25.md:462-479`)                       | The event/job catalogue drives retries, timeouts, schedules, readiness, and duplicate registration refusal (`src/shared/jobs/job-policy.ts:18-80`; `src/shared/jobs/operational-catalogue.ts:89-143`; `src/shared/jobs/registry.ts:17-35`). The dispatcher remains optional/default-off, readiness skips durable consumers when off, and active Import v2 admission does not depend on dispatcher health (`src/shared/jobs/readiness.ts:16-19,33-47`; `src/shared/config/env.ts:318-322`). | IMPROVE     | high     |
| ARC-03: small interfaces; root returns only entry-point needs; no repositories/use-case bags/private wiring (`docs/comprehensive-beta-implementation-program-2026-08-25.md:481-501`; `docs/standards.md:190-225`) | Context builds usually expose named groups, but the root returns raw DB/pool/Redis/event bus/outbox repo/registries and worker repository objects (`src/composition.ts:730-897`); bootstrap consumes Notification repositories and Portal storage directly (`src/bootstrap.ts:294-316,784-900`).                                                                                                                                                                                           | SUBSTANTIAL | medium   |
| ARC-03: exactly one complete container per process and no late-bound cycles (`docs/architecture/composition-and-process-boundaries.md:18-50,61-74`)                                                               | A projection/occupancy implementation exists, but production reaches it only from the worker. Web/operator builds are absent from production entry points; five forward/deferred cross-context dependencies remain explicit (`src/composition/deployables.ts:77-135`; `src/composition.ts:230-231,263-273,293-313,459-474,662-684`).                                                                                                                                                       | SUBSTANTIAL | high     |
| ARC-03/GOV-02: exact-root default-deny boundaries, no unknown production files, and executable negative controls (`docs/comprehensive-beta-implementation-program-2026-08-25.md:481-501`)                         | The boundary graph classifies production roots, defaults to deny, and rejects unknown files/dependencies (`eslint.config.js:150-169,427-522,1250-1261`). The focused checker passed 24 invalid and 14 valid fixtures; an independent cross-context probe emitted both the custom and `boundaries/dependencies` errors.                                                                                                                                                                     | ACHIEVED    | —        |
| ARC-03: inject runtime config and eliminate ambient context/build reads (`docs/comprehensive-beta-implementation-program-2026-08-25.md:487-490`)                                                                  | Ambient reads have a reasoned authority; context and route internals are forbidden, process resources are explicit exceptions, and the worker receives a parsed runtime object (`src/shared/architecture/ambient-runtime-read-authority.ts:1-108`; `src/shared/architecture/runtime-config-injection.test.ts:102-183,201-223`).                                                                                                                                                            | ACHIEVED    | —        |

### Pre-rewrite finding register disposition

The rewrite target said architecture/governance existed without reliable activation (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:44-67,232-274,287-308`). Current dispositions are:

| Pre-rewrite finding                                                 | Current disposition                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-01 oversized service locator                                   | **Partially fixed, then displaced.** `src/composition.ts` fell below the pinned 1,000-line budget (`src/shared/architecture/composition-container-boundary.test.ts:169-175`), but total production composition/bootstrap is 4,215 lines and `getContainer()` remains 204 calls in 61 production files.                                                                                                                            |
| ARCH-02 runtime cycles                                              | **Static cycle fixed; runtime cycle not fixed.** Fallow reports zero production issues/cycles, while five late-bound closures/deferred bindings remain (`src/composition/member-authority-lifecycle.ts:1-14,167-214`).                                                                                                                                                                                                            |
| ARCH-03 process-global registries/policy/auth hooks                 | **Mostly fixed, with one retained process policy binding.** Consumer and job registries are container-owned (`src/composition.ts:245-255,880-895`); Better Auth's mutable composition callback was deleted in favor of fail-closed provider hooks (`src/shared/auth/auth.ts:202-210`); execution-policy ownership still uses a guarded process binding (`src/shared/auth/process-policy-binding.ts:20-70`).                       |
| ARCH-04 ambient configuration                                       | **Achieved for context/build surfaces.** The exhaustive authority rejects ambient reads under `src/contexts/**` and `src/routes/**` (`src/shared/architecture/runtime-config-injection.test.ts:142-183,201-223`).                                                                                                                                                                                                                 |
| ARCH-05 atomic write/event semantics                                | **Strong representative slices, not universal execution proof.** Inbox status transition is atomic (`src/contexts/inbox/infrastructure/inbox-command-store.ts:2139-2348`); the catalogue's 139 atomic claims are name-table classifications, not 139 transactional tests (`src/shared/governance/entry-point-catalogue.ts:565-722`).                                                                                              |
| ARCH-06/ARCH-12/ARCH-13 source catalogues and split job authorities | **Substantially achieved for discovery/registration.** Catalogue rows drive runtime job policy/readiness/schedules and reject duplicate handlers (`src/shared/jobs/registry.ts:17-35`; `src/shared/jobs/operational-catalogue.ts:112-143`), with the semantic/activation limitations in ARCH-I3.                                                                                                                                  |
| ARCH-09 shared super-context                                        | **Context import boundary achieved; composition remains privileged.** Cross-context imports are denied (`eslint.config.js:1296-1305`), but composition is expressly allowed to import context internals (`eslint.config.js:997-1022`) and does so 58 times at runtime.                                                                                                                                                            |
| ARCH-10 one dependency graph for sidecars                           | **Runtime artifact isolation replaces, rather than splits, the package.** Final sidecar stages copy only a dedicated bundle (`Dockerfile.google-execution-admission:23-37`; `Dockerfile.ai-execution-admission:23-35`); the build stage still installs the repository's single lockfile/package (`Dockerfile.google-execution-admission:14-21`). Built-image scans remain unverified here.                                        |
| EVT-04 Activity bus-only durability                                 | **Partially fixed.** Activity now has durable consumers and atomic receipt/projection application (`src/contexts/activity/infrastructure/outbox-consumers.ts:591-618,793-814`; `src/contexts/activity/infrastructure/activity-delivery-store.ts:381-423`), but the in-process bus is still active and delivery depends on global dispatcher activation (`src/contexts/activity/build.ts:100-110`; `src/worker/index.ts:337-389`). |
| EVT-07 Import v2 can outlive/lose its dispatcher                    | **Still structurally open.** Import intent is durable-only and the capability is ON, but worker boot and web admission accept dispatcher-off mode (ARCH-I1).                                                                                                                                                                                                                                                                      |

## What was achieved

### ARCH-A1 Production dependency boundaries now fail closed for the graph they cover

**Verdict: ACHIEVED.**

**Evidence.** `eslint.config.js` defines exact production roots/layers and context element types (`eslint.config.js:150-260,427-510`), defaults unmatched dependencies to deny (`eslint.config.js:513-522`), and rejects both unknown files and unknown imported dependencies (`eslint.config.js:1250-1261`). The custom rule independently forbids a context from importing another context except through its public API (`eslint.config.js:1296-1305`). A focused execution in this review produced:

```text
$ node scripts/check-architecture-boundary-controls.mjs
[architecture-boundaries] OK — 24 invalid imports rejected; 14 valid seams accepted.
```

An independent `ESLint.lintText` probe, pretending that an AI application file imported Review infrastructure, returned `local/cross-context-public-api` and `boundaries/dependencies`. The control is part of `lint`/`lint:ci` (`package.json:28-30`) and CI runs `pnpm lint:ci` (`.github/workflows/ci.yml:60-70`).

**Why it matters.** This is the clearest repair of the pre-review's “architecture documented but not enforced” problem: a forbidden new dependency fails a real executable control rather than a prose review.

**Recommendation.** Keep this as a required control. Add one negative fixture for `local/cross-context-public-api` itself and one proving that composition may not import a foreign context's repository/use case; the current checker filters only `boundaries/*` messages (`scripts/check-architecture-boundary-controls.mjs:21-25,252-293`).

**Cost/risk of the fix.** Low. Two fixtures make the current contract explicit; the risk is exposing existing composition violations, which should be resolved through ARCH-S2 rather than waived broadly.

### ARCH-A2 Ambient configuration ownership and the static import graph are materially better

**Verdict: ACHIEVED.**

**Evidence.** The ambient-read authority names each allowed process boundary/resource and a reason (`src/shared/architecture/ambient-runtime-read-authority.ts:1-108`); its exhaustive checker scans production `src` and `server`, rejects stale declarations, forbids context/route entries, and rejects module-scope plugin reads (`src/shared/architecture/runtime-config-injection.test.ts:88-183`). Context builds are specifically checked for `getEnv`, `getRedis`, `getLogger`, and `process.env` (`src/shared/architecture/runtime-config-injection.test.ts:201-223`). A clean production-only cycle/dead-code run in this review produced:

```text
$ pnpm exec fallow dead-code --circular-deps --production --no-cache --format json --summary
{"elapsed_ms":1120,"total_issues":0,"entry_points":{"total":260,...},"summary":{"total_issues":0,...}}
```

(The command also warned that the test boundary matched no production-reachable files; that does not alter the production result.)

**Why it matters.** Context behavior can be built with deterministic config and does not silently bind itself to import order. Static cycles, unresolved imports, and unused production graph fragments no longer hide behind a successful typecheck.

**Recommendation.** Protect the exhaustive scan and retain the narrow process-resource exceptions for DB, Redis, queues, and logging (`src/shared/architecture/ambient-runtime-read-authority.ts:71-102`). Do not misstate the zero static cycles as proof of an acyclic runtime construction graph; ARCH-S3 remains separate.

**Cost/risk of the fix.** No corrective work is required. The ongoing cost is the explicit allowlist; that is proportionate because each exception is executable and reasoned.

### ARCH-A3 Event/job inventory and job operational authority are executable, not merely prose

**Verdict: ACHIEVED for inventory and runtime job policy; not for universal executed reachability.**

**Evidence.** Current runtime census:

```text
entry points 542 = 210 server functions + 43 UI routes + 11 API routes +
                   38 jobs + 35 consumers + 26 schedules + 179 operator commands
event families 109 = 56 enabled + 1 orphan + 2 recorded-only +
                     47 denied-dark + 3 quarantined
75 event families have a durable consumer
job families 38 = 32 enabled; 26 have a schedule
```

The event/job test discovers emitted literals, registered schemas, bus/durable consumers, production job registration, and scheduler plans in both directions (`src/shared/governance/event-job-catalogue.test.ts:509-643`). Job enqueue options come from the catalogue (`src/shared/jobs/job-policy.ts:18-80`), the operational contracts and scheduler plan are derived from the same rows (`src/shared/jobs/operational-catalogue.ts:89-167`), boot readiness rejects missing/extra handlers (`src/shared/jobs/readiness.ts:55-77`), and duplicate job registration throws (`src/shared/jobs/registry.ts:17-35`).

**Why it matters.** The old split-authority problem is substantially repaired: changing a job name/retry/schedule/capability without updating the runtime authority now creates a failing boundary rather than quiet drift.

**Recommendation.** Keep the event/job catalogue as the runtime source for job policy and readiness. Narrow the larger entry-point catalogue to generated inventory plus hand-authored semantic exceptions, as detailed in ARCH-I3.

**Cost/risk of the fix.** Keeping the runtime job authority is low risk and load-bearing. Narrowing the audit inventory is a moderate migration because release/gate consumers must move together.

### ARCH-A4 Container-owned registries removed the highest-risk blind overwrite

**Verdict: ACHIEVED.**

**Evidence.** `createContainer` constructs one `consumerRegistry` and its infrastructure builder constructs one `jobRegistry` (`src/composition.ts:245-255`; `src/composition/infrastructure.ts:38-45`), passes the consumer registry explicitly to every context registration contribution (`src/composition.ts:880-895`), and worker readiness requires the exact container listing rather than a process-global default (`src/shared/jobs/readiness.ts:33-47`). Duplicate consumer registration throws (`src/shared/outbox/consumer-registry.ts:73-91`) and duplicate job registration throws (`src/shared/jobs/registry.ts:17-35`). The process policy now refuses a second owner instead of silently overwriting it (`src/shared/auth/process-policy-binding.ts:20-70`).

**Why it matters.** A second composition no longer silently changes which consumers or job handlers the first process dispatches. This directly addresses a real pre-rewrite isolation/failure mode.

**Recommendation.** Keep the instance-owned registries and duplicate refusal. Finish the job by making every production process enter through its typed deployable builder (ARCH-S1), otherwise web/operator can still receive and mutate those registry objects.

**Cost/risk of the fix.** The registry work itself needs no change. The remaining risk lies in deployable reachability, not registry implementation.

## What is genuinely good

### ARCH-G1 The Inbox status transition is a credible atomic-fact vertical slice with a repairable consumer

**Verdict: GOOD.**

**Evidence.** This path is reachable from a real request boundary: the server function authorizes the request, obtains the Inbox public API, and calls the command (`src/contexts/inbox/server/inbox-status.ts:24-43`). The use case constructs `inbox.inbox_item.status_changed` and passes it into the command store (`src/contexts/inbox/application/use-cases/update-inbox-status.ts:156-215`). The command store opens one transaction, locks tenant/source head and item, updates authoritative head/item state, inserts the outbox row, commits, and only then performs best-effort bus publication (`src/contexts/inbox/infrastructure/inbox-command-store.ts:2139-2165,2265-2348`). The shared adapter refuses unregistered schemas, strips content, allowlist-validates payloads, and records tenant/property/source identity (`src/shared/outbox/event-adapter.ts:80-149`). Relay claims use leases/SKIP LOCKED, deterministic event job IDs, retry/backoff, and mark published only after BullMQ accepts (`src/shared/outbox/relay.ts:111-207`).

The Activity durable consumer maps the fact and applies it once (`src/contexts/activity/infrastructure/outbox-consumers.ts:591-618`); the delivery store commits replay authority, the tenant-scoped projection, and consumer receipt in one DB transaction (`src/contexts/activity/infrastructure/activity-delivery-store.ts:381-423`). A bounded recovery use case can rebuild from that authority (`src/contexts/activity/application/use-cases/recover-recent-activity.ts:55-121`) and a real operator command exposes report/apply modes (`scripts/ops/recover-recent-activity.ts:20-73`).

**Why it matters.** This is the right load-bearing shape: a source transaction survives process death, transport is an accelerator, the consumer is idempotent, and a projection has explicit repair authority. It is substantially stronger than the pre-rewrite bus-only Activity path.

**Recommendation.** Preserve this pattern and use it as the executable reference slice for other active fact families. Add a process-level crash experiment after the state/fact commit and before bus emit, then prove relay/consumer/recovery parity from an empty Activity projection; source inspection does not substitute for that experiment.

**Cost/risk of the fix.** The mechanism should be kept. The missing crash experiment costs a focused DB/Redis fixture and is low product risk; enabling/cutover policy is a separate higher-risk concern in ARCH-I1/I2.

### ARCH-G2 Sidecar runtime stages are materially narrower than the repository dependency graph

**Verdict: GOOD (source construction); built artifact unverified.**

**Evidence.** Google egress and admission build dedicated bundles and run bundle verifiers (`Dockerfile.google-egress-gateway:18-22`; `Dockerfile.google-execution-admission:18-21`). Their final stages remove package managers, copy only the named `dist-*` directory, run as `node`, and have a single bundle entry (`Dockerfile.google-egress-gateway:24-43`; `Dockerfile.google-execution-admission:23-37`). AI egress/admission follow the same final-stage pattern (`Dockerfile.ai-egress-gateway:27-47`; `Dockerfile.ai-execution-admission:23-35`).

**Why it matters.** The pre-rewrite risk was package-level architecture masquerading as a process trust boundary. A final image that receives only a verified bundle is a stronger boundary than shipping the repository and `node_modules` into every sidecar.

**Recommendation.** Keep the dedicated runtime stages and build-time bundle verifiers. Record the actual built-image module/file scan for the frozen release; Dockerfile intent is not evidence that the promoted image was built from it.

**Cost/risk of the fix.** Low if image scans already run in release automation; otherwise moderate CI/image-build time. No package split is required merely for aesthetics if final artifacts remain narrow and verified.

## What should be improved

### ARCH-I1 Google Import v2 admission is not coupled to its only dispatcher

**Verdict: IMPROVE — high.**

**Evidence.** The fixed ARC-02 contract says “import v2 cannot accept work without its dispatcher” (`docs/comprehensive-beta-implementation-program-2026-08-25.md:468-470`). The live capability snapshot has `property.import_gbp_v2` ON for all six properties (`docs/operations/capability-state-2026-09-02.md:73-78`). The server exposes `integrationPublicApi.imports.transact` whenever that use case exists; it does not check durable-runtime readiness (`src/contexts/integration/server/gbp-import.ts:67-72,215-217`). The transaction store inserts the import parent/items and one `integration.property_import.requested` fact in the same transaction (`src/contexts/integration/infrastructure/google-import-v2-store.ts:639-725`). The source itself states pending item dispatch is “driven exclusively” by that outbox event (`src/contexts/integration/application/google-import-v2-claim-reaper.ts:5-8`); only the durable consumer loads pending items and enqueues deterministic item jobs (`src/contexts/integration/infrastructure/outbox-consumers.ts:11-25`; `src/contexts/integration/application/google-import-dispatch.ts:78-136`).

Yet `OUTBOX_DISPATCHER_ENABLED` defaults to `false` (`src/shared/config/env.ts:318-322`), worker consumer registration/relay/dispatcher construction are conditional on that flag (`src/worker/index.ts:337-389`), and readiness explicitly skips durable consumer checks while it is off (`src/shared/jobs/readiness.ts:16-19,33-47`). The event catalogue still labels the durable-only family `enabled` (`src/shared/governance/event-job-catalogue.ts:2194-2211`). A 2026-08-19 release runbook says the live worker was changed to `true` and drained 14 events (`docs/operations/closed-beta-release-runbook-2026-08-19.md:287-301`), but this is historical evidence, not the 2026-09-02 value.

**Why it matters.** Dispatcher-off is accepted as a healthy worker posture while the web can return an accepted import whose items will never be enqueued until an operator re-enables and drains the relay. That blocks a real ON user journey and is exactly the readiness lie the plan named. The same global rollback switch also disables every unrelated durable consumer.

**Recommendation.** Delete optional dispatcher-off mode from production worker boot: production config must require it, always register/validate durable consumers, and keep record-only behavior as a per-consumer delivery policy rather than disabling the relay. Until that cutover lands, make Import v2 admission return `temporarily_unavailable` unless a release-scoped worker-readiness attestation proves relay + dispatcher + `integration.property-import-dispatch` registration for the same cell. Rollback of Import must disable `property.import_gbp_v2` before stopping the dispatcher.

**Cost/risk of the fix.** Code/config work is bounded, but rollout risk is high because enabling a retained backlog can fan out old import intents and other facts. Deterministic event/job IDs and receipts reduce duplication risk; stage with backlog counts, then observe dispatch/receipt parity before removing the flag.

### ARCH-I2 The Inbox record-only/shadow/switch state machine does not control durable dispatch

**Verdict: IMPROVE — medium.**

**Evidence.** The declared semantics are: record-only = bus primary/no durable consumption, shadow = both, switch = durable only (`src/shared/outbox/cutover-flags.ts:4-20,31-49`). The actual cutover state is passed only to Inbox's in-process bus registration; bus handlers are registered unless state is `switch` (`src/composition.ts:587-600`; `src/contexts/inbox/infrastructure/event-handlers/index.ts:35-50,89-96`). Inbox durable consumers are registered unconditionally whenever the global dispatcher is enabled (`src/contexts/inbox/build.ts:367-392`; `src/composition.ts:880-895`; `src/worker/index.ts:337-355`). The relay publishes every claimed outbox event without a family-mode filter (`src/shared/outbox/relay.ts:119-165,185-207`), and the dispatcher invokes every registered consumer for the event type (`src/shared/outbox/dispatcher.ts:243-278`). Therefore, with the global dispatcher on, `record-only` and `shadow` both execute bus plus durable Inbox paths; with it off, both execute only the bus. Only `switch` changes bus registration.

The worker comment claims the opposite—that enabling the dispatcher “relays and records without handing delivery” for default record-only Inbox families (`src/worker/index.ts:337-341`)—but no filter on that call path implements the claim. The event catalogue contains similarly stale “durable dispatch disabled” notes while marking families enabled (`src/shared/governance/event-job-catalogue.ts:369-414`).

**Why it matters.** The rollback/cutover control cannot produce the states its runbook names. Turning off the global dispatcher to simulate record-only also strands Import v2 and all other durable-only consumers; leaving it on silently dual-runs Inbox before an explicit shadow decision. Idempotency reduces duplicate projection risk but does not make rollout evidence or rollback truthful.

**Recommendation.** Make consumer activation an executable per-family policy used by both bus registration and durable consumer selection: `record-only` registers bus only, `shadow` registers both, and `switch` registers durable only. Keep the relay/dispatcher always on for durable-only families. At boot, compare resolved family modes with actual bus/durable registrations and fail on mismatch; delete comments/rows that assert a state not derived from that authority.

**Cost/risk of the fix.** Medium. Registration and readiness must change together, and retained outbox events need a defined activation watermark so entering shadow/switch does not unexpectedly replay the full historical backlog. Existing receipts/idempotency help, but a bounded parity rehearsal is required.

### ARCH-I3 Catalogue closure overstates semantic and executed reachability proof

**Verdict: IMPROVE — medium.**

**Evidence.** The two production catalogues are 9,392 lines and their direct guard tests are another 2,299 lines. Runtime measurement returned 542 entry rows, of which 443 claim `direct_declaration`, 61 `source_composed`, 38 `boot_registry`, and zero `declared_only`. The implementation assigns `direct_declaration` solely from entry kind/file and `source_composed` from a presumed build owner (`src/shared/governance/entry-point-catalogue.ts:874-891`). The tests then prove file existence, syntactic route/function discovery, source composition, tag literals, and registration tables (`src/shared/governance/entry-point-catalogue.test.ts:1132-1376`; `src/shared/governance/event-job-catalogue.test.ts:509-710`). For example, a producer is “honest” if the named file exists and contains the event type string (`src/shared/governance/event-job-catalogue.test.ts:536-546`).

Mutation census is 179 read-only, 139 `atomic_state_and_fact`, and 224 `local_only_with_reason`, with zero defects/debt. Those 363 mutation dispositions are generated from entry-kind/name sets and shared prose templates (`src/shared/governance/entry-point-catalogue.ts:549-722,848-871`), not from transaction/call-graph proof. This permits a row such as Import v2 to be `enabled` and atomically classified while its only consumer can be absent at healthy boot (ARCH-I1). The plan's bar is stronger: “every active row has an executed reachability test” and a producer→dispatcher→consumer→repair trace (`docs/comprehensive-beta-implementation-program-2026-08-25.md:272-285`).

**Why it matters.** The catalogue is useful as an inventory, but its vocabulary makes source declaration sound like runtime reachability and name-based assertions sound like atomicity evidence. That recreates the pre-review risk of false confidence at a larger scale.

**Recommendation.** Keep runtime-consumed job/event policy fields and generate mechanical inventory fields from AST/build output. Hand-author only semantic exceptions: mutation disposition, capability/action, retry/timeout, repair authority, and rollout state. For each active durable mutation family, attach evidence to one of three executable proof classes: transaction integration test, process boot/registry test, and crash/rebuild scenario; `direct_declaration` must not satisfy “executed.” Remove copied reason templates when no executable proof ID backs them.

**Cost/risk of the fix.** Moderate. It deletes maintenance burden but requires updating catalogue consumers and gates atomically. Risk is losing a useful inventory during migration; first generate and diff the current 542-row manifest, then cut over consumers before deleting hand-maintained mechanical rows.

### ARCH-I4 The durable envelope is still below the fixed ARC-01 contract

**Verdict: IMPROVE — medium.**

**Evidence.** ARC-01 requires event ID/type/version/time, tenant/property/cell, aggregate type/ID/version, causation, correlation, and command ID (`docs/comprehensive-beta-implementation-program-2026-08-25.md:443-449`). `ConsumerEvent` carries most transport fields but has no command ID or aggregate type; causation is documented as “Null today,” and aggregate version is optional (`src/shared/outbox/envelope.ts:26-75`). `buildConsumerEvent` obtains causation/version only if those keys survive in payload, otherwise writes `null` (`src/shared/outbox/envelope.ts:102-130`). The persisted outbox row has source context and aggregate ID but no command ID, aggregate type, aggregate version, or causation columns (`src/shared/outbox/infrastructure/outbox-repository.ts:41-52`; `src/shared/db/schema/outbox.schema.ts:15-65`). Aggregate ID is inferred by a field-name priority list and falls back to the event ID (`src/shared/outbox/event-adapter.ts:212-253`).

**Why it matters.** Consumers cannot generically fence stale aggregate versions or reconstruct a causal command chain; each family must encode equivalent fields ad hoc in payload or re-read current state. That weakens replay diagnosis and the plan's claim that versioning/idempotency are uniform runtime properties.

**Recommendation.** Add explicit envelope metadata to the domain-fact/outbox insert contract and schema: `commandId`, `causationId`, `aggregateType`, `aggregateId`, and `aggregateVersion`. Require command stores to supply them rather than inferring IDs from arbitrary field names; retain compatibility parsing only for already queued rows and remove it after the bounded drain window.

**Cost/risk of the fix.** Medium-to-high because 109 event families need classification and some aggregates are genuinely unversioned. Migrate active durable families first, mark truly unversioned facts explicitly, and avoid pretending a fallback event ID is an aggregate identity.

## What needs substantial change

### ARCH-S1 Deployable isolation is declared and tested but bypassed by production web/operator entry points

**Verdict: SUBSTANTIAL — high.**

**Evidence.** The process contract says web must not hold worker registration/operator repair, worker must not hold repair, operator must not hold registration, and exactly one complete container may be built per process (`docs/architecture/composition-and-process-boundaries.md:18-50`). `src/composition/deployables.ts` classifies keys by suffix/name, projects a full container, freezes it, and tracks one process occupancy (`src/composition/deployables.ts:28-65,77-120`). It exposes web/worker/operator builders (`src/composition/deployables.ts:123-135`).

Production reachability contradicts that design. Repository search for calls to `createWebContainer`, `createWorkerContainer`, and `createOperatorContainer` found the worker call (`src/worker/index.ts:116-127`), tests (`src/composition/deployables.test.ts:67-172`), and web/worker process fixtures (`src/shared/testing/process-fixtures/web-process.fixture.ts:14-20`; `src/shared/testing/process-fixtures/worker-process.fixture.ts:13-18`)—but no production web boot and no production operator call. Actual web/server functions call the global `getContainer()` singleton, which constructs raw `createContainer()` (`src/composition.ts:908-926`; example `src/contexts/inbox/server/inbox-status.ts:24-43`). Operator scripts do the same (examples `scripts/ops/gbp-subscribe.ts:49-60`; `scripts/ops/rebuild-projection.ts:36-40`).

A TypeScript AST census of `createContainer`'s returned object measured 69 static keys plus one simulation-only spread. The projection algorithm classifies 55 as shared, 10 worker-only, and only 4 maintenance-only, yielding nominal web/worker/operator surfaces of 55/65/59 keys. Actual web/operator receive all 69. The raw surface includes DB, pool, Redis, event bus, outbox repository, both registries, worker/maintenance/lifecycle runtimes, direct handlers, and repositories (`src/composition.ts:730-897`). `project()` then erases the mismatch with `as unknown as Container`, so every projected process is still typed as the full container (`src/composition/deployables.ts:52-65`).

**Why it matters.** This is not cosmetic layering: compromised/request code can reach worker registration, repair, raw persistence, and provider/runtime handles that the plan says must be absent. Operator processes can likewise register work. The occupancy assertion is not installed on either actual path, so “exactly one complete container per process” is not a production property there. Tests validate an unused surface and therefore provide false confidence.

**Recommendation.** Replace dynamic projection with three exact interfaces and construction roots: `WebContainer`, `WorkerContainer`, and `OperatorContainer`. Make the framework request singleton call `createWebContainer` (or an equivalent web-only constructor), and provide one operator harness that every ops command enters before receiving an `OperatorContainer`; the worker keeps `createWorkerContainer`. Do not build the full graph and delete keys afterward—construct only the contexts/capability groups needed by that process. Remove production exports of raw `getContainer`/`createContainer`, remove the `as unknown as Container` cast, and make worker/maintenance/registration objects unrepresentable in web types.

**Cost/risk of the fix.** High but tractable. There are 204 `getContainer()` calls across 61 non-test `src` files (AST census); a staged cutover can introduce a typed web accessor and migrate context server modules one context at a time. The main risks are discovering hidden request dependencies on worker/maintenance state and constructing duplicate process resources; the existing process fixtures should become actual entry-root smoke tests before raw access is deleted.

### ARCH-S2 Composition was split into files, not yet deepened into context-owned capabilities

**Verdict: SUBSTANTIAL — medium.**

**Evidence.** Production composition/bootstrap is 4,215 lines across 14 files: 991 in `src/composition.ts`, 924 in `src/bootstrap.ts`, 878 in `src/composition/google-provider-authority.ts`, and 1,422 in the other composition modules. The existing guard only pins `src/composition.ts` below 1,000 lines and claims that means the root does not hold implementation graphs (`src/shared/architecture/composition-container-boundary.test.ts:169-175`); moving graphs into sibling composition modules does not reduce total wiring depth.

A TypeScript import-declaration census over those production composition files found 58 runtime and 27 type-only imports from context `application/`, `domain/`, or `infrastructure/` internals. Examples include individual repositories/adapters/use cases in the root (`src/composition.ts:28-32,51-53,61,69-79`), eight Identity/Integration internals in Google provider authority (`src/composition/google-provider-authority.ts:60-70`), and 31 context infrastructure adapters in organization export/lifecycle wiring (`src/composition/organization-export-contributors.ts:19-52`). The latter explicitly chooses root-owned adapter construction to avoid a build-order cycle (`src/composition/organization-export-contributors.ts:9-13`). ESLint permits all context layers from composition (`eslint.config.js:997-1022`), while the standards say the composition root consumes capability groups only and never repositories or private wiring (`docs/standards.md:194-225`).

The returned container itself leaks infrastructure: DB/pool/Redis/event bus/outbox repo, queue/registry handles, and `notificationWorkerRuntime.notificationRepo/emailRepo/preferenceRepo` (`src/composition.ts:730-897`). Bootstrap then constructs Notification handlers from those repositories (`src/bootstrap.ts:784-900`) and Portal jobs from storage/upload stores (`src/bootstrap.ts:294-316`). Request code uses the same root as a service locator: an AST census measured 204 `getContainer()` calls across 61 non-test `src` files; the largest concentrations are Portal server modules and Notification/Identity server modules.

**Why it matters.** The root knows implementation topology instead of selecting deep, context-owned capabilities. Every repository/job change ripples through bootstrap/composition, private types remain globally navigable, and a line-count guard can pass while aggregate wiring grows. This is the “more architecture than reliable wiring” failure in a new file layout.

**Recommendation.** Move worker handler construction/registration into the owning context's `worker` group: Notification should expose `registerWorkerJobs(registry, transportPorts)`, Portal should register its image/cleanup jobs, and each context should retain its repositories. Root/bootstrap should receive only process resources, call context builds, and invoke named registration/lifecycle capabilities. Replace server-side `getContainer()` use with context-specific accessors returning only that context's public API plus shared request security. Tighten ESLint so composition can import context build/public contracts but not `domain/`, `infrastructure/`, or individual application use cases; name any unavoidable adapter as a narrow, expiring exception.

**Cost/risk of the fix.** High migration volume but mostly behavior-preserving. Move one context's worker registration at a time and keep boot-readiness parity as the acceptance test. The main risk is duplicating queues/repositories while moving ownership; pass shared process resources into builds and delete the old bootstrap construction in the same change.

### ARCH-S3 Five runtime construction cycles remain behind late-bound closures and a mutable deferred port

**Verdict: SUBSTANTIAL — medium.**

**Evidence.** Static imports are cycle-free, but construction order still contains forward references:

- Staff captures Portal responsibility lookups before Portal is built (`src/composition.ts:263-273`).
- Identity captures a Property policy lookup before Property is built (`src/composition.ts:293-301`).
- Identity captures Integration import/connector lifecycle operations before Integration is built (`src/composition.ts:302-313`).
- Integration captures Review queue admission before Review is built (`src/composition.ts:459-474`).
- Identity receives a `MemberAuthorityLifecyclePort` before its downstream implementation exists; after Property/Portal/Inbox are built, composition mutates the binding (`src/composition.ts:230-231,662-684`).

The deferred-port module explicitly says it exists because Identity is built before downstream contexts and exposes mutable `bound.implementation`; calls before binding fail at runtime (`src/composition/member-authority-lifecycle.ts:1-14,167-214`). The composition-root boundary permits this graph, so the zero-cycle Fallow result cannot see it.

**Why it matters.** Correctness depends on no build function invoking a captured dependency during construction and on one later mutation always occurring before the first request. Adding eager validation, startup repair, or a new callback can turn a source-cycle-free change into a boot-time temporal-dead-zone/“not bound” failure. It also prevents independent context construction and explains why private adapters remain in the root.

**Recommendation.** Redesign the cycles rather than adding more lazy refs. For cross-context lifecycle effects (member removal, organization closure), commit a versioned owning-context fact and let idempotent consumers coordinate downstream release. For synchronous reads, inject narrow repository-backed ports that can be constructed before either full context, or split a small read capability from the context that currently requires the reverse dependency. For queue admission, inject the shared queue/job contract rather than a later context's build output. Delete `createDeferredMemberAuthorityLifecycle` and every closure over a later `const` once the graph is a real DAG.

**Cost/risk of the fix.** High design/migration cost and medium operational risk because lifecycle ordering and failure recovery change. Migrate one cycle at a time with an executable crash/retry contract; the durable-fact approach adds eventual consistency, so request responses and repair commands must state that honestly.

## Proportionality ledger

The measured beta reality is one organization, six properties, 24 capabilities ON and 13 compile-time blocked (`docs/operations/capability-state-2026-09-02.md:1-15,29-34`). Against that scale:

| Machinery                   |                                                                                                                                                                              Measured cost | Risk reduction at 1 tenant / 6 properties                                                                        | Proportionality judgment                                                                                                                                                                   |
| --------------------------- | -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Composition/service locator |                                                      4,215 production LOC in 14 files; 69 raw container keys; 204 locator calls in 61 production files; 58 runtime private-context imports | Intended to isolate three process classes, but actual web/operator bypass it                                     | **Disproportionate and ineffective.** Replace with smaller typed process roots/context-owned registration rather than more composition modules.                                            |
| Entry/event/job catalogues  |        9,392 production LOC + 2,299 direct guard-test LOC; 542 entry rows + 109 event families + 38 job families = 689 rows/families; 179 operator commands; 47 denied-dark event families | Strong for job retry/schedule/readiness and drift discovery; weak for claimed atomic/executed semantics          | **Mixed.** Keep runtime job/event policy; generate mechanical inventory and require executable proof for active semantic claims.                                                           |
| Worker schedules/jobs       |                                                                 38 job families, 32 enabled, 26 scheduled (`src/shared/governance/event-job-catalogue.ts:3028-3031`; runtime census above) | Provider calls, retries, retention, and repair genuinely need async/fenced execution                             | **Potentially proportionate**, but only if one registry/worker is mandatory and health/readiness is truthful; 26 schedules deserve per-family operational evidence, not mere registration. |
| Durable outbox              |                               109 fact families, 75 with durable consumers; relay has leases, deterministic IDs, 8-attempt exponential retry (`src/shared/outbox/relay.ts:73-103,111-207`) | Prevents source/process crash loss and is justified for provider/import/notification effects even at small scale | **Load-bearing core, currently under-realized.** A default-off global dispatcher forfeits its risk reduction and couples unrelated rollbacks.                                              |
| Static boundary controls    |                                                                                          24 invalid + 14 allowed fixture cases; focused run 6.41 seconds; cross-context probe 3.88 seconds | Prevents new architectural debt at low feedback cost                                                             | **Proportionate—keep.** Expand to composition/private seams rather than adding another catalogue.                                                                                          |
| Sidecar trust boundaries    | Four principal dedicated AI/Google egress/admission images, each final stage carrying only a named bundle (`Dockerfile.ai-egress-gateway:27-47`; `Dockerfile.google-egress-gateway:24-43`) | Provider credentials/egress are high-impact even for one tenant                                                  | **Proportionate if built-image scans pass.** Tenant count does not make credential isolation optional.                                                                                     |

Measured-command provenance used above:

- TypeScript AST over non-test `src/**/*.{ts,tsx}`: `getContainer()` = **204 calls / 61 files**.
- TypeScript AST over `src/composition.ts`: `createContainer` return = **69 static keys + 1 conditional simulation spread**; projection classification = **55 shared / 10 worker / 4 maintenance**.
- TypeScript import AST over production `src/composition.ts` + `src/composition/*.ts`: **58 runtime + 27 type-only** imports of context application/domain/infrastructure internals.
- Line census: production composition/bootstrap = **4,215 lines / 14 files**; catalogue sources = **9,392 lines**; their two direct tests = **2,299 lines**.
- Runtime TS import of catalogue constants: **542 entry points, 109 events, 38 jobs** with the distributions reported in ARCH-A3; mutation dispositions = **179 read-only / 139 atomic / 224 local-only / 0 defect / 0 debt**.

## Unverified / needs a runtime check

1. **Current live dispatcher/cutover values.** `[UNVERIFIED]` Read the 2026-09-02 worker deployment variables for `OUTBOX_DISPATCHER_ENABLED` and every `DURABLE_CUTOVER_INBOX*` flag, then bind them to the running deployment SHA and boot log. The last repository evidence is historical (dispatcher true on 2026-08-19), while source comments/defaults say record-only/off (`docs/operations/closed-beta-release-runbook-2026-08-19.md:287-301`; `src/shared/outbox/cutover-flags.ts:31-34`).
2. **Import backlog/receipt state.** `[UNVERIFIED]` Query counts/oldest age for unpublished `integration.property_import.requested` facts, domain-event queue jobs, `integration.property-import-dispatch` receipts, and pending import items. This distinguishes a structural hazard from an already stranded live import.
3. **Crash recovery.** `[UNVERIFIED]` In an isolated DB/Redis fixture, kill after Inbox state+outbox commit and before bus publication, restart the real worker, and verify Activity projection plus consumer receipt; then clear the projection and run the real recovery command to parity. No server/DB/Redis was started in this review.
4. **Cutover behavior.** `[UNVERIFIED]` Boot process fixtures in record-only, shadow, and switch with dispatcher on and inspect actual bus/durable invocations. Source tracing predicts record-only = shadow; a runtime experiment should be the regression proof for ARCH-I2.
5. **Built image contents.** `[UNVERIFIED]` Build each production Docker target from the frozen SHA and run the SAFE-05 forbidden-tool/module/file scans against the final layer. Dockerfile source and verifier names are not promoted-image proof.
6. **Actual web/operator container keys.** `[UNVERIFIED at runtime, source-proven statically]` A safe process fixture should exercise the same initialization function as deployed web/operator and assert the exact key/type surface. Current fixtures call builders that production web/operator do not call.
7. **Full boundary suite.** `[UNVERIFIED]` Only the focused architecture checker, one cross-context ESLint probe, and production Fallow cycle scan ran here; full lint/build/gates were prohibited and are not claimed.
8. **Aggregate/version replay behavior.** `[UNVERIFIED]` For one versioned aggregate, deliver v2 then v1 through the real dispatcher and prove the consumer ignores/repairs the stale fact. The generic envelope currently cannot supply that invariant for all families.

## Opinion

The durable outbox, tenant/cell fences, narrow provider sidecars, and executable import boundaries are justified even for six properties because their failure modes are data loss, cross-tenant execution, or credential escape. The 69-key locator, 4,215-line composition graph, and 11,691-line hand-maintained catalogue/guard pair are not justified by this beta's scale when two deployable boundaries are not even on the production path. Prefer fewer, deeper context capabilities, always-on durable transport with per-family delivery modes, and generated inventories with a small semantic policy surface; do not add another governance catalogue to repair the existing catalogues.
