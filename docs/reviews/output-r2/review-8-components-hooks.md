# Review 8: React Components & Hooks (Re-audit R2)

Date: 2026-05-23
Scope: All files in `src/components/` and `src/shared/hooks/`. ~190 component files, 1 shared hook file.
Auditor: Automated audit against component architecture rules.

## Summary

Components and hooks are generally well-structured. The forbidden pattern of `canEdit`/`canCreate` boolean prop drilling is **not present** — all components that check permissions correctly use `usePermissions()` locally. `hasRole()` usage is limited to the `settings-sidebar.tsx` for sidebar hierarchy (correct) and the `_authenticated.tsx` layout for sidebar selection (correct). No `toDomainRole()` calls exist in components. No raw `fetch()` calls in components. No direct imports from other contexts' `domain/` or `infrastructure/` directories. All cross-context imports go through `application/public-api.ts` or `application/dto/`. One component exceeds 250 lines (`color-picker.tsx` at 1623 lines, but this is a UI library component). Hook misuse patterns (conditional hooks, data fetching in effects) were not found. A few components use `canEdit` as a local variable derived from `usePermissions()`, which is correct — the prohibition is on _prop drilling_, not local variables.

## Findings

### [NIT] components/ui/color-picker.tsx — Exceeds 250-line limit (1623 lines)

**File:** `src/components/ui/color-picker.tsx`, 1623 lines
**Quote:** File is 1623 lines.
**Rule:** Component size >250 lines.
**Fix:** This is a UI library component (likely shadcn/ui or similar). Refactoring would be low-value unless it contains custom business logic. **Accept as-is for library components.**

### [NIT] components/features/identity/shared/role-badge.tsx — Uses `role === 'AccountAdmin'` for display logic

**File:** `src/components/features/identity/shared/role-badge.tsx`, lines 12-16
**Quote:** `role === 'AccountAdmin' ? 'default' : role === 'PropertyManager' ? 'secondary' : 'outline'`
**Rule:** No `role === '...'` for gating. However, this is display-only (badge variant selection), not permission gating.
**Fix:** Not a permission check — this is UI presentation logic. Acceptable, but consider a `roleVariant(role)` helper in `role-utils.ts` for consistency.

### Verified: No canEdit/canCreate boolean prop drilling ✅

All `canEdit`/`canManage`/`canManageMembers` usages are **local variables** derived from `usePermissions()`:

- `sortable-link.tsx:30` — `const canEdit = can('portal.update')` from `usePermissions()` ✅
- `sortable-category.tsx:48` — `const canEdit = can('portal.update')` from `usePermissions()` ✅
- `link-tree-category-list.tsx:67` — `const canEdit = can('portal.update')` from `usePermissions()` ✅
- `inbox-detail-content.tsx:35` — `const canManageReplies = can('reply.manage')` from `usePermissions()` ✅
- `invitation-table.tsx:52` — `const canManage = can('invitation.cancel')` from `usePermissions()` ✅
- `member-table.tsx:51` — `const canManageMembers = canChangeRoles || canRemove` (derived from `usePermissions()`) ✅

None of these are received as props. Components call `usePermissions()` directly.

### Verified: No hasRole() for gating (only sidebar hierarchy) ✅

Only two component files import `hasRole`:

- `settings-sidebar.tsx:29` — `const isManager = hasRole(role, 'PropertyManager')` — used for sidebar link visibility ✅
- `_authenticated.tsx:153` — `hasRole(ctx.role, 'PropertyManager')` — used for sidebar selection ✅

Both are hierarchy/display usage, not permission gating. Correct per architecture.

### Verified: No toDomainRole() in components ✅

Zero matches for `toDomainRole` in `src/components/`. The function is only used in server-layer code (`identity/server/organizations.ts`) to map better-auth roles to domain roles.

### Verified: No direct imports from other contexts' domain/infrastructure ✅

All cross-context imports from components follow the rules:

- Types from `application/public-api.ts` ✅
- DTOs from `application/dto/` ✅
- Server functions from `server/` ✅
- No imports from `domain/` or `infrastructure/` of other contexts ✅

Sample of cross-context imports verified:

- `inbox-detail-content.tsx` → `#/contexts/inbox/application/public-api` ✅
- `property-dashboard.tsx` → `#/contexts/dashboard/application/public-api` ✅
- `assign-staff-form.tsx` → `#/contexts/staff/application/dto/staff-assignment.dto` ✅
- `create-team-form.tsx` → `#/contexts/team/application/dto/create-team.dto` ✅
- `use-import-job-polling.ts` → `#/contexts/integration/application/public-api` ✅

### Verified: No raw fetch in components ✅

Zero matches for `fetch(` in `src/components/`. All data fetching goes through TanStack Start server functions, mutations, or loaders.

### Verified: Hook misuse not detected ✅

- No `useEffect` with `fetch` patterns found
- No conditional hook calls (no `if (...use[A-Z])` patterns)
- Custom hooks (`use-inbox-state.ts`, `use-inbox-detail.ts`, `use-link-tree-state.ts`, `use-link-tree-mutations.ts`, `use-mutation-action.ts`, `use-action.ts`, `use-import-job-polling.ts`, `use-gbp-locations.ts`) all follow standard React hook rules

### Component Size Analysis (non-UI-library components >100 lines)

| File                     | Lines | Status              |
| ------------------------ | ----- | ------------------- |
| color-picker.tsx         | 1623  | UI library — exempt |
| sidebar.tsx              | 724   | UI library — exempt |
| inbox-filters.tsx        | 199   | ✅ Under 250        |
| alert-dialog.tsx         | 195   | UI library — exempt |
| select.tsx               | 189   | UI library — exempt |
| command.tsx              | 174   | UI library — exempt |
| inbox-detail-content.tsx | 159   | ✅ Under 250        |
| dialog.tsx               | 157   | UI library — exempt |
| goal-create-form.tsx     | 151   | ✅ Under 250        |
| reply-editor.tsx         | 148   | ✅ Under 250        |
| property-dashboard.tsx   | 148   | ✅ Under 250        |
| goal-detail-page.tsx     | 144   | ✅ Under 250        |
| portal-list-page.tsx     | 142   | ✅ Under 250        |
| inbox-page.tsx           | 141   | ✅ Under 250        |

All non-UI-library components are under 250 lines.

### usePermissions Hook — Correct Implementation ✅

**File:** `src/shared/hooks/usePermissions.ts`
**Analysis:** Correctly reads `role` from route context via `useRouteContext({ from: '/_authenticated' })`, exposes `can(permission)` function. No issues found.

## Severity Counts

- **BLOCKER:** 0
- **MAJOR:** 0
- **MINOR:** 0
- **NIT:** 2
