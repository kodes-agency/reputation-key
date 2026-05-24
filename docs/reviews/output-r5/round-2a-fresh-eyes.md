# Round 2A — Fresh-Eyes Correctness Audit

**Branch:** feat/phase-15c-goal-ui
**Scope:** All 12 CONTEXT.md files vs actual code
**Method:** Automated grep + manual file-by-file comparison

## Automated Checks

- `pnpm tsc --noEmit` — PASS (clean)
- `grep -rn 'hasRole' src/` — 26 production-code hits found (see findings below)
- `grep -rn 'from.*contexts/[^/]*/[^a]' src/contexts/` — 19 hits, all test files or documented exceptions

---

## Findings

### [BLOCKER] Goal server imports domain types directly — arch violation

**File:** src/contexts/goal/server/staff-goals.ts:11
**Code:** `import type { Goal, GoalProgress } from '../domain/types'`
**Fix:** Import `Goal` and `GoalProgress` from `../application/public-api` instead; per architecture, server may only import error type guards from its own domain.

---

### [MAJOR] hasRole in 7 inbox use cases bypasses centralized permission system

**File:** src/contexts/inbox/application/use-cases/{update-inbox-status,get-inbox-items,assign-inbox-item,bulk-update-inbox-status,get-inbox-item-detail,get-inbox-notes,add-inbox-note}.ts
**Code:** All use `hasRole(input.role, ADMIN_ROLE)` for property-scoping logic instead of `can(role, 'inbox.manage')`
**Fix:** Replace `hasRole` calls with `can(role, 'inbox.manage')` to use the centralized permission table. The `inbox.manage` permission already exists in permissions.ts but is completely unused — it was presumably created for this exact purpose.

---

### [MAJOR] hasRole in integration list-google-connections use case

**File:** src/contexts/integration/application/use-cases/list-google-connections.ts:11,28
**Code:** `import { hasRole } from '#/shared/domain/roles'` and `hasRole(ctx.role, 'AccountAdmin')` for visibility filtering
**Fix:** Replace with a dedicated permission check (e.g., `can(role, 'integration.manage')`) or add a documented justification comment.

---

### [MAJOR] hasRole in staff create-staff-assignment use case

**File:** src/contexts/staff/application/use-cases/create-staff-assignment.ts:10,65
**Code:** `import { hasRole }` and `hasRole(ctx.role, 'PropertyManager')` for self-assignment detection
**Fix:** Use `can(ctx.role, 'staff_assignment.create')` or define a dedicated permission for self-assignment override.

---

### [MAJOR] Portal CONTEXT.md omits rules.ts from domain layer listing

**File:** src/contexts/portal/CONTEXT.md:48
**Docs say:** `domain/ types.ts, constructors.ts, events.ts, errors.ts`
**Actual:** `domain/` also contains `rules.ts` and `rules.test.ts`
**Fix:** Add `rules.ts` to the domain layer listing in CONTEXT.md.

---

### [MAJOR] Portal CONTEXT.md falsely states mappers are inline

**File:** src/contexts/portal/CONTEXT.md:62
**Docs say:** `mappers/ (inline in repositories)`
**Actual:** Separate mapper files exist: `portal.mapper.ts`, `portal-link.mapper.ts` (plus test files)
**Fix:** Change to `mappers/ portal.mapper.ts, portal-link.mapper.ts` to match reality.

---

### [MAJOR] Review CONTEXT.md documents internal-ports types as public-api exports

**File:** src/contexts/review/CONTEXT.md:74
**Docs say:** Public API exports `ReviewQueuePort`, `SyncPropertyReviewsJobData`, `AddSyncJobOptions`, `GoogleReviewApiPort`
**Actual:** These types live in `application/internal-ports.ts`, NOT in `application/public-api.ts`. The public-api.ts only exports `GoogleReview`, `StarRating`, and event types.
**Fix:** Update CONTEXT.md Public API section to match what public-api.ts actually exports. Document internal-ports.ts separately.

---

### [MAJOR] Integration use case imports from review internal-ports instead of public-api

**File:** src/contexts/integration/application/use-cases/handle-gbp-notification.ts:6
**Code:** `import type { ReviewQueuePort } from '#/contexts/review/application/internal-ports'`
**Fix:** Either export `ReviewQueuePort` from review's public-api.ts, or document this cross-context internal-ports import as a justified exception (the root CONTEXT.md exception covers "adapter implementations," but this is a use case, not an adapter).

---

### [MAJOR] Review CONTEXT.md missing Permissions section

**File:** src/contexts/review/CONTEXT.md
**Issue:** Review context uses `can(ctx.role, 'reply.manage')` in server/reply.ts but CONTEXT.md has no Permissions section documenting this.
**Fix:** Add a Permissions section: `reply.manage` — AccountAdmin ✓, PropertyManager ✓, Staff —.

---

### [MAJOR] Identity server uses dashboard.read as proxy for org access

**File:** src/contexts/identity/server/organizations.ts:128
**Code:** `if (!can(ctx.role, 'dashboard.read'))` in `getActiveOrganization` server function
**Fix:** This is an identity context endpoint using a dashboard context permission as proxy. Either add `organization.read` permission to identity, or document this cross-context permission reuse explicitly.

---

## MINOR findings

### [MINOR] 6 orphan permissions defined but never used

**File:** src/shared/domain/permissions.ts
**Permissions:** `ac.create`, `ac.read`, `ac.update`, `ac.delete`, `feedback.read`, `feedback.respond`, `review.read`, `identity.leave_org`, `organization.delete`
**Fix:** Remove unused permissions or implement their can() checks. The `ac.*` permissions have no corresponding context at all (no `ac/` context directory).

### [MINOR] inbox.manage permission documented but never checked

**File:** src/contexts/inbox/CONTEXT.md:130, src/shared/domain/permissions.ts:53
**Issue:** `inbox.manage` is listed in the inbox permissions table and defined in permissions.ts, but no code ever calls `can(role, 'inbox.manage')`.
**Fix:** Either use it (replacing hasRole calls in use cases) or remove it.

### [MINOR] 5 contexts missing Permissions sections despite using can()

**Files:** src/contexts/{team,staff,property,identity,integration}/CONTEXT.md
**Issue:** These contexts use `can()` with various permissions but their CONTEXT.md files have no Permissions section.
**Permissions used:**

- team: `team.create`, `team.update`, `team.delete`, `team.read`
- staff: `staff_assignment.create`, `staff_assignment.delete`, `staff_assignment.read`
- property: `property.create`, `property.update`, `property.delete`, `property.read`
- identity: `organization.update`, `member.create`, `member.update`, `member.delete`, `member.list`, `invitation.create`, `invitation.list`, `invitation.cancel`, `invitation.resend`, `identity.avatar_upload`, `identity.logo_upload`
- integration: `integration.manage`, `property.create`

**Fix:** Add Permissions sections to each CONTEXT.md listing all permissions used with role matrix.

### [MINOR] Identity CONTEXT.md architecture block omits public-api.ts

**File:** src/contexts/identity/CONTEXT.md:56-72
**Issue:** The architecture layer tree lists `application/` subfolders (ports, dto, use-cases) but not `public-api.ts`, even though it exists at `application/public-api.ts` and the context has a "Public API" section.
**Fix:** Add `public-api.ts` to the architecture layer listing.

### [MINOR] Portal CONTEXT.md missing Permissions section

**File:** src/contexts/portal/CONTEXT.md
**Issue:** Portal uses `portal.create`, `portal.update`, `portal.delete`, `portal.read` in can() calls but CONTEXT.md has no Permissions section.
**Fix:** Add Permissions section with role matrix for all 4 portal permissions.

### [MINOR] Guest CONTEXT.md doesn't enumerate server functions in table

**File:** src/contexts/guest/CONTEXT.md:110
**Issue:** Guest CONTEXT.md describes server functions in prose only, unlike other contexts which use structured tables. Server functions are: `recordScanFn` (POST), `getPublicPortal` (GET), `submitRatingFn` (POST), `submitFeedbackFn` (POST), `resolveLinkAndTrack` (GET).
**Fix:** Add a structured Server functions table like other contexts.

### [MINOR] Guest server function names don't match use case names

**File:** src/contexts/guest/server/public.ts vs CONTEXT.md
**Issue:** Use case is `trackReviewLinkClick` but server function is `resolveLinkAndTrack`. Use case is `recordScan`/`recordScanWithRef` but server function is `recordScanFn`.
**Fix:** Document the mapping between server functions and use cases, or align names.

## NIT findings

### [NIT] Dashboard server uses .inputValidator() while root CONTEXT.md example shows .validator()

**File:** src/contexts/dashboard/server/dashboard.ts:63 vs src/contexts/CONTEXT.md:93
**Fix:** Update root CONTEXT.md example to use `.inputValidator()` (the actual TanStack Start API).

### [NIT] Team public-api exports empty TeamPublicApi type

**File:** src/contexts/team/application/public-api.ts
**Code:** `export type TeamPublicApi = Readonly<Record<string,never>>`
**Fix:** Add a comment explaining this is a placeholder, or note in CONTEXT.md that Team has no cross-context API surface yet.

### [NIT] Goal CONTEXT.md intentional deviation section could be more precise

**File:** src/contexts/goal/CONTEXT.md:83-85
**Issue:** ui/helpers.ts imports from `goal/application/dto/goal.dto` rather than from domain types, which is fine within context but not explicitly noted.
**Fix:** No action needed — current documentation is adequate.

### [NIT] Review CONTEXT.md reply lifecycle documentation mismatch

**File:** src/contexts/review/CONTEXT.md:10-11
**Issue:** Lists lifecycle as `draft → pending_approval → approved → published` but also mentions `publish_failed` and `rejected` states in same paragraph without showing them in the flow diagram.
**Fix:** Add a state diagram showing all states and transitions.

---

## Summary

BLOCKER: 1
MAJOR: 10
MINOR: 7
NIT: 4
Total: 22 findings

### Key themes

1. **hasRole vs can()** — The biggest pattern issue. 7 inbox use cases + 1 integration + 1 staff use case use `hasRole()` for authorization-adjacent logic instead of the centralized `can()` permission system. This bypasses the permission table and makes it impossible to change behavior via configuration.

2. **CONTEXT.md ↔ code drift** — Portal, Review, and Identity CONTEXT.md files have meaningful inaccuracies (missing files, wrong exports, omitted layers). Round 1 updated these docs but missed several discrepancies.

3. **Orphan permissions** — 9+ permissions defined in permissions.ts but never checked in any `can()` call. The `ac.*` permissions have no corresponding context at all.

4. **Missing Permissions sections** — 6 of 12 contexts lack a Permissions section in their CONTEXT.md despite actively using `can()` checks. This makes it hard for developers to discover what permissions exist and what roles they grant to.
