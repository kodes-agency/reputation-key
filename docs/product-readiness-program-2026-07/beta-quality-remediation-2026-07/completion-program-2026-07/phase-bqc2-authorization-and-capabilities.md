# BQC-2 — Authoritative Authorization and Capabilities

**Status:** `not_started`  
**Estimate:** 7–10 engineering days  
**Dependencies:** BQC-0  
**Unlocks:** BQC-3 execution policy, BQC-4 regional routing, BQC-6 beta workflow proof

## 1. Outcome

One fail-closed `ExecutionPolicy` decides whether an action may execute for an actor or system identity against an organization/property resource. BQC-2 makes it authoritative for interactive routes, server functions, commands, and public handlers, and defines the contract for delayed and operator execution. BQC-3 performs the delayed-runtime integration once; BQC-7 integrates the contract into the operator controls it implements.

Property participation, staff assignment, team membership, UI visibility, and possession of a queued job never imply authorization.

## Ownership mode

- BQC-2.1–2.4 and BQC-2.7: `IMPLEMENTS` the policy module, persistence, grants, interactive cutover, and policy operations.
- BQC-2.5: `IMPLEMENTS` the delayed/system policy contract only.
- BQC-2.6: `IMPLEMENTS` policy/server/command containment for dark contexts.
- BQC-3 `INTEGRATES` the BQC-2 interface into workers, consumers, schedules, job envelopes, and existing delayed-runtime triggers.
- BQC-7 `INTEGRATES` the same interface into newly implemented operator controls.
- BQC-6 `PROMOTES` the combined policy/runtime behavior into browser and release gates.

BQC-2 may reach `implementation_complete` when its module, interactive cutover, contracts, and lower-level tests are done. SPEC-P0-03 remains `evidence_pending` until BQC-3 delayed integration and BQC-6 browser evidence pass.

## 2. Findings owned

- STD-P1-02 — missing/fail-open property authorization.
- SPEC-P0-03 — capability/authorization not authoritative.
- Completion of STD-P0-01 after BQC-0 containment.
- Policy portions of SPEC-P1-01 and SPEC-P1-02.

## 3. Target deep module

`ExecutionPolicy` accepts a normalized decision request containing:

- authenticated principal or declared system execution identity;
- action/capability;
- organization and required property/resource identifiers;
- execution kind (`interactive`, `worker`, `consumer`, `schedule`, `operator`, `public`);
- purpose/consent class where required;
- current time and correlation ID.

It returns an allow decision or a typed deny with stable reason and policy version. The implementation hides role permissions, PropertyAccessGrant, cohort/allowlist, suspension, capability state, consent, owner invariants, caches, and decision audit.

Callers must not assemble `assignedPropertyIds`, branch on role, or separately call capability and authorization helpers in an order they can get wrong.

## 4. Slices

### BQC-2.1 — Canonical action/resource catalogue

- Inventory every route, server function, use case, job, consumer, schedule, operator command, public endpoint, and external side effect.
- Assign one canonical action and resource scope.
- Record capability, principal type, organization/property requirement, consent/purpose, and beta posture.
- CI fails when a new executable entry point lacks a catalogue row and policy test.

### BQC-2.2 — Persisted policy state

Implement authoritative persistence for:

- organization cohort and enabled non-core capabilities;
- property allowlist and suspension;
- PropertyAccessGrant with scope/source/lifecycle;
- policy/consent records needed by enabled features and future AI opt-in;
- policy version and content-free decision audit.

Use explicit constraints for tenant consistency and uniqueness. Define cache invalidation so revocation/suspension takes effect within a measured bound; protected external side effects use fresh/strong reads where required.

### BQC-2.3 — Wire PropertyAccessGrant

- Build the decision context from the identity-owned grant repository.
- Migrate legitimate pilot access from legacy staff assignments.
- Treat missing assigned scope as deny, never organization-wide allow.
- Remove staff/team/portal participation as authorization inputs.
- Protect last-owner/administrative invariants independently from property participation.

**Slice boundary for the current work:** BQC-2.3 does not migrate workers/consumers/schedules, change job envelopes, introduce `JobRuntime`, restructure global composition, rewrite the full browser suite, or perform general dead-code/complexity cleanup. It supplies the authoritative grant-backed decision data that those later owners consume.

### BQC-2.4 — Interactive production cutover

Migrate enabled Identity, Property, Integration, Review, Inbox, Dashboard, Notification, Activity, and Staff entry points to `ExecutionPolicy`. Pass the actual target property/resource. Remove bare permission/capability checks from migrated paths.

Keep a content-free shadow comparison only if necessary; never permit on disagreement. Record old/new decisions for synthetic identities, then delete the old path.

### BQC-2.5 — Delayed/system policy contract

**Mode:** `IMPLEMENTS`; BQC-3 owns production call-site integration.

- Define the normalized system principal, action, org/property/resource, purpose, initiator, policy-version, and correlation inputs required by delayed execution.
- Define when a fresh/strong policy read is mandatory immediately before a protected read or external side effect.
- Define typed outcomes for current allow, revoked/suspended/expired deny, missing scope, stale policy context, and unavailable policy state.
- Define the content-free decision/audit result consumed by `JobRuntime`.
- Provide deterministic contract fixtures and tests for workers/consumers/schedules to adopt.
- Record every delayed entry point awaiting BQC-3 integration in the action/resource catalogue.

Do not edit worker/consumer/schedule call sites or job envelopes in BQC-2.5. BQC-3 performs that migration once while it introduces the authoritative runtime.

### BQC-2.6 — Dark-context policy and interactive containment

**Mode:** `IMPLEMENTS`; BQC-3 owns delayed-runtime denial and BQC-6 owns direct-navigation/browser promotion.

For Team, Portal, Guest, Goal, Badge, Leaderboard, and AI:

- deny routes/loaders/server functions;
- deny commands and public handlers;
- deny exports/uploads/recomputation/external effects;
- render an intentional unavailable/not-found experience rather than a partially live shell;
- define denied actions for event handlers/jobs/schedules in the catalogue and BQC-2.5 contract;
- add policy/server/command negative tests, not positive E2E opened by global capability overrides.

BQC-3 must then prove the denied delayed work is unregistered or rejected by the runtime. BQC-6 reuses both matrices and adds browser/direct-navigation evidence.

### BQC-2.7 — Policy operations

Provide authenticated, least-privilege policy-administration workflows for allowlist, suspension, grant, revocation, and policy kill switches. Require reason, ticket/reference, expiry for temporary access, and audit outcome. Add a read-only policy diagnostic that explains decisions without exposing PII or secret configuration. This slice owns only policy administration; BQC-7 owns general runtime, redrive, repair, restore, and deployment operator commands.

## 5. Data migration

1. Expand policy/grant schema with constraints and versioning.
2. Backfill organizations/properties to explicit deny/default states.
3. Reconcile staff assignments to proposed grants; require review rather than blindly converting.
4. Shadow decisions in synthetic/staging data.
5. Switch enabled interactive paths.
6. Publish the stable delayed/system policy contract for BQC-3.
7. Remove legacy assigned-ID assembly and role/participation inference from migrated interactive paths.
8. Contract obsolete columns/helpers only after access-diff reports are empty and BQC-3 no longer consumes them.

Rollback is fail-closed: disable the affected capability and preserve decisions/audit. Do not restore a fail-open legacy policy.

## 6. Tests

### Decision matrix

Cover owner/admin/member/system/operator/public principals across:

- correct/wrong organization;
- correct/wrong/unassigned property;
- missing grant data;
- active/suspended/archived/disconnected property;
- allowlisted/not allowlisted organization/property;
- capability core/non-core/blocked;
- consent active/revoked/expired;
- current/stale policy version;
- all execution kinds.

### Production composition

- Exercise real server/use-case composition, not only the policy function; BQC-3 owns worker composition tests.
- Delete or corrupt scope context and prove deny.
- Open portal read in a test policy and prove write/upload still denied.
- Assert dark interactive actions remain denied through server/command entry points.

Delayed revocation, manual job enqueue, and worker-side denial are BQC-3 integration tests. Direct-navigation evidence is BQC-6.

### Tenancy

- Cross-org/property repository and server negative tests.
- Database constraints reject inconsistent org/property/grant relationships.
- Cache keys include tenant/policy identity and revocation invalidates them.

## 7. Evidence

- Complete action/resource catalogue.
- Migration/reconciliation report for grants.
- Interactive decision matrix and delayed/system policy contract fixtures.
- Dark-context policy/server/command negative matrix.
- Revocation/suspension latency measurement.
- Operator policy-change and rollback rehearsal.

## 8. Exit matrix

| Criterion                                                       | Required result |
| --------------------------------------------------------------- | --------------- |
| Every executable entry point has one action/resource policy row | Pass            |
| PropertyAccessGrant is authoritative                            | Pass            |
| Missing property/scope data denies                              | Pass            |
| Allowlist and suspension are persisted, not no-ops              | Pass            |
| Interactive routes/commands use the authoritative policy        | Pass            |
| Delayed/system contract is stable and accepted for BQC-3        | Pass            |
| Staff/team/portal participation grants no access                | Pass            |
| Dark policy/server/command paths fail closed                    | Pass            |
| Policy operations are authenticated and audited                 | Pass            |

The “every execution path” and “every dark context” program findings remain `evidence_pending` until BQC-3 delayed-runtime integration, BQC-6 browser promotion, and BQC-7 operator-control integration are accepted.

## 9. Out of scope

- Promoting dark features.
- Custom roles for beta.
- Implementing AI consent UI/provider calls; only the generic governed state needed for later work is permitted.
