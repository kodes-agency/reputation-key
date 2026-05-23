# Review 8: React Components & Hooks

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Scope

- `src/components/` (all subdirectories)
- `src/contexts/*/ui/` (no files found — contexts do not have `ui/` directories)

---

## Findings

### [MAJOR] 10+ components import directly from `server/` layer

Multiple components import server functions directly instead of receiving them as props from route files. This violates the architecture rule stated in `src/routes/CONTEXT.md`:

> "Components never import server functions directly."

See Review 7 for the full list with file:line citations. Affected files:

- `src/components/inbox/inbox-detail-content.tsx:8` — `updateInboxStatusFn`
- `src/components/inbox/inbox-bulk-actions.tsx:4` — `bulkUpdateInboxStatusFn`
- `src/components/inbox/inbox-notes-thread.tsx:6` — `addInboxNoteFn`
- `src/components/inbox/inbox-filters.tsx:17` — `listProperties`
- `src/components/inbox/inbox-unread-badge.tsx:8` — `getUnreadCountFn`
- `src/components/inbox/use-inbox-state.ts:3` — `getInboxItemsFn`
- `src/components/features/portal/portal-delete-button.tsx:15` — `deletePortal`
- `src/components/features/property/delete-property-dialog.tsx:2` — `deleteProperty`
- `src/components/features/property/people/people-page.tsx:10-11` — `listTeams`, `createTeam`, `deleteTeam`, `listMembers`
- `src/components/features/integration/import-connected-view/use-gbp-locations.ts:7` — `listGbpLocations`
- `src/components/features/integration/import-progress/use-import-job-polling.ts:10` — `getImportStatus`

Rule: `src/routes/CONTEXT.md` — server function references belong in route files, passed as props.

### [MAJOR] Component imports DTO schema from application layer

File: `src/components/features/team/team-form/create-team-form.tsx:14`
Quote: ```ts
import { createTeamInputSchema } from '#/contexts/team/application/dto/create-team.dto'

````
Rule: Per `src/contexts/CONTEXT.md` dependency rules, components may only import from `shared/`, not from context internals. Application layer DTOs are context internals.
Fix: Re-export the schema from a shared barrel, or pass it from the route file.

### [MAJOR] Components import types from context public-api — InboxItem, InboxItemDetail, InboxNote

File: `src/components/inbox/inbox-detail-content.tsx:14`
Quote: ```ts
import type {
  InboxItem,
  InboxItemDetail,
  InboxNote,
} from '#/contexts/inbox/application/public-api'
````

Rule: Cross-context type imports from `public-api.ts` are allowed per ADR 0008. However, importing from `application/` in a component blurs the boundary. These should be re-exported DTOs.
Fix: These are type-only imports from the designated public API surface — **acceptable per architecture**. No action needed, but consider creating a dedicated `dto/` barrel for UI-facing types.

### [MINOR] `console.warn` in production UI component

File: `src/components/ui/color-picker.tsx:1079`
Quote: ```ts
console.warn('EyeDropper error:', error)

````
Rule: No `console.log` in production code — only `logger.info/debug/error`.
Fix: Replace with `getLogger().warn({ err: error }, 'EyeDropper error')` or remove silently.

### [MINOR] RoleBadge uses string comparison for role variants

File: `src/components/features/identity/shared/role-badge.tsx:12-14`
Quote: ```ts
const variant =
  role === 'AccountAdmin'
    ? 'default'
    : role === 'PropertyManager'
      ? 'secondary'
      : 'outline'
````

Rule: CONTEXT.md says "Never use `hasRole()` for permission checks — only for hierarchy." However, this is a presentation-only mapping (badge color), not a permission check. It's still a string comparison on the Role type.
Fix: This is acceptable for presentation logic — `Role` is a union type and `===` is exhaustive. No action needed. (If a 4th role is added, TypeScript will flag the unhandled case via the `never` pattern used in `role-utils.ts`.)

---

## Positive Observations

- No component exceeds 300 lines. Largest non-UI-library component is `inbox-filters.tsx` at 199 lines.
- Components generally use typed props — `InboxFilterValues`, `Role`, etc.
- No direct imports from `domain/` layer in components (only `shared/domain/` types like `Role`, `MetricKey`, `AggregationFunction`).
- Hooks (`use-action`, `use-mutation-action`, `use-property-id`) properly handle loading/error states via `useAction` wrapper.
- `usePermissions` hook used correctly for client-side permission checks.

---

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 2     |
| NIT      | 0     |

**Most important thing to fix first:** The 10+ components importing server functions directly from `contexts/*/server/`. This is a systemic architecture violation. Create a batch PR that moves all `useServerFn()` calls to route files and passes the resulting actions as props.
