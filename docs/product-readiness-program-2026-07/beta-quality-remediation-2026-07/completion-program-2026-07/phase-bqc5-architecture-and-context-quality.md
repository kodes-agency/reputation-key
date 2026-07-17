# BQC-5 — Clean Architecture and Context Quality

**Status:** `not_started`  
**Estimate:** 10–16 engineering days  
**Dependencies:** stable BQC-2, BQC-3, and BQC-4 interfaces  
**Unlocks:** trustworthy verification, lower Phase 17 change cost, maintainable beta operations

## 1. Outcome

Restore strict dependency direction and deepen the modules that currently spread policy, transaction, runtime, and query knowledge across callers. Reduce composition complexity, semantic schema drift, ambient runtime dependencies, dead controls, untested exports, and duplicated invariants without activating dark product features.

The goal is not more abstractions. A new interface is introduced only when it hides meaningful complexity and has a real production/test variation or protects a context seam.

## 2. Findings owned

- STD-P1-01 — application/outbox infrastructure dependency after BQC-3 cutover.
- STD-P1-04 — route-to-database operational metrics.
- STD-P1-06 — shallow architecture/schema checks.
- STD-P2-01 — Node-only crypto in domain/browser path.
- STD-P2-02 — semantic schema mismatch.
- STD-P2-03 — composition/worker shotgun surgery.
- STD-P2-04 — ambient wall clocks.
- STD-P2-05 — dead code, complexity, duplication.
- Architecture support for every other phase.

## 3. Starting quality baseline

The validation recorded:

- Fallow health 71/B;
- 120 functions over the configured complexity threshold;
- 386 untested files and 795 untested exports;
- 22 unused files, 190 unused exports, 14 boundary violations, and 24 stale suppressions;
- 9.7% duplication and 14,266 duplicated lines;
- duplicate `regression` keys in `.fallowrc.json`;
- global composition/boot/worker files around 591/349/325 lines;
- important intended controls present but unused.

Re-run after BQC-3 because removal of legacy event paths should reduce part of this baseline naturally.

## 4. Slices

### BQC-5.1 — Make architecture policy executable

- Translate `src/contexts/CONTEXT.md` into import/dependency rules enforced by ESLint and/or a module graph tool.
- Ban domain → Node/browser/runtime imports.
- Ban application → infrastructure and application → shared outbox/DB/BullMQ imports.
- Ban routes → DB/repository imports.
- Ban shared runtime → context server/domain implementation imports.
- Define permitted cross-context dependency only through explicit public application interfaces.
- Triage the 14 existing violations and remove them rather than suppressing them broadly.

Source scans may remain fast tripwires but cannot be the sole gate.

### BQC-5.2 — Per-context runtime modules

Replace global registration clusters with one runtime module per context that exposes only the pieces composition needs:

- server/application interface;
- registered jobs/consumers/schedules;
- readiness contributions;
- shutdown hook where required.

The global composition root selects enabled modules and supplies adapters. It does not import individual use cases, event handlers, or business rules. The worker receives one registry assembled from context modules; adding a job edits its context plus one registry declaration, not multiple switch statements.

Add composition characterization tests before splitting. Delete old global wiring only after behavior parity.

### BQC-5.3 — Runtime-neutral domain decisions

- Move review hashing out of `review/domain/rules.ts` behind the appropriate application/runtime seam, or use a deliberately universal pure implementation outside domain policy.
- Inject `Clock` or explicit `now` into replayable/domain decisions in Identity, Activity, Staff, Metric, Portal, Guest, Goal, and Badge.
- Inject ID generation/randomness where a deterministic test needs it.
- Keep domain results tagged and side-effect-free.
- Add a browser-reachability import test so Node-only modules cannot enter client code.

### BQC-5.4 — Semantic schema authority

Choose one schema authority and verify it against actual migrated PostgreSQL metadata. Cover:

- tables/columns/types/nullability/defaults;
- primary/unique/check constraints;
- foreign keys and cascade/restrict behavior;
- indexes, column order/direction, included columns, expressions, partial predicates;
- generated columns/triggers/views where present;
- migration journal continuity and supported upgrade path.

Include every migration, not only selected recent tables. Generate/compare SQL or query `pg_catalog`; do not rely on symbol presence. Add a process for intentional DB-only constructs with explicit ownership.

### BQC-5.5 — Deepen operational reads

Create `OperationsSnapshot` and governed Dashboard read interfaces. Move database/Redis construction out of routes. Consolidate source-eligibility, tenant/property scope, bounds, cache policy, and timeout behavior behind the owning interface.

Wire or remove the currently unused dashboard cache and health endpoint modules. Do not keep a second cache/read model beside the authoritative query path.

### BQC-5.6 — Cross-context/privacy cleanup

- Replace Guest infrastructure's import of a Portal domain error with a Guest-owned result or explicit public interface outcome.
- Remove shared event/queries modules that import context implementations; invert through registrations/public interfaces.
- Ensure Activity, Notification, Dashboard, Metric, and Staff consume content-free facts or authorized owning-context lookups.
- Confirm dark contexts cannot be pulled into enabled bundles through a convenient shared barrel.

### BQC-5.7 — Complexity burn-down

Rank the 120 complexity findings by enabled-path risk and change frequency. Refactor in this order:

1. `ExecutionPolicy` and authorization resolution after BQC-2 characterization.
2. Review/source lifecycle and import/sync commands.
3. Composition/bootstrap/worker registration.
4. Inbox/dashboard queries and UI orchestration.
5. Dark Goal/Badge/Portal modules only enough to enforce boundaries, determinism, and safe future maintenance.

Use domain decision tables/state machines and deep modules, not extraction of one-line pass-through functions. Each refactor must reduce what callers know and tests should move to the new interface.

### BQC-5.8 — Dead-code and control reconciliation

Classify every reported unused file/export as:

- real framework entry point;
- required control to wire in BQC-6/7;
- future dark-context code retained with owner/test;
- confirmed dead and removable;
- public interface retained for a documented consumer.

Specifically resolve security headers, dashboard cache, health endpoints, operator commands, web-vitals, and people/access models. Remove stale suppressions or give each a narrow rule, owner, reason, and expiry.

### BQC-5.9 — Duplication and consistency

Eliminate duplicated policy and domain invariants first: authorization assembly, capability mapping, source expiry predicates, event/job error handling, tenant predicates, and schema mappings. Extract only when the resulting module is deeper than the copies.

UI story/fixture duplication can remain when it improves clarity and is not policy-bearing. The beta target is <7% measured duplication and zero duplicated authorization/retention/routing decisions.

### BQC-5.10 — Context acceptance pass

#### Enabled/limited contexts

| Context      | Required architecture completion                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Identity     | Grant/public interface is sole access source; owner/session rules deterministic; invitation content stays owned  |
| Property     | Lifecycle and processing profile behind context command/query interfaces                                         |
| Integration  | Google adapter behind explicit port; jobs use JobRuntime/ProcessingRouter; no provider construction in use cases |
| Review       | ReviewSourceLifecycle and atomic command module are authoritative                                                |
| Inbox        | Content-free workflow projection and `applyOnce`; source detail via authorized Review lookup                     |
| Dashboard    | Governed bounded query/cache interface; no raw expired data or direct DB routes                                  |
| Metric       | Idempotent content-free rollup interface; no review-derived staff gamification                                   |
| Notification | Privacy-filtered in-app delivery module; outbound non-auth email absent/dark                                     |
| Activity     | Collaboration facts separated from security audit; no protected content payloads                                 |
| Staff        | Participation interface contains no authorization decision                                                       |

#### Dark contexts

| Context     | Required beta-quality treatment without activation                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Team        | Remove enabled-context coupling; deterministic domain; no registered active jobs/events                              |
| Portal      | Independent read/write/upload policy; remove direct BullMQ construction from application; public edge remains denied |
| Guest       | Remove Portal error dependency; public/session/media adapters remain unregistered/denied                             |
| Goal        | Split high-complexity build/use-case logic; injected clock; no active schedules/events                               |
| Badge       | Deterministic evaluation; no active awards/workers/events                                                            |
| Leaderboard | No active recompute/read/export paths; context interface remains isolated                                            |
| AI          | No implementation imports/provider/jobs; only approved governance interfaces may exist                               |

Full feature completion for dark contexts remains in the post-beta product plans.

## 5. Testing method

- Characterize the external interface before deepening.
- Test behavior through the new interface using real local substitutes for PostgreSQL/Redis and mocks only for true external providers.
- Delete shallow implementation tests that become redundant and brittle after interface tests cover the behavior.
- Add module-graph tests for production bundles and client reachability.
- Run semantic schema parity against fresh and upgraded PostgreSQL.
- Run mutation/property tests for high-risk pure domain decision tables where valuable.

## 6. Quality configuration

- Replace duplicate Fallow configuration keys with one documented regression policy.
- Gate new violations immediately and create an explicit burn-down baseline for existing confirmed findings.
- Add coverage thresholds by layer, including 100% branch/statement for pure domain rules and the master-plan changed-code budgets.
- Treat generated files, framework entry points, migrations, and type-only modules with explicit documented exclusions rather than ad hoc suppressions.

## 7. Evidence

- Before/after module graph and violation count.
- Semantic schema comparison report.
- Composition change-impact characterization.
- Runtime-neutral/client bundle proof.
- Context acceptance checklist for all 16 current contexts plus AI posture.
- Fallow triage register and before/after health/dead-code/duplication reports.

## 8. Exit matrix

| Criterion                                                                    | Required result |
| ---------------------------------------------------------------------------- | --------------- |
| Enabled paths have zero confirmed layer/cross-context violations             | Pass            |
| Routes do not construct DB/repository adapters                               | Pass            |
| Browser/domain paths contain no Node-only implementation                     | Pass            |
| Schema and migrations are semantically verified                              | Pass            |
| Context runtime modules replace global handler/job wiring                    | Pass            |
| Ambient time is removed from replayable/domain decisions                     | Pass            |
| Confirmed unused production controls are wired or removed                    | Pass            |
| All complexity/dead-code findings are triaged; enabled P0/P1 hotspots closed | Pass            |
| Repository duplication <7%; policy invariant duplication zero                | Pass            |
| Every context passes its enabled/dark architecture checklist                 | Pass            |

## 9. Out of scope

- Rewriting the application into microservices.
- A generic repository/unit-of-work framework.
- Product completion or activation of dark contexts.
- Cosmetic refactors without measurable depth, locality, or risk reduction.
