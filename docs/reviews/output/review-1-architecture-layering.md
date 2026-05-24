# Review #1: Architecture & Layering

**Date:** 2026-05-23  
**Reviewer:** Automated architecture review  
**Scope:** `src/contexts/`, `src/components/`, `src/routes/`, `src/composition.ts`, `src/bootstrap.ts`

---

## Findings

### 1. [BLOCKER] Domain layer uses `throw` — violates purity rule

**File:** `src/contexts/goal/domain/progress-strategy.ts:70`  
**Quote:**

```ts
throw new Error('buildProgressQueryForInstance only applies to recurring goals')
```

**Rule:** domain/ must never `throw` — returns `Result` or error union instead.  
**Fix:** Return `Result<ProgressQuery, ProgressQueryError>` from `buildProgressQueryForInstance`. Add a `'non_recurring_goal'` variant to `ProgressQueryError`. Caller (infrastructure) handles the error path.

---

### 2. [BLOCKER] Domain layer uses `throw` in `resolveTimeFilter`

**File:** `src/contexts/goal/domain/progress-strategy.ts:115`  
**Quote:**

```ts
throw new Error(
  'Cannot build progress query for recurring template without instance period. ' +
    'Use buildProgressQueryForInstance() with explicit dates.',
)
```

**Rule:** domain/ must never `throw`.  
**Fix:** Return `Result<TimeFilter, ProgressQueryError>` from `resolveTimeFilter`. Add `'recurring_template_without_instance_period'` variant (already defined in `ProgressQueryError` but unused). Propagate through `buildProgressQuery`.

---

### 3. [BLOCKER] Server imports error constructor from domain

**File:** `src/contexts/goal/server/goals.ts:18`  
**Quote:**

```ts
import { goalError, isGoalError } from '../domain/errors'
```

**Rule:** Server may only import error type guards (`isXxxError`) and error code types from `domain/errors.ts`. `goalError` is an error constructor — not allowed.  
**Fix:** Move `requireWriteAccess()` authorization + error construction into a server-local helper. Replace `goalError(...)` calls with local error factory or inline construction. Keep only `isGoalError` and `GoalErrorCode` imports from domain.

---

### 4. [BLOCKER] Server imports error constructor from domain

**File:** `src/contexts/dashboard/server/dashboard.ts:16`  
**Quote:**

```ts
import { dashboardError } from '../domain/errors'
```

**Rule:** Server may only import error type guards and error code types from domain.  
**Fix:** Create a local `forbiddenError()` helper in the server file or use `throwContextError` directly with an inline error object. Remove `dashboardError` import from domain.

---

### 5. [MAJOR] Server imports domain rule constant for DTO construction

**File:** `src/contexts/review/server/reply.ts:15`  
**Quote:**

```ts
import { MAX_REPLY_LENGTH } from '../domain/rules'
```

**Rule:** Server should not import from `domain/rules`. Validation constraints belong in the DTO layer (`application/dto/`).  
**Fix:** Define `MAX_REPLY_LENGTH` in the DTO schema file (`review/application/dto/sync-reviews.dto.ts` or a shared constants file in `application/`). Domain rules file re-exports or references the same constant. Server imports from DTO, not domain.

---

### 6. [MAJOR] Server re-exports domain rule for component consumption

**File:** `src/contexts/portal/server/portal-links.ts:25`  
**Quote:**

```ts
export { isValidExternalUrl } from '../domain/rules'
```

**Rule:** Server must not re-export domain rules. Components should not need domain validation functions.  
**Fix:** Move `isValidExternalUrl` to `application/dto/` as part of the link DTO schema validation, or expose it through `application/public-api.ts`. Components import from DTO, not through server.

---

### 7. [MAJOR] Server imports domain entity types (not error types)

**File:** `src/contexts/goal/server/staff-goals.ts:10`  
**Quote:**

```ts
import type { Goal, GoalProgress } from '../domain/types'
```

**Rule:** Server may only import error type guards and error code types from domain — not entity types.  
**Fix:** Define `GoalWithProgress` return type in `application/dto/goal.dto.ts` or a local server types file. The server function should return DTO-shaped data, not domain entities. If the type is only for the response shape, define it alongside the DTO.

---

### 8. [MAJOR] Undocumented `ui/` layer in goal context imports domain directly

**File:** `src/contexts/goal/ui/helpers.ts:6`  
**Quote:**

```ts
import type { Goal, GoalStatus } from '#/contexts/goal/domain/types'
```

**Rule:** The 4-layer architecture (`domain/`, `application/`, `infrastructure/`, `server/`) does not define a `ui/` layer. Cross-layer import from `domain/` by an undocumented layer is a structural violation.  
**Fix:** Either (a) move `helpers.ts` to `src/components/features/property/goals/` and import `Goal` and `GoalStatus` types through `application/public-api.ts`, or (b) formally document `ui/` as an allowed layer in `src/contexts/CONTEXT.md` with clear dependency rules (may only import type-only from domain, no runtime dependency).

---

### 9. [MAJOR] Infrastructure adapter reaches into HTTP framework for request object

**File:** `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:18`  
**Quote:**

```ts
import { getRequest } from '@tanstack/react-start/server'
```

**Rule:** Infrastructure should implement ports using domain/application types, not framework request objects. The adapter pulls raw HTTP headers from TanStack's request context — coupling infrastructure to the web framework.  
**Fix:** Pass `Headers` as a parameter through the port interface. The server layer (which has access to the request) supplies headers when calling the port. Remove `getRequest()` from the adapter — the adapter should be callable without an active HTTP context (e.g., from background jobs or tests).

---

### 10. [MAJOR] Duplicated domain constant in component

**File:** `src/components/inbox/reply-editor-compose.tsx:7`  
**Quote:**

```ts
const MAX_REPLY_LENGTH = 4096
```

**Rule:** Domain constants must not be duplicated. Components should derive limits from DTO schemas.  
**Fix:** Export `MAX_REPLY_LENGTH` from the reply DTO schema in `review/application/dto/`. The component imports the constant from the DTO (type-only import path is allowed for components per `components/CONTEXT.md`).

---

### 11. [MINOR] Components import from `server/` without 5+ mutation exception — `portal-delete-button`

**File:** `src/components/features/portal/portal-delete-button.tsx:15`  
**Quote:**

```ts
import { deletePortal } from '#/contexts/portal/server/portals'
```

**Rule:** Components must not import from `server/` unless they have 5+ mutations (documented exception). Single-mutation component violates this.  
**Fix:** Pass `deletePortal` action as a prop from the parent route file.

---

### 12. [MINOR] Components import from `server/` without 5+ mutation exception — `delete-property-dialog`

**File:** `src/components/features/property/delete-property-dialog.tsx:2`  
**Quote:**

```ts
import { deleteProperty } from '#/contexts/property/server/properties'
```

**Rule:** Same as #11 — single mutation, no justification comment.  
**Fix:** Pass `deleteProperty` action as a prop.

---

### 13. [MINOR] Components import from `server/` without 5+ mutation exception — `inbox-bulk-actions`

**File:** `src/components/inbox/inbox-bulk-actions.tsx:4`  
**Quote:**

```ts
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
```

**Rule:** Same as #11 — single mutation, no justification comment.  
**Fix:** Pass the action as a prop from the parent inbox component or route.

---

### 14. [MINOR] Components import from `server/` without 5+ mutation exception — `inbox-detail-content`

**File:** `src/components/inbox/inbox-detail-content.tsx:8`  
**Quote:**

```ts
import { updateInboxStatusFn } from '#/contexts/inbox/server/inbox'
```

**Rule:** Same as #11 — single mutation, no justification comment.  
**Fix:** Pass the action as a prop from the parent.

---

### 15. [NIT] `people-page` imports from 3 server modules (7 functions) without documented exception comment

**File:** `src/components/features/property/people/people-page.tsx:6-11`  
**Quote:**

```ts
import {
  listStaffAssignments,
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { listTeams, createTeam, deleteTeam } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
```

**Rule:** 7 server functions qualifies for the 5+ exception, but no comment documents the justification.  
**Fix:** Add a top-of-file comment: `// Server import exception: 7 mutations across staff, teams, members`.

---

### 16. [NIT] `goalError` used inline in server error-mapping — tight coupling to domain error shape

**File:** `src/contexts/goal/server/goals.ts:38-44`  
**Quote:**

```ts
throwContextError(
  'GoalError',
  goalError('forbidden', 'Only AccountAdmin or PropertyManager can perform this action'),
  403,
)
```

**Rule:** Server layer should map errors, not construct domain errors. The `requireWriteAccess` helper constructs a domain error just to immediately throw it via the server error mapper.  
**Fix:** Create a `throwForbidden()` helper in the server file that calls `throwContextError` directly without going through the domain error constructor.

---

## Per-layer Summary

| Layer                             | Files Reviewed                          | BLOCKER | MAJOR | MINOR | NIT   |
| --------------------------------- | --------------------------------------- | ------- | ----- | ----- | ----- |
| `domain/`                         | 50+ across 12 contexts                  | 2       | 0     | 0     | 0     |
| `application/`                    | 40+ use cases, DTOs, ports              | 0       | 0     | 0     | 0     |
| `infrastructure/`                 | 30+ repos, adapters, jobs, handlers     | 0       | 1     | 0     | 0     |
| `server/`                         | 20+ server functions across 12 contexts | 2       | 2     | 0     | 2     |
| `components/`                     | 15+ feature components                  | 0       | 1     | 4     | 0     |
| `routes/`                         | 5 route files sampled                   | 0       | 0     | 0     | 0     |
| `goal/ui/`                        | 2 files                                 | 0       | 1     | 0     | 0     |
| `composition.ts` / `bootstrap.ts` | 2                                       | 0       | 0     | 0     | 0     |
| **Total**                         |                                         | **4**   | **5** | **4** | **2** |

## Summary

The architecture is well-structured overall: domain is free of framework imports and async/IO, application layer correctly depends only on domain and shared/domain, infrastructure properly implements application ports, and the composition root is clean. The dependency rule is one-directional and largely enforced.

**4 BLOCKERs** were found: the goal context's `domain/progress-strategy.ts` violates the no-`throw` rule in domain with 3 `throw` statements, and two server files (`goal/server/goals.ts`, `dashboard/server/dashboard.ts`) import error constructors from domain where only type guards and error code types are allowed. **5 MAJORs** include server files reaching into `domain/rules` for constants, an undocumented `goal/ui/` layer bypassing the 4-layer structure, infrastructure tightly coupled to the HTTP framework via `getRequest()`, and a duplicated domain constant in a component. **4 MINORs** are components importing single server functions without the documented 5+ mutation exception. **2 NITs** are missing justification comments.

**Single most important fix:** Eliminate `throw` in `goal/domain/progress-strategy.ts` by returning `Result<ProgressQuery, ProgressQueryError>` — this is the purest domain violation and sets the precedent for all other error handling in the codebase.
