# Review 4 — Application / Use Case Layer

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Findings

### [MAJOR] Use cases missing `can()` authorization check

The following use cases take a `role` or `AuthContext` but never call `can(role, permission)`. Per CONTEXT.md use-case shape: step 1 is "Authorize — `can(ctx.role, 'resource.action')`".

**Goal context (all 5 use cases missing):**

- `src/contexts/goal/application/use-cases/create-goal.ts` — no `can()`, no `role` param
- `src/contexts/goal/application/use-cases/update-goal.ts` — no `can()`, no `role` param
- `src/contexts/goal/application/use-cases/cancel-goal.ts` — no `can()`, no `role` param
- `src/contexts/goal/application/use-cases/get-goal.ts` — no `can()`, no `role` param
- `src/contexts/goal/application/use-cases/list-goals.ts` — no `can()`, no `role` param

**Inbox context (9 use cases use `hasRole()` instead of `can()`):**

- `src/contexts/inbox/application/use-cases/add-inbox-note.ts` — uses `hasRole()`, not `can()`
- `src/contexts/inbox/application/use-cases/assign-inbox-item.ts` — uses `hasRole()`, not `can()`
- `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts` — uses `hasRole()`, not `can()`
- `src/contexts/inbox/application/use-cases/create-inbox-item.ts` — no auth
- `src/contexts/inbox/application/use-cases/get-inbox-item-detail.ts` — uses `hasRole()`, not `can()`
- `src/contexts/inbox/application/use-cases/get-inbox-items.ts` — uses `hasRole()`, not `can()`
- `src/contexts/inbox/application/use-cases/get-inbox-notes.ts` — uses `hasRole()`, not `can()`
- `src/contexts/inbox/application/use-cases/get-unread-count.ts` — no auth
- `src/contexts/inbox/application/use-cases/update-inbox-status.ts` — uses `hasRole()`, not `can()`

Rule: CONTEXT.md "Forbidden patterns: Never use `hasRole()` for permission checks — only for hierarchy."
Fix: Replace `hasRole()` checks with `can(role, 'inbox.xxx')` permission checks. Add `can()` to all authenticated inbox use cases.

**Other use cases missing `can()`:**

- `src/contexts/dashboard/application/use-cases/get-dashboard-data.ts` — no auth
- `src/contexts/property/application/use-cases/get-property.ts` — no `can()`
- `src/contexts/portal/application/use-cases/list-portals.ts` — no `can()` (server does it)
- `src/contexts/portal/application/use-cases/list-portal-links.ts` — no `can()`
- `src/contexts/portal/application/use-cases/get-portal-qr-url.ts` — no `can()`
- `src/contexts/portal/application/use-cases/finalize-upload.ts` — no `can()`
- `src/contexts/staff/application/use-cases/list-staff-assignments.ts` — no `can()`
- `src/contexts/team/application/use-cases/get-team.ts` — no `can()`
- `src/contexts/team/application/use-cases/list-teams.ts` — no `can()`

### [MAJOR] Use case uses `getLogger()` instead of LoggerPort

File: `src/contexts/guest/application/use-cases/record-scan.ts:12`
Quote:

```
import { getLogger } from '#/shared/observability/logger'
```

File: `src/contexts/guest/application/use-cases/track-review-link-click.ts:9`
Quote:

```
import { getLogger } from '#/shared/observability/logger'
```

Rule: Application layer must use logger via `LoggerPort`, not direct pino import.
Fix: Add `logger: LoggerPort` to deps and inject it via build.ts, consistent with inbox/integration contexts.

### [MINOR] Mixed error patterns across contexts

Goal use cases return `Result<T,E>` while others throw tagged errors. Both patterns are defensible but inconsistent.
Fix: Document which pattern is canonical, or standardize.

## Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 1     |
| NIT      | 0     |

**Most important thing to fix first:** Goal context use cases have zero authorization — add `can()` checks with `role` parameter to all 5 goal use cases.
