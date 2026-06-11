# Executive Summary — Reputation-Key Codebase Review

**Date:** 2026-06-10
**Branch:** feat/workspace (main @ 4405bec)
**Scope:** All 14 bounded contexts, shared infrastructure, UI components, routes, ADR compliance, test quality

---

## Review Coverage

| Category                                                               | Reports | Files Examined                       |
| ---------------------------------------------------------------------- | ------- | ------------------------------------ |
| Per-context deep dives (domain+app + infra+server)                     | 27      | ~350 src files                       |
| Cross-cutting (type safety, permissions, imports, events, composition) | 5       | ~500 src files                       |
| UI (primitives, layout/hooks, feature components)                      | 3       | ~100 component files                 |
| Doc accuracy (ADR compliance)                                          | 1       | 13 ADRs + CONTEXT.md files           |
| Test quality (scores + coverage gaps)                                  | 2       | 90 use-case modules, 22 test files   |
| Convergence (3 rounds × 2-3 agents)                                    | 6       | Highest-risk files from prior rounds |
| Baseline                                                               | 1       | Global census                        |
| **Total**                                                              | **45**  | **~800+ src files**                  |

---

## Total Findings by Severity

| Severity    | Raw Count | Deduplicated |
| ----------- | --------- | ------------ |
| **BLOCKER** | 56        | **25**       |
| **MAJOR**   | 241       | **95**       |
| **MINOR**   | 188       | **70**       |
| **NIT**     | 99        | **35**       |
| **Total**   | **584**   | **235**      |

> Raw count = every finding from every report. Deduplicated = same file+issue counted once regardless of how many reports flag it.

---

## Top 10 Highest-Risk Findings

These BLOCKERs affect security, tenancy, or data integrity.

### 1. [D7] BLOCKER — Goal findAllActive() loads all tenants' goals

- **File:** `goal.repository.ts:179-183`
- **Risk:** Cross-tenant data exposure. Returns every org's active goals with no orgId filter.
- **Fix:** Add `organizationId` parameter and WHERE clause.

### 2. [D7] BLOCKER — Notification email queue mutations lack orgId WHERE

- **Files:** `notification-email.repository.ts:112-151`
- **Risk:** `markSent`/`markFailed`/`markSkipped` operate on ID alone. Cross-tenant email queue mutation possible.
- **Fix:** Add `eq(organizationId, orgId)` to all WHERE clauses.

### 3. [SECURITY] MAJOR — Last-admin TOCTOU race condition

- **Files:** `remove-member.ts:44-60`, `update-member-role.ts:65-75`
- **Risk:** Concurrent requests can demote/remove the last admin, making org admin-less. No transaction or lock.
- **Fix:** PostgreSQL advisory lock keyed by organizationId.

### 4. [SECURITY] MAJOR — No rate limiting on auth endpoints

- **Files:** `organizations.registration.ts:63-87` (sign-in, register, password reset, create-org)
- **Risk:** Brute-force attacks on sign-in. Rate limiter exists in codebase but only applied to guest endpoints.
- **Fix:** Apply per-IP rate limiting to all auth server functions.

### 5. [D15] BLOCKER — Non-null assertions on .returning() can crash

- **Files:** `notification.repository.ts:49-51`, `notification-email.repository.ts:65`, `notification-preference.repository.ts:79`
- **Risk:** `.returning()` on INSERT can return empty array. Non-null assertion masks runtime crash.
- **Fix:** Guard `row[0]` before accessing.

### 6. [D11] BLOCKER — crypto.randomUUID() in domain layer across 8 contexts

- **Files:** `identity/events.ts`, `staff/events.ts`, `team/events.ts`, `guest/events.ts`, `portal/events.ts`, `property/events.ts`, `review/events.ts`, `metric/events.ts`
- **Risk:** Domain layer coupled to Node.js crypto. Non-testable, non-deterministic.
- **Fix:** Accept `eventId` as constructor argument or inject IdGenerator port.

### 7. [ARCH] BLOCKER — Portal and Goal build.ts return non-D4 shape

- **Files:** `portal/build.ts:187-196`, `goal/build.ts:95-112`
- **Risk:** Flat return objects instead of `{ publicApi, internal: { repos, useCases } }`. composition.ts accesses repos directly, breaking encapsulation.
- **Fix:** Wrap returns in D4 canonical shape.

### 8. [D8] BLOCKER — disconnectGoogle and updateConnectionVisibility missing permission checks

- **File:** `google-connections.ts:93-106,118-131`
- **Risk:** Any authenticated user can disconnect or modify visibility of integrations.
- **Fix:** Add `can(ctx.role, 'integration.manage')` guard.

### 9. [D3] BLOCKER — getInboxItemDetail and addInboxNote missing authorization gates

- **Files:** `get-inbox-item-detail.ts:28`, `add-inbox-note.ts:41`
- **Risk:** Use cases skip `can(role, 'inbox.read'/'inbox.write')` checks. CONTEXT.md documents permissions but code doesn't enforce.
- **Fix:** Add authorization checks before repo calls.

### 10. [D2] BLOCKER — GoalProgressUpdated and all Portal events missing eventId/correlationId

- **Files:** `goal/events.ts:35-44`, `portal/events.ts:17-131`
- **Risk:** Events missing required envelope fields. Breaks event tracing and correlation.
- **Fix:** Add `eventId` and `correlationId` fields and constructor generation.

---

## Findings by Dimension

```
Dimension                       Count  ██████████████████████████
D12 CONTEXT.md Accuracy          62    ████████████████████████████████████
D15 Error Handling               35    █████████████████████
D7 Multi-Tenancy                 24    ██████████████
D8 Server Functions              23    █████████████
D3 Use Cases                     18    ██████████
D11 Domain Purity                16    █████████
D5 Repository/Port Standards     14    ████████
D1 Architecture Boundaries       12    ███████
D2 Event Standards               11    ██████
D4 Build Functions                8    █████
SECURITY                         7    ████
D9 Routes/Loaders                 5    ███
D10 Components/Hooks              4    ██
D18 UI/UX Adherence               4    ██
ACCESSIBILITY                     3    ██
ARCH Shape                        2    █
DATA Integrity                    2    █
DOC/ADR                           2    █
TEST Quality                      2    █
```

---

## Findings by Context

```
Context              Count  ██████████████████████████
portal                 33    ██████████████████
identity               29    ████████████████
integration            23    ████████████
goal                   22    ████████████
dashboard              19    ██████████
staff                  19    ██████████
inbox                  18    █████████
review                 17    █████████
guest                  14    ████████
notification           14    ████████
property               14    ████████
team                   14    ████████
activity               13    ███████
metric                 11    ██████
shared/cross-cutting   41    ██████████████████████
UI/routes              28    ██████████████
```

---

## Recommended Fix Priority Order

### Phase 1 — Security & Data Integrity (Week 1)

1. **Add rate limiting to auth endpoints** — highest user-facing risk
2. **Fix last-admin TOCTOU race** — add advisory lock
3. **Add permission checks to disconnectGoogle/updateConnectionVisibility**
4. **Add authorization gates to inbox use cases** (getInboxItemDetail, addInboxNote)
5. **Guard .returning() non-null assertions** in notification repositories

### Phase 2 — Multi-Tenancy Hardening (Week 1-2)

6. **Add orgId to goal findAllActive()** or rename to findAllActiveAcrossTenants
7. **Add orgId to notification email queue mutations** (markSent/markFailed/markSkipped)
8. **Add orgId to notification emailRepo.findById()**
9. **Add orgId to UserLookupPort.findAssignedManagers()**
10. **Add orgId to goal getProgress/updateProgress**

### Phase 3 — Domain Purity (Week 2)

11. **Extract crypto.randomUUID() from all domain events** (8 contexts)
12. **Remove node:assert/strict from domain layers** (7 contexts)
13. **Fix sentinel empty-string IDs** in notification/activity constructors

### Phase 4 — Error Handling Cleanup (Week 2-3)

14. **Replace throw new Error with tagged errors** in infra repositories (goal, metric, review, inbox, dashboard, portal, integration)
15. **Add logging to silent catch blocks** (redis-new-counter, activity adapters, metric event handlers)
16. **Use catchUntagged consistently** in server functions (portal-groups, goals)
17. **Return Result from use cases** that currently throw (team, guest, staff, inbox, review, metric)

### Phase 5 — CONTEXT.md Drift (Week 3)

18. **Update all stale file listings** (12+ CONTEXT.md files have incomplete server/ layer trees)
19. **Fix root CONTEXT.md** — "Twelve bounded contexts" should be "Fourteen"
20. **Add missing events/fields** to CONTEXT.md event tables (review, identity, inbox)
21. **Fix permission/role name mismatches** in CONTEXT.md (identity, goal, notification)

### Phase 6 — Architecture Shape (Week 3-4)

22. **Fix portal and goal build.ts** to return D4 canonical shape
23. **Fix dashboard domain/types.ts** boundary violation (imports from application)
24. **Remove dead split server files** in goal context
25. **Remove duplicate server function exports** in portal context

### Phase 7 — Type Safety & Convention (Ongoing)

26. **Replace `as unknown as` casts** with proper branded ID constructors
27. **Add exhaustive never checks** to switch statements (goal helpers, domain roles)
28. **Use branded IDs in public API types** (portal, identity, property)
29. **Consolidate duplicate VALID_METRIC_KEYS** (metric context, 3 locations)

---

## Positive Findings — What the Codebase Does Well

### Architecture

- **Clean hexagonal layering** — All 14 contexts follow domain → application → infrastructure → server with strict boundary enforcement. ESLint `boundaries/dependencies` rule catches violations at CI time.
- **Composition root pattern** — `composition.ts` wires all 14 contexts through their `build.ts` functions. No service locator or global state.
- **Public API boundary** — Cross-context communication goes through `application/public-api.ts`. Event handlers correctly import from source context's public API. No cross-context domain or infrastructure imports in production code.

### Multi-Tenancy

- **baseWhere pattern** — Most repositories use `baseWhere(table, orgId)` enforcing `organization_id + deleted_at IS NULL` on every query.
- **Auth context propagation** — Server functions derive `organizationId` from `resolveTenantContext(headers)`, never from request body.
- **Tenant isolation tests** — Property, staff, guest, and team repositories have explicit cross-tenant isolation tests using two organizations.

### Error Handling

- **Tagged error pattern** — Domain errors use `_tag: 'XError'` + closed error code union. Server functions use `isXError()` type guards with `ts-pattern .exhaustive()` for status mapping.
- **catchUntagged safety net** — Most server functions use `catchUntagged(e)` as a final safety net for unexpected errors.

### Testing

- **94.4% use-case test coverage** — 85 of 90 use-case modules have test files.
- **High-quality test patterns** — In-memory repository fakes (18 in shared/testing), deterministic IDs/clocks, factory functions per test.
- **Domain test quality** — Rules, constructors, and errors tested exhaustively with 5.0/5.0 scores in multiple contexts.

### Observability

- **Every repo method traced** — `trace()` spans wrap all repository operations.
- **Server function tracing** — `tracedHandler` wraps all server functions.
- **Structured logging** — `getLogger().child()` with context objects used throughout.

### Permissions

- **O(1) Set-based permission lookup** — `can(role, permission)` uses pre-computed Set membership.
- **46 defined permissions** — Granular resource.action permissions across all contexts.
- **Compile-time Permission type** — Union type catches undefined permissions at build time.

### Codebase Health

- **Zero console.log** in production code.
- **Zero @ts-ignore** and zero @ts-expect-error.
- **Zero FIXME/HACK** markers.
- **Only 3 TODOs** — all tracked with specific fixes.
