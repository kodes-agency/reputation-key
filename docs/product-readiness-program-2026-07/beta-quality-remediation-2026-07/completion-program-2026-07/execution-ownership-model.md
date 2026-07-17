# BQC Execution Ownership Model

**Status:** authoritative planning rule  
**Purpose:** prevent the same behavior, module, or test harness from being implemented more than once across BQC phases.

## 1. Four ownership modes

Every slice must declare one primary mode.

| Mode          | Meaning                                                                                                    | Completion evidence                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `IMPLEMENTS`  | Creates or changes the authoritative production behavior/module and its local tests                        | Production cutover, superseded path removed, module-level evidence          |
| `INTEGRATES`  | Adopts an already-defined interface in a different execution path without reimplementing its policy        | Call-site/runtime integration tests and removal of the previous integration |
| `PROMOTES`    | Reuses existing behavior/tests and makes them authoritative release gates                                  | CI/browser/architecture gate fails when the existing behavior regresses     |
| `RE_EXECUTES` | Runs the same accepted behavior/harness in a production-like, scale, fault, recovery, or pilot environment | Environment-bound measurements and release evidence                         |

A slice may contain supporting work in another mode, but exactly one mode owns the production implementation. Supporting work must link to the owning slice and cannot create a parallel implementation.

## 2. Single-owner rules

1. A behavior has one `IMPLEMENTS` owner.
2. A production entry point is migrated once. Later phases test or re-execute it; they do not migrate it again.
3. Local tests are written with the implementation. BQC-6 promotes them into trustworthy gates and adds only missing cross-interface/browser coverage.
4. BQC-8 does not fix product behavior during an evidence run. A failure returns to the owning phase and requires a new candidate.
5. BQC-9 observes the accepted candidate. A material fix restarts the relevant acceptance and observation clock.
6. BQC-5 enforces dependency direction and cleans residual architecture debt; it does not rebuild BQC-1…4 modules.
7. Tests at a deep module's interface replace redundant shallow tests. Later gates invoke the same interface or production composition.

## 3. Authoritative artifact ownership

| Artifact/behavior                                                                                      | `IMPLEMENTS` owner | Later phase role                                                                                              |
| ------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Program status and immediate capability containment                                                    | BQC-0              | BQC-8 validates release binding                                                                               |
| Google source classification/lifecycle and content-copy removal                                        | BQC-1              | BQC-3 integrates durable facts; BQC-6 promotes UX/policy checks; BQC-8 re-executes at scale                   |
| `ExecutionPolicy`, policy persistence, PropertyAccessGrant, interactive authorization                  | BQC-2              | BQC-3 integrates delayed execution; BQC-6 promotes browser/negative gates; BQC-7 integrates operator controls |
| Context command/projection modules, `JobRuntime`, worker/consumer/schedule registration                | BQC-3              | BQC-5 enforces module rules; BQC-6 promotes integration/E2E gates; BQC-8 re-executes faults                   |
| `ProcessingRouter` and regional queue/worker/data/provider selection                                   | BQC-4              | BQC-7 implements topology; BQC-8 re-executes no-fallback failures                                             |
| Dependency rules, semantic schema gate, runtime-neutral domain, non-worker composition cleanup         | BQC-5              | BQC-6 promotes gates; BQC-8 validates candidate artifacts                                                     |
| Hermetic test environment, browser/component harness, CI promotion                                     | BQC-6              | BQC-8 uses the harness; BQC-9 uses accepted workflow checks                                                   |
| Containers/deployment, health/metrics, alerts, operator controls, security scans, backup configuration | BQC-7              | BQC-8 re-executes alerts/faults/restores and binds results to the candidate                                   |
| Scale/fault/recovery harness and immutable release evidence                                            | BQC-8              | BQC-9 consumes the accepted candidate/evidence                                                                |
| Real-property observation and final acceptance                                                         | BQC-9              | Phase 17/18 receives the handoff; no implementation is inherited implicitly                                   |

## 4. Overlap corrections

### BQC-2 and BQC-3

- BQC-2 implements the policy module, data, grants, interactive use, and the delayed-execution contract.
- BQC-3 integrates that interface into job envelopes, workers, consumers, schedules, and existing delayed-runtime triggers.
- BQC-7 integrates the same interface into the operator controls that BQC-7 implements; it does not ask BQC-3 to create those controls early.
- BQC-2 can reach `implementation_complete` before delayed integration; SPEC-P0-03 remains `evidence_pending` until BQC-3 and BQC-6 evidence pass.

### BQC-3 and BQC-5

- BQC-3 owns job/consumer/schedule registries and context runtime registration.
- BQC-5 owns remaining non-worker composition cleanup and verifies dependency direction.
- BQC-5 must not introduce a second runtime registry or reopen accepted job semantics.

### BQC-5 and BQC-6

- BQC-5 fixes runtime-neutral/browser-safe module dependencies, including the review hashing defect.
- BQC-6 makes browser/runtime errors fail the gate and proves the BQC-5 fix; it does not implement hashing again.

### BQC-2 and BQC-6 dark-context tests

- BQC-2 implements policy/server/command negative behavior and contract tests.
- BQC-3 implements delayed job/consumer/schedule denial.
- BQC-6 adds direct-navigation/browser evidence and promotes the combined matrix.

### BQC-7 and BQC-8

- BQC-7 implements deployment, alerts, operator commands, scans, and backup configuration with local/synthetic tests.
- BQC-8 re-executes them under integrated load/fault/restore conditions and does not maintain a second operations implementation.

## 5. Execution waves

The phase numbers remain acceptance identifiers; implementation uses these waves to reduce handoffs.

| Wave | Work                                                               | Rule                                                                                   |
| ---- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 0    | BQC-0                                                              | Truth and containment first                                                            |
| 1    | BQC-1; BQC-2.1–2.3; early BQC-5.1; minimum BQC-6.1/error detection | Establish data/policy interfaces and trustworthy guardrails                            |
| 2    | BQC-2.4–2.7; BQC-3; BQC-4                                          | BQC-3 owns every delayed-runtime edit; BQC-4 consumes stable runtime/policy interfaces |
| 3    | Remaining BQC-5; remaining BQC-6                                   | Residual architecture cleanup and evidence promotion, not feature reimplementation     |
| 4    | BQC-7 and BQC-8                                                    | Implement operations once, then re-execute at target conditions                        |
| 5    | BQC-9                                                              | Observe the immutable accepted candidate                                               |

## 6. Slice template

### 6.1 Slice ownership index

| Slice(s)                       | Primary mode  | Authoritative scope                                                                                   |
| ------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------- |
| BQC-0.1–0.5                    | `IMPLEMENTS`  | Status truth and immediate containment                                                                |
| BQC-1.1–1.7                    | `IMPLEMENTS`  | Source-data governance and lifecycle                                                                  |
| BQC-2.1–2.4                    | `IMPLEMENTS`  | Catalogue, policy persistence, grants, interactive cutover                                            |
| BQC-2.5                        | `IMPLEMENTS`  | Delayed/system policy contract only                                                                   |
| BQC-2.6–2.7                    | `IMPLEMENTS`  | Interactive/dark policy containment and policy operations                                             |
| BQC-3.1                        | `IMPLEMENTS`  | Runtime/event/job registry                                                                            |
| BQC-3.2                        | `INTEGRATES`  | BQC-2 policy in workers/consumers/schedules and existing delayed-runtime triggers                     |
| BQC-3.3–3.9                    | `IMPLEMENTS`  | Atomic commands/projections, JobRuntime behavior, cutover                                             |
| BQC-4.1–4.6                    | `IMPLEMENTS`  | ProcessingRouter and regional execution selection/proof                                               |
| BQC-5.1–5.9                    | `IMPLEMENTS`  | Guardrails, semantic schema, runtime-neutral and residual architecture cleanup                        |
| BQC-5.10                       | `PROMOTES`    | Context architecture acceptance; behavior gaps return to BQC-1…4                                      |
| BQC-6.1–6.4                    | `IMPLEMENTS`  | Verification environment/component/browser diagnostics harness                                        |
| BQC-6.5–6.8                    | `PROMOTES`    | Existing workflows/policy/runtime into E2E/a11y/performance gates; add only missing verification code |
| BQC-6.9                        | `IMPLEMENTS`  | Coverage and test-quality gate policy                                                                 |
| BQC-7.1–7.8                    | `IMPLEMENTS`  | Production operations/security/observability controls                                                 |
| BQC-8.1 and 8.8                | `IMPLEMENTS`  | Executable evidence harness and release-bundle validator                                              |
| BQC-8.2–8.7                    | `RE_EXECUTES` | Accepted product/operations behavior under scale/fault/recovery/final-artifact conditions             |
| BQC-9 P0–P3                    | `RE_EXECUTES` | Immutable candidate under production synthetic and real-property observation                          |
| BQC-9 final acceptance/handoff | `PROMOTES`    | Accepted candidate to internal beta and later AI planning baseline                                    |

### 6.2 Required brief fields

Every implementation brief/PR declares:

- ownership mode;
- authoritative artifact/behavior owner;
- interface consumed or changed;
- superseded path removed;
- local tests created by the owner;
- later phases that will promote or re-execute the same evidence;
- explicit non-goals preventing adjacent-phase work.

If two open slices both claim `IMPLEMENTS` for the same artifact or call site, work stops until ownership is corrected.
