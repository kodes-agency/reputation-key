# BQC-2 — Authoritative Authorization and Capabilities

**Status:** `not_started`  
**Estimate:** 8–12 engineering days  
**Dependencies:** BQC-0  
**Unlocks:** BQC-3 execution policy, BQC-4 regional routing, BQC-6 beta workflow proof

## 1. Outcome

One fail-closed `ExecutionPolicy` decides whether an action may execute for an actor or system identity against an organization/property resource. The same policy is used by routes, server functions, commands, workers, consumers, schedules, public handlers, and operator commands.

Property participation, staff assignment, team membership, UI visibility, and possession of a queued job never imply authorization.

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

### BQC-2.4 — Interactive production cutover

Migrate enabled Identity, Property, Integration, Review, Inbox, Dashboard, Notification, Activity, and Staff entry points to `ExecutionPolicy`. Pass the actual target property/resource. Remove bare permission/capability checks from migrated paths.

Keep a content-free shadow comparison only if necessary; never permit on disagreement. Record old/new decisions for synthetic identities, then delete the old path.

### BQC-2.5 — Delayed/system execution cutover

- Every job envelope declares action, org/property, policy version at enqueue, and system/user initiator where relevant.
- Workers/consumers/schedules re-authorize current policy immediately before protected reads or side effects.
- Suspension, disconnect, consent revocation, and cohort removal stop pending work with a typed state.
- A stale allow decision in a queued job never overrides current deny state.
- Operators use named identities and audited actions; no direct script bypass of policy.

### BQC-2.6 — Dark-context containment matrix

For Team, Portal, Guest, Goal, Badge, Leaderboard, and AI:

- deny routes/loaders/server functions;
- deny commands and public handlers;
- do not register or execute event handlers/jobs/schedules unless the runtime itself enforces deny;
- deny exports/uploads/recomputation/external effects;
- render an intentional unavailable/not-found experience rather than a partially live shell;
- use negative tests, not positive E2E opened by global capability overrides.

### BQC-2.7 — Policy operations

Provide authenticated, least-privilege operator workflows for allowlist, suspension, grant, revocation, and kill switches. Require reason, ticket/reference, expiry for temporary access, and audit outcome. Add a read-only policy diagnostic that explains decisions without exposing PII or secret configuration.

## 5. Data migration

1. Expand policy/grant schema with constraints and versioning.
2. Backfill organizations/properties to explicit deny/default states.
3. Reconcile staff assignments to proposed grants; require review rather than blindly converting.
4. Shadow decisions in synthetic/staging data.
5. Switch enabled interactive paths.
6. Switch delayed/system paths.
7. Remove legacy assigned-ID assembly and role/participation inference.
8. Contract obsolete columns/helpers only after access-diff reports are empty.

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

- Exercise real server/use-case/worker composition, not only the policy function.
- Delete or corrupt scope context and prove deny.
- Revoke while a job is queued and prove no side effect.
- Open portal read in a test policy and prove write/upload still denied.
- Assert every dark action remains denied when its UI is directly navigated or its job is manually enqueued.

### Tenancy

- Cross-org/property repository and server negative tests.
- Database constraints reject inconsistent org/property/grant relationships.
- Cache keys include tenant/policy identity and revocation invalidates them.

## 7. Evidence

- Complete action/resource catalogue.
- Migration/reconciliation report for grants.
- Interactive and delayed decision matrices.
- Dark-context negative matrix.
- Revocation/suspension latency measurement.
- Operator policy-change and rollback rehearsal.

## 8. Exit matrix

| Criterion                                                               | Required result |
| ----------------------------------------------------------------------- | --------------- |
| Every executable entry point has one action/resource policy row         | Pass            |
| PropertyAccessGrant is authoritative                                    | Pass            |
| Missing property/scope data denies                                      | Pass            |
| Allowlist and suspension are persisted, not no-ops                      | Pass            |
| Routes, commands, workers, consumers, schedules, operators share policy | Pass            |
| Queued work re-checks current policy                                    | Pass            |
| Staff/team/portal participation grants no access                        | Pass            |
| Every dark context fails closed across all paths                        | Pass            |
| Policy operations are authenticated and audited                         | Pass            |

## 9. Out of scope

- Promoting dark features.
- Custom roles for beta.
- Implementing AI consent UI/provider calls; only the generic governed state needed for later work is permitted.
