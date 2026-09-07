# Comprehensive implementation progress report

**Assessment date:** 2026-08-28  
**Branch:** `codex/comprehensive-program-continuation`  
**Observed HEAD:** `2be81e9c03c3`  
**Scope:** the accepted 42-package implementation program derived from the comprehensive review and the subsequent product grilling session

## Executive assessment

The program has made substantial implementation progress, but it is not yet a releasable beta candidate.

| Measure                                                     |                                Current result |
| ----------------------------------------------------------- | --------------------------------------------: |
| Packages with a provisionally complete local implementation |                                   **36 / 42** |
| Packages whose local implementation remains in progress     |                                    **6 / 42** |
| Packages verified against one immutable release candidate   |                                    **0 / 42** |
| Packages formally release-closed                            |                                    **0 / 42** |
| External-verification states                                | **26 blocked, 8 not started, 8 not required** |

The distinction matters. “Locally complete” means that the intended repository behavior is present and has focused development evidence. It does **not** mean that the package has passed the final, same-commit verification matrix, production-equivalent deployment checks, provider drills, legal approval, or its formal completion record.

The six implementation packages that remain open are:

1. `ARC-03` — composition-root and process-boundary decomposition.
2. `IBX-01` — Inbox legacy cutover evidence, complete history presentation, replay, and hosted proof.
3. `LIF-01` — full export, closure, erasure, and purge orchestration across all contexts.
4. `CNV-01` — evidence-led contraction of residual legacy surfaces and schema.
5. `LEG-01` — counsel-approved, publishable legal documents.
6. `REL-01` — executable live evidence, rollback orchestration, approval signing, and an actual Gate F run.

The zero formal-closure count is therefore not a statement that no work is done. It reflects the deliberately strict three-axis completion model: local implementation, immutable-candidate repository verification, and external verification must all be satisfied before a package closes.

## State of the working tree

The implementation is currently a very large, uncommitted integration tree. At final report verification, it contained:

- 1,561 changed tracked paths: 1,448 modified and 113 deleted;
- 886 untracked paths;
- 2,447 working-tree path records in total;
- no staged changes; and
- approximately 81,754 insertions and 94,564 deletions across the tracked diff.

This is the largest immediate delivery risk. Focused green tests are meaningful development evidence, but this tree cannot honestly be called an immutable candidate until it is reviewed, split or otherwise integrated safely, committed, and frozen at one exact SHA. No commit, push, deployment, Railway mutation, provider mutation, legal publication, or production-database operation was performed during this wave.

## Work completed in the latest implementation wave

### 1. Context ownership and architectural boundaries

The application has moved substantially away from a generic root service locator toward named, context-owned capabilities.

- Production consumers no longer use the generic `container.useCases` surface.
- Integration exposes exact, frozen public, worker, maintenance, lifecycle, and webhook runtimes.
- Identity exposes narrow `managerFacts`, `accountAdminAuthority`, and request facades; Property, Portal, Guest, and Activity receive only the authority each needs.
- Inbox’s remaining operations are grouped into explicit lifecycle and maintenance surfaces.
- Metric’s public Portal-lifetime contract is read-only; repair and rebuilding remain maintenance operations.
- Review publication reconciliation now crosses the boundary through a content-free candidate contract rather than a content-bearing repository.
- Review restore verification obtains recovery authority through the Review maintenance runtime instead of wiring Review infrastructure externally.
- Simulation mutation capabilities are absent from the production application container and are composed only by the dedicated testing container.

These changes materially improve least authority, testability, and context ownership. They do not finish `ARC-03`: the root composition remains very large, and several global runtime registries and framework/environment seams still need decomposition.

### 2. Inbox correctness and maintainability

The Inbox projection now handles the difficult ordering cases that previously made it unsafe to treat as an operational source of truth.

- Review create/update delivery converges to exact current state.
- An update arriving before create can bootstrap the item safely.
- Missing contiguous material revisions are reconstructed.
- Duplicate deliveries are harmless.
- Item state, handling cycles, transitions, response targets, facts, and delivery receipt are committed atomically.
- A delayed create after erasure produces a closed item with no response targets.
- Source fencing and source-specific authority are enforced.
- Lifecycle and maintenance operations now have explicit public seams.

This is a major advance, but `IBX-01` remains open because the legacy cutover/parity artifact, full cycle/assignment/escalation history presentation, full fresh-database replay matrix, and hosted end-to-end evidence are still absent.

### 3. Organization lifecycle foundations

The first real `LIF-01` vertical slice is implemented.

- Migration `0168_identity_organization_lifecycle_receipts.sql` adds append-only lifecycle command receipts.
- Export retrieval issuance history prevents a state sequence such as A → B → A from resurrecting an old retrieval token.
- Live lifecycle state, lineage, revision, tenant, and recovery requirements are checked.
- Identity supplies the first deterministic export contributor with CSV/JSON output and microsecond preservation.
- Account-admin authority and the active Organization binding are transactionally rechecked.
- Duplicate lifecycle provisioning and a Drizzle cleanup binding defect were corrected.
- Production export remains intentionally hard-fenced because recovery from a crash after upload but before completion has not yet been designed and proven.

This is intentionally not marked complete. Sixteen export contributors, all seventeen destructive lifecycle contributors, storage and schedule integration, Closure Center UI, reactivation, Property Erase, Organization Purge, privacy workflows, backup-erasure fencing, and counsel-approved retention rules remain.

### 4. Release machinery

The repository-side release system is stronger and more deterministic.

- The local runner, Docker, Buildx, and BuildKit versions are pinned and manifest-bound.
- Gate F performs stricter evidence joins and verifies sibling artifact digests.
- Typed contracts exist for deployed journeys, canary windows, recovery rehearsal, and promotion evidence.
- Action pin and container-image policy checks pass against the exact supported Node version.

`REL-01` remains open. There is no safe deployed-journey producer, executable canary sampler with an agreed duration, rollback/restore orchestrator with a human pause, normalized live-evidence importer set, authenticated approval envelope, validated legal checklist, immutable candidate, or live Gate F run.

### 5. Product decisions preserved from the grilling session

The following are governing product requirements for all remaining work. Later implementation must not quietly reverse them.

- A Portal is primarily a review gateway and secondarily a link tree.
- The guest gives a private 1–5 star rating first. The Google review opportunity follows; Google is not used as the source of the private Portal rating.
- The low-rating threshold defaults to 3 and is configurable per Portal.
- A low rating offers private feedback to the responsible managers **and** still offers Google review. The product does not block or suppress the Google option.
- The Portal creator is an owner by default. Notifications go only to the creator/owner and explicitly assigned managers, not every Property manager.
- The Google review destination should be derived from the Portal’s Property connection whenever available, avoiding repeated manual setup.
- Analytics are a core, always-on product function rather than an optional consent toggle inside the product.
- Goals cover scans, rating count, and rating average. They exist at both Portal and Portal Group scope because some Portals are ungrouped.
- Portal Groups provide the required grouping model; a separate Teams concept is not required.
- Recognition remains beta-dark.
- Contact Request remains beta-dark. That decision does not block the core rating/private-feedback/Google journey.
- Beta uses exactly one logical US Data Cell, `cell-us`. Rehearsal and production are isolated deployment profiles for that one cell, not extra regional cells.

## Integrated verification status

This section records development-tree verification, not immutable-candidate evidence.

| Gate                        | Exact environment                                    | Result                                                                             |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Full TypeScript check       | Node 22.23.2                                         | Passed: 3 projects / 3,729 modules                                                 |
| Full unit suite             | Node 22.23.2, explicit unit project                  | Passed: 1,150/1,150 files; 10,902 passed and 6 skipped; 0 failed                   |
| Full integration suite      | Node 22.23.2, brand-new isolated PostgreSQL database | Passed: 190/190 files and 1,034/1,034 tests; schema created through journal 169    |
| Full lint                   | Node 22.23.2                                         | Passed, including architecture, filename, component, Zod, and product-state checks |
| Full formatting check       | Node 22.23.2                                         | Passed                                                                             |
| Diff whitespace/error check | current tree                                         | Passed                                                                             |
| Technology-stack authority  | Node 22.23.2                                         | Passed: 41 package authorities, 13 Actions, 10 images, 1 governed exception        |
| GitHub Action pin authority | Node 22.23.2                                         | Passed: 78 action references                                                       |
| Container-image authority   | Node 22.23.2                                         | Passed: 10 Dockerfiles                                                             |

Focused evidence collected before the aggregate run includes:

- Integration context: 87 files / 732 tests.
- Identity: 62 files / 375 tests; dependent Property, Portal, and Guest matrix: 139 files / 1,218 tests.
- Inbox ordering and related paths: 90 focused unit tests, all six delivery permutations with duplicates, plus 50 related integration tests.
- Identity lifecycle: 88 files / 512 tests, 27 focused lifecycle tests, 19 fresh-database tests, and 10 schema tests.
- Review maintenance boundaries: 5 files / 47 tests.
- Simulation, Metric, and architecture boundaries: 4 files / 49 tests.
- Release implementation: 23 files / 237 tests, followed by exact-Node technology, Action-pin, and image checks.

The aggregate database verification deliberately required a final clean run. An initial run reused a disposable database and exposed both residual data and seven stale test-harness assumptions. A brand-new reproduction proved the five single-US cutover failures were contamination; the remaining fixtures were corrected to provide material Review revisions, current retention policy version 8, and the real Review response-target authority. A later run on that already-used database hit two Dashboard five-second budgets after a 5,010-Property cutover fixture. The final `fresh_b` database was confirmed absent, created and migrated from scratch, and run with no competing test process; all 1,034 integration tests passed. This final run, rather than either reused-database run, is the current development-tree result. All three explicitly named disposable verification databases were then removed; the configured default development database was not changed.

## Package-by-package assessment

Status terms:

- **Local complete** — intended repository behavior is provisionally implemented.
- **In progress** — material repository implementation remains.
- **Repository open** — every package must still be rerun and reviewed against the same immutable candidate.
- **External blocked/not started** — production-equivalent, provider, administrative, device, or legal evidence remains.

| Package   | Local status                            | External state | What remains before closure                                                                                                                                                                                              |
| --------- | --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FND-01`  | Local complete                          | Blocked        | Revalidate all 114 findings on the final candidate, sign the authority, and retain GitHub ruleset/required-check evidence.                                                                                               |
| `FND-02`  | Local complete                          | Not required   | Rerun ADR, capability, context, and data-fate authorities. The current governed-model count is 234, not the ledger’s stale 210.                                                                                          |
| `FND-03`  | Local complete                          | Not started    | Revalidate 496 entry points and retain deployed registration/delivery proof. Current split: 153 read-only, 125 atomic, 218 reasoned local-only; 397 direct, 61 source-composed, 38 boot-registered.                      |
| `FND-04`  | Local complete                          | Not started    | Rerun all oracles on the candidate, including real Redis/dispatcher/provider recovery and browser/container evidence.                                                                                                    |
| `SAFE-01` | Local complete; upload safely dark      | Blocked        | Object-store adversarial drill, Railway proxy/header proof, deployed cache/header proof, two-replica observation-loss drill, and security approval.                                                                      |
| `SAFE-02` | Local complete                          | Not started    | Hosted multi-device session revocation, real Railway forwarding-header behavior, and production anomaly disposition.                                                                                                     |
| `SAFE-03` | Local complete                          | Blocked        | Authorized reconciliation, lifecycle apply, restore, and erasure evidence.                                                                                                                                               |
| `SAFE-04` | Local complete                          | Blocked        | Deploy and verify Google gateway/admission/mTLS roles and run authorized recovery/rotation drills.                                                                                                                       |
| `SAFE-05` | Local complete                          | Not started    | Clean hosted install/build/test/image/SBOM/scan/signature proof. The current ownership scope is 3,729 TypeScript modules, not 3,086.                                                                                     |
| `ARC-01`  | Local complete                          | Not required   | Final candidate atomic fact, receipt, repair, and replay matrix.                                                                                                                                                         |
| `ARC-02`  | Local complete                          | Blocked        | Deployed worker restart, missed-schedule, poison-work, readiness, and last-success drills.                                                                                                                               |
| `ARC-03`  | **In progress**                         | Not required   | Decompose root composition/global registries, remove late environment and framework coupling, partition shared authorities, define sidecar boundaries, and prove isolated process composition.                           |
| `REG-01`  | Local complete                          | Blocked        | Execute a signed single-US cutover and prove all supported countries route to `cell-us` while dormant EU/global workloads are denied.                                                                                    |
| `REG-02`  | Local complete                          | Blocked        | Review/apply the exact Railway foundation plan, reconcile legacy configuration ownership, and rehearse rollback.                                                                                                         |
| `REG-03`  | Local complete tooling                  | Blocked        | Protected CI, one signed/scanned candidate, unchanged-digest promotion, staged migrations, and rollback without rebuilding.                                                                                              |
| `REG-04`  | Local complete                          | Blocked        | Enable and verify backups/PITR, isolated restore, fresh Redis, failover, and recovery objectives.                                                                                                                        |
| `PPL-01`  | Local complete                          | Blocked        | Production People reconciliation to zero unexplained rows and one-release contraction proof.                                                                                                                             |
| `GGL-01`  | Local complete                          | Blocked        | Bind the existing written Google confirmation into evidence and run push/import/reauthorization/credential-home/activation journeys in `cell-us`.                                                                        |
| `REV-01`  | Local complete                          | Blocked        | Production backfill, zero-difference shadow window, legacy mirror decision, restore/erasure proof, and recurring lifecycle approval.                                                                                     |
| `IBX-01`  | **In progress; substantially advanced** | Not started    | Signed legacy cutover/parity artifact, complete history presentation, full fresh-DB replay matrix, and hosted request/cache/full-journey proof.                                                                          |
| `RPL-01`  | Local complete                          | Blocked        | Live ambiguous-send recovery, provider observation, deletion/reopen, and deployed queue recovery.                                                                                                                        |
| `AI-01`   | Local complete                          | Blocked        | Deployed capability lifecycle, derivative erasure, provider, and worker-retirement drills.                                                                                                                               |
| `AI-02`   | Local complete                          | Blocked        | First-enable/caught-up proof, retirement of old workers, then separately reviewed compatibility-mirror contraction.                                                                                                      |
| `AI-03`   | Local complete                          | Blocked        | Live provider/admission, ephemeral-output, and human-adoption canaries.                                                                                                                                                  |
| `AI-04`   | Local complete                          | Blocked        | `REV-01` cutover plus `AI-02` coverage, then parity, partial-coverage, correction, retention, and schedule canaries.                                                                                                     |
| `NTF-01`  | Local complete                          | Not started    | Deployed database/Redis settlement, provider acceptance, outage/latency/lag, redrive, and repair evidence.                                                                                                               |
| `ACT-01`  | Local complete                          | Blocked        | Observe the legacy queue empty for its retention window, prove restore/rollback, and only then contract compatibility paths; history retention needs counsel.                                                            |
| `POR-01`  | Local complete                          | Not required   | Final Portal lifecycle, publication, manager responsibility, grouping, destination, and public-cache matrix.                                                                                                             |
| `GST-01`  | Local complete for rating-first beta    | Blocked        | Hosted Guest lifecycle/privacy evidence and counsel acceptance; Contact Request stays dark.                                                                                                                              |
| `MET-01`  | Local complete                          | Not required   | Final correction, rebuild, parity, and scale verification.                                                                                                                                                               |
| `GOA-01`  | Local complete                          | Not required   | Final three-measure/three-scope lifecycle, correction, notification, and UI verification.                                                                                                                                |
| `REC-01`  | Local complete and beta-dark            | Not required   | Keep Recognition off; historical schema removal belongs to evidence-led `CNV-01`, not reactivation.                                                                                                                      |
| `LIF-01`  | **In progress**                         | Blocked        | Sixteen export contributors, destructive contributions for all 17 contexts, crash recovery, production storage/schedules, lifecycle UIs/workflows, backup fences, and counsel-approved retention.                        |
| `EXP-01`  | Local complete                          | Blocked        | Production dormant-billing inventory, approved cleanup if non-empty, and retained empty-state evidence.                                                                                                                  |
| `EXP-02`  | Local complete                          | Not started    | Hosted tenant remount, query-scoping, form, and Inbox request-count journeys.                                                                                                                                            |
| `EXP-03`  | Local complete                          | Blocked        | Cross-browser evidence plus real iPhone/Android, VoiceOver, keyboard, high-contrast, and 400%/320px reflow checks.                                                                                                       |
| `OBS-01`  | Local complete                          | Blocked        | Sentry Germany configuration, privacy canary/test event, alert receipt, retention/access review, device evidence, and legal approval.                                                                                    |
| `GOV-01`  | Local complete                          | Blocked        | Frozen install, complete gates/images, current vulnerability/license data, signatures, and Railway runtime proof.                                                                                                        |
| `GOV-02`  | Local complete                          | Not required   | Rerun the 17-context standards, documentation, filename, boundary, entry-point, and data-fate matrix after convergence.                                                                                                  |
| `CNV-01`  | **In progress**                         | Not started    | Resolve the current Fallow findings; collect production row/FK/non-FK inventories, export/restore proof, and one verified release before physical schema drops.                                                          |
| `LEG-01`  | **In progress**                         | Blocked        | Three aligned v2 candidate drafts exist but are non-publishable pending counsel decisions on roles, lawful bases, rights, DPIA/regions, retention, processors/transfers, Google terms, staff metrics, and support terms. |
| `REL-01`  | **In progress**                         | Blocked        | Deployed-journey producer, canary sampler/duration, rollback orchestrator, live importers, signed approval envelope, legal checklist, and a real immutable-candidate Gate F run.                                         |

Every row above also has **repository verification open**. None should be labelled formally complete until the final candidate is frozen and the package’s section-16 completion record is produced.

## Detailed remaining implementation work

### `ARC-03`: finish the architectural decomposition

This is the highest-leverage code-quality package because it determines how safely the other remaining work can evolve.

Remaining seams include the roughly 1,800-line root composition, process-global database/Redis/queue/execution-policy registries, environment reads that occur too late, framework coupling, broad shared authorities, sidecar package boundaries, and missing proof that each deployable can compose only its own allowed capabilities.

The correct direction is to continue the context-owned facade pattern already established, not introduce another generic locator. Completion should include explicit composition modules per deployable, frozen capability shapes, dependency tests, boot tests, and a rule that production cannot import test/simulation mutation surfaces.

### `IBX-01`: close migration and operator experience gaps

The hard projection-ordering work is now present. Remaining work is less about the core reducer and more about proving transition from the legacy system and exposing the complete operational record.

Required outputs are a signed classification of legacy rows into exact, mappable, ambiguous, and orphan sets; parity evidence; complete cycle/assignment/escalation history in the manager experience; an empty-database replay through all relevant source histories; and hosted evidence covering requests, cache behavior, permissions, notifications, and the full journey.

### `LIF-01`: implement the whole lifecycle, not only the Identity slice

This package is the largest remaining functional body of work. It must be split by context under one common protocol so contributors can be implemented concurrently without creating a central god-service.

Each context needs deterministic export, retention classification, archive/restore/disconnect behavior where relevant, an idempotent destructive contribution, authorization and revision fencing, receipts, retries, and recovery semantics. The aggregate controller must safely handle the post-upload/pre-completion crash window before production export can be enabled.

### `CNV-01`: contract only after evidence permits it

Large obsolete islands have already been removed, including legacy Recognition mechanics, Team endpoints, obsolete Goal UI, false Activity abstractions, and old job/projection runtime. The remaining Fallow record still contains genuine API-surface and schema debt.

Physical database contraction is deliberately blocked on production inventories, explicit non-FK reference checks, export/restore proof, and at least one verified release. Removing compatibility schema earlier would reduce rollback safety and violate the accepted plan.

### `LEG-01`: turn aligned drafts into approved documents

The Privacy Notice, Internal Beta Agreement, and Google Access Disclosure are now internally aligned v2 candidate drafts. They are not publishable legal documents. Counsel must decide the unresolved roles, lawful bases, rights handling, DPIA/regional scope, retention classes, processors and transfers, Google authorization conditions/expiry, staff-metric treatment, and support commitments. Code should consume the eventual approved version IDs rather than silently treating drafts as approved.

### `REL-01`: turn contracts into executable release evidence

Gate F can bind evidence more strictly, but several evidence sources are still schemas without safe producers. The remaining implementation must collect deployed journeys and canary observations without fabricating proof, pause for human authorization before destructive rollback/restore, normalize live outputs, verify approval authenticity, and fail closed when legal approval is absent or stale.

Only after those pieces exist can the team freeze one candidate, promote unchanged digests, run Gate F without retry, and use its artifacts as formal completion evidence.

## Dependencies and safe concurrency

| Workstream                                | Can proceed concurrently with                                                               | Important blocking edge / ownership rule                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARC-03` composition decomposition        | Legal review, Inbox UI/history, lifecycle contributors in untouched contexts                | One owner at a time for root composition and shared runtime registries. Every dependent branch must rebase/revalidate after facade changes.                                                      |
| `IBX-01` history UI and legacy classifier | Legal review, context-specific lifecycle contributors, release evidence importers           | Coordinate changes to Inbox schemas, public API, and replay fixtures with one explicit owner. Hosted proof waits for a frozen deployable candidate.                                              |
| `LIF-01` context contributors             | Different contributors can own different bounded contexts; legal review can run in parallel | Freeze the contributor protocol first. Aggregate export/closure and migrations require central integration. Destructive activation waits for crash recovery, backup fences, and legal retention. |
| `REL-01` importers/orchestrator           | Legal review and non-overlapping functional code                                            | A real Gate F run waits for an immutable SHA, complete migrations, legal checklist, deployment, and stable evidence sources.                                                                     |
| `LEG-01` counsel decisions                | Nearly all repository implementation                                                        | Publication and any gate claiming legal approval wait for counsel. Google’s written confirmation must be attached as governed evidence.                                                          |
| External `cell-us` deployment drills      | Final documentation preparation                                                             | Blocked by candidate freeze, authorized Railway access, secrets/provider setup, backups, and migration plan. Only one logical cell is in scope.                                                  |
| `CNV-01` physical contraction             | Inventory/report tooling can proceed now                                                    | Actual drops wait for export/restore proof, one verified release, required retention windows, and rollback confidence.                                                                           |

## Issues and particularities requiring attention

### 1. The current tree needs an integration strategy before more broad parallel editing

The volume of uncommitted change makes attribution, review, rollback, and candidate proof difficult. The next implementation plan should define ownership by path/context, small integration checkpoints, and a freeze window. It should not ask multiple workers to edit the composition root, shared schema journal, or central status ledger simultaneously.

### 2. The configured default development database shows schema/journal drift

Two mistakenly broad test invocations reached migration setup against the configured default development database. Better Auth reported no change, then Drizzle stopped immediately because `guest_contact_requests.publication_snapshot_id` already existed. No tests ran, no destructive command ran, and no repair was attempted.

All subsequent database tests use the isolated disposable database `repkey_codex_rt_20260828_0942`. The default database needs a separate, explicit diagnosis comparing its migration journal with its actual schema. It should not be “fixed” implicitly during feature work.

### 3. The central status ledger is numerically stale

The status ledger remains the package authority, but several summaries predate the latest work. Current discovery reports 234 governed Drizzle models, 496 entry points, and 3,729 TypeScript modules, replacing historical counts of 210, 463, and 3,086. The summaries for `ARC-03`, `IBX-01`, `LIF-01`, `CNV-01`, `LEG-01`, and `REL-01` also understate recent progress.

The top-level status of those six packages should remain `in_progress`. The ledger should be refreshed only after the tree is frozen so that another moving-tree snapshot is not presented as candidate evidence.

### 4. External blockers are real work, not paperwork to waive

Railway behavior, backups/PITR, Redis recovery, provider observation, real devices, accessibility, security review, GitHub governance, Sentry regional/privacy configuration, Google evidence binding, and counsel approval cannot be manufactured by local tests. They require authorized environments and retained artifacts.

The user has written Google confirmation. That is valuable, but `GGL-01` still requires it to be bound to the release evidence and paired with live `cell-us` journeys.

### 5. Some “remaining” work must intentionally wait

`CNV-01` schema drops, the `AI-02` compatibility mirror, and the `ACT-01` compatibility view/drain handler should not be removed immediately. Their accepted closure criteria require a verified release, worker retirement, an observation/retention window, or export/restore proof. Waiting here is a safety property, not lack of progress.

### 6. Dark capabilities must stay dark

Portal upload, Contact Request, Recognition, and other explicitly dormant capabilities must not become reachable merely because supporting code or schema exists. Their activation gates remain independent. The core Portal rating/private-feedback/Google flow is not blocked by keeping those capabilities disabled.

## Recommended next checkpoint

The next honest checkpoint is not “mark all 42 complete.” It is:

1. Finish and review the six open local implementation packages, using strict path/context ownership.
2. Diagnose the default development database separately; keep all program verification on a disposable database.
3. Split or integrate the current tree into reviewable commits, select one exact SHA, and stop changing it.
4. Apply all migrations to a fresh database and run the complete type, lint, format, governance, unit, integration, browser, build, container, SBOM, vulnerability, and signature matrix on that same SHA.
5. Independently review the candidate and refresh the 42-row ledger from generated evidence.
6. Deploy that unchanged candidate to the single logical US beta cell, `cell-us`, under an authorized plan.
7. Run the provider, recovery, device, accessibility, observability, security, legal, and release drills; retain the resulting artifacts.
8. Close only the packages whose local, repository, and external axes all pass. Carry the rest explicitly without weakening their criteria.

This sequence preserves the product decisions from the grilling session and avoids equating a large amount of successful local implementation with production readiness.
