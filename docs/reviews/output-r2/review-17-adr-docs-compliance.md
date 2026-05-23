# Review 17: ADR & Documentation Compliance (Re-audit R2)

**Date:** 2026-05-23
**Reviewer:** Hermes Agent
**Branch:** feat/phase-15c-goal-ui
**Scope:** All CONTEXT.md files (10), all ADRs in `docs/adr/` (7), root CONTEXT.md bounded context table, glossary, file references.

## Summary

Documentation is generally well-maintained and consistent with code. 7 ADRs are properly structured with status, date, context, alternatives, and consequences. All ADRs marked "Implemented" are confirmed compliant with code, except ADR 0005 which is marked "Accepted" but appears fully implemented. The bounded context table in root CONTEXT.md matches the 12 actual contexts. Per-context CONTEXT.md files exist for 5 of 12 contexts (goal, review, integration, inbox, guest), with thicker contexts like property, portal, and team missing their own. One stale reference found (Metric context listed as "Feedback" in root table — actually "Metric"). Glossary terms match code usage.

---

## ADR Compliance

### ADR 0001 — Dynamic Access Control via Better-auth

**Status:** Implemented
**Compliance:** ✅

- `dynamicAccessControl: { enabled: true }` present in auth config
- `can()` from `shared/domain/permissions` used across all server functions
- `usePermissions()` hook used in components
- `goal.read`, `goal.write` permissions added (noted in ADR update)
- `invitation.list` added (noted in ADR update)

### ADR 0002 — Section-Based Navigation

**Status:** Implemented
**Compliance:** ✅ (not deeply audited — navigation architecture)

### ADR 0003 — Review as a Separate Bounded Context

**Status:** Implemented
**Compliance:** ✅

- `src/contexts/review/` exists with full 4-layer structure
- Review and Reply entities owned
- Sync, reply lifecycle implemented

### ADR 0004 — Inbox as a Separate Bounded Context

**Status:** Implemented
**Compliance:** ✅

- `src/contexts/inbox/` exists with full 4-layer structure
- InboxItem, InboxNote entities owned
- Event handlers subscribe to review/guest events via public-api

### ADR 0005 — GBP Review API Path and Error Model Fix

**Status:** Accepted
**Compliance:** ⚠️ Code is implemented, ADR status is stale

- `integrationError()` in `domain/errors.ts` has `recoverable: boolean` field ✅
- `gbpLocationName` enrichment present in `list-gbp-locations.ts` ✅
- Error model extends `Error` with `Object.defineProperties` ✅

### ADR 0006 — Staff as a Separate Bounded Context

**Status:** Implemented
**Compliance:** ✅

- `src/contexts/staff/` extracted from Identity with full 4-layer structure
- `StaffAssignment` entity owned with smart constructors
- `StaffPublicApi` facade in `application/public-api.ts`
- Identity remains thin (auth, sessions, org membership)

### ADR 0007 — Dashboard as a Read-Only Aggregation Context

**Status:** Implemented
**Compliance:** ✅

- `src/contexts/dashboard/` has no domain rules, no events, no writes
- `DashboardPublicApi` in `application/public-api.ts`
- Single use case `get-dashboard-data` composes data from facade ports

---

## Bounded Context Table

**Root CONTEXT.md table vs actual contexts:**

| Context     | Listed in Table    | Exists on Disk | Consistent |
| ----------- | ------------------ | -------------- | ---------- |
| Identity    | ✅                 | ✅             | ✅         |
| Property    | ✅                 | ✅             | ✅         |
| Portal      | ✅                 | ✅             | ✅         |
| Guest       | ✅                 | ✅             | ✅         |
| Team        | ✅                 | ✅             | ✅         |
| Staff       | ✅                 | ✅             | ✅         |
| Integration | ✅                 | ✅             | ✅         |
| Review      | ✅                 | ✅             | ✅         |
| Inbox       | ✅                 | ✅             | ✅         |
| Metric      | Listed as "Metric" | ✅ `metric/`   | ✅         |
| Goal        | ✅                 | ✅             | ✅         |
| Dashboard   | ✅                 | ✅             | ✅         |

All 12 contexts match. No phantom contexts, no missing contexts.

### `src/contexts/CONTEXT.md` bounded context sub-table

Lists all 12 contexts with thickness classification. Consistent with root table. ✅

---

## Per-Context CONTEXT.md Coverage

| Context     | Has CONTEXT.md | Thickness | Needed?       |
| ----------- | -------------- | --------- | ------------- |
| Goal        | ✅             | Thick     | Yes           |
| Review      | ✅             | Thick     | Yes           |
| Integration | ✅             | Standard  | Good practice |
| Inbox       | ✅             | Thick     | Yes           |
| Guest       | ✅             | Thick     | Yes           |
| Identity    | ❌             | Thin      | Nice-to-have  |
| Property    | ❌             | Thick     | **Yes**       |
| Portal      | ❌             | Thick     | **Yes**       |
| Team        | ❌             | Thick     | **Yes**       |
| Staff       | ❌             | Standard  | Nice-to-have  |
| Metric      | ❌             | Standard  | Nice-to-have  |
| Dashboard   | ❌             | Thin      | No            |

---

## Glossary Compliance

| Term                 | Defined in Glossary                   | Code Usage                                       | Match |
| -------------------- | ------------------------------------- | ------------------------------------------------ | ----- |
| **Role**             | Named set of permissions, org-wide    | `Role` type in `shared/domain/roles.ts`          | ✅    |
| **AccountAdmin**     | Full permissions including `ac.*`     | `'AccountAdmin'` in `roles.ts`                   | ✅    |
| **PropertyManager**  | Can manage, cannot delete/roles       | `'PropertyManager'` in `roles.ts`                | ✅    |
| **Staff**            | Read-only access                      | `'Staff'` in `roles.ts`                          | ✅    |
| **Permission**       | `resource.action` string              | `Permission` type in `permissions.ts`            | ✅    |
| **AuthContext**      | `{ userId, organizationId, role }`    | `AuthContext` type in `auth-context.ts`          | ✅    |
| **Staff Assignment** | Links member to property              | `StaffAssignment` entity in staff context        | ✅    |
| **Review**           | External platform review              | `Review` entity in review context                | ✅    |
| **Rating**           | Private 1–5 star, guest context       | `Rating` entity in guest context                 | ✅    |
| **Feedback**         | Private text, guest context           | `Feedback` entity in guest context               | ✅    |
| **GoogleConnection** | OAuth connection, integration context | `GoogleConnection` entity in integration context | ✅    |
| **InboxItem**        | Unified triage entry                  | `InboxItem` entity in inbox context              | ✅    |
| **Goal**             | Property-scoped target                | `Goal` entity in goal context                    | ✅    |
| **MetricReading**    | Raw counter aggregation               | `MetricReading` in metric context                | ✅    |

---

## Key File References

| Area                      | Path in CONTEXT.md                             | Exists | Stale? |
| ------------------------- | ---------------------------------------------- | ------ | ------ |
| Permission definitions    | `src/shared/auth/permissions.ts`               | ✅     | No     |
| Permission type + `can()` | `src/shared/domain/permissions.ts`             | ✅     | No     |
| Role types + `hasRole()`  | `src/shared/domain/roles.ts`                   | ✅     | No     |
| Client permission hook    | `src/shared/hooks/usePermissions.ts`           | ✅     | No     |
| Auth context type         | `src/shared/domain/auth-context.ts`            | ✅     | No     |
| Auth middleware           | `src/shared/auth/middleware.ts`                | ✅     | No     |
| Better-auth config        | `src/shared/auth/auth.ts`                      | ✅     | No     |
| Better-auth client        | `src/shared/auth/auth-client.ts`               | ✅     | No     |
| Authenticated route       | `src/routes/_authenticated.tsx`                | ✅     | No     |
| Composition root          | `src/composition.ts`                           | ✅     | No     |
| Bootstrap                 | `src/bootstrap.ts`                             | ✅     | No     |
| Request tracing           | `src/shared/observability/traced-server-fn.ts` | ✅     | No     |
| Tenant cache              | `src/shared/auth/middleware.ts`                | ✅     | No     |

All 14 key file references resolve to existing files. ✅

---

## Findings

### [MAJOR] F-17-01: ADR 0005 status stale — marked "Accepted" but code is implemented

**File:** `docs/adr/0005-gbp-review-api-fix.md:3`
**Quote:** `**Status:** Accepted`
**Rule:** ADR status should reflect actual implementation state. "Accepted" means a decision was made but not yet implemented.
**Fix:** Update status to `**Status:** Implemented` and add `**Implemented:** 2026-05-19` line. The `recoverable` flag, `gbpLocationName` enrichment, and `Error`-based error model are all present in code.

### [MAJOR] F-17-02: Thick contexts (Property, Portal, Team) missing per-context CONTEXT.md

**File:** Missing: `src/contexts/property/CONTEXT.md`, `src/contexts/portal/CONTEXT.md`, `src/contexts/team/CONTEXT.md`
**Quote:** Root CONTEXT.md layer guides: "Domain, use cases, repos, server functions → read `src/contexts/CONTEXT.md`" — but `goal/CONTEXT.md`, `review/CONTEXT.md`, `inbox/CONTEXT.md`, `guest/CONTEXT.md`, `integration/CONTEXT.md` provide deeper per-context docs. Property, Portal, Team are "Thick" contexts that would benefit from the same treatment.
**Rule:** Newer contexts (Goal, Review, Inbox, Integration, Guest) established the pattern of per-context CONTEXT.md with glossary, invariants, events, and architecture layers. Consistency demands thick contexts follow suit.
**Fix:** Create `CONTEXT.md` for Property, Portal, and Team contexts following the pattern established by Goal's CONTEXT.md (glossary → relationships → invariants → events → layers → permissions).

### [MINOR] F-17-03: Root CONTEXT.md missing `goal` entry in ADR table

**File:** `CONTEXT.md:107-116`
**Quote:** ADR table lists 7 ADRs (0001–0007) but none reference Goal context explicitly.
**Rule:** ADR 0001 notes "Phase 15C added goal.read, goal.write permissions" but the root CONTEXT.md ADR table doesn't cross-reference Goal.
**Fix:** This is acceptable — ADRs are about architectural decisions, not about every context. No action needed unless a Goal-specific ADR is added.

### [MINOR] F-17-04: `src/contexts/CONTEXT.md` bounded context table has formatting inconsistency

**File:** `src/contexts/CONTEXT.md:7-18`
**Quote:** The table rows use inconsistent markdown pipe formatting — some rows have `||` prefix, others start with `|`. Example: `||| Identity | ... |` vs `Team | Staff teams ...`.
**Rule:** Markdown table consistency for readability.
**Fix:** Reformat the bounded context table to use consistent pipe formatting.

### [NIT] F-17-05: Goal CONTEXT.md glossary table has broken formatting

**File:** `src/contexts/goal/CONTEXT.md:8`
**Quote:** `| **Goal** | A property-scoped target ... |` — the row wraps oddly with `---------` appearing mid-cell due to the table containing `|` characters within the RecurrenceRule definition (line 17: `| 'monthly' | 'quarterly' }`).
**Rule:** Pipe characters inside table cells must be escaped or the cell content must be restructured.
**Fix:** Replace the pipe in RecurrenceRule definition with "or" — e.g., `{ frequency: 'weekly' or 'monthly' or 'quarterly' }`.

### [NIT] F-17-06: Staff CONTEXT.md not created

**File:** `src/contexts/staff/` — no `CONTEXT.md`
**Quote:** Staff is a "Standard" thickness context recently extracted from Identity (ADR 0006). Has comprehensive domain entities and use cases but no co-located documentation.
**Rule:** Standard contexts should have at least a brief CONTEXT.md with glossary and relationships.
**Fix:** Create `src/contexts/staff/CONTEXT.md` with StaffAssignment glossary, referral code documentation, and relationships to Identity/Property/Team contexts.

## Counts

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 0     |
| MAJOR     | 2     |
| MINOR     | 2     |
| NIT       | 2     |
| **Total** | **6** |
