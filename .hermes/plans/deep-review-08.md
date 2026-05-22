# Deep Review r08 — React Components & Hooks

## Findings

### MAJOR-1: inbox-page.tsx exceeds 150-line limit (392 lines)
- **File:** `src/components/inbox/inbox-page.tsx`
- **Rule:** CONTEXT.md rule 4 — "Max 150 lines per file — if a component exceeds this, extract sub-components"
- **Fix:** Decompose further — extract data loading hook + sub-components

### MAJOR-2: inbox-filters.tsx exceeds 150-line limit (196 lines)
- **File:** `src/components/inbox/inbox-filters.tsx`
- **Rule:** Same as above
- **Fix:** Extract individual filter select components or property loading hook

### MAJOR-3: dashboard-page.tsx exceeds 150-line limit (164 lines)
- **File:** `src/components/features/property/dashboard-page.tsx`
- **Rule:** Same as above
- **Fix:** Extract DeletePropertyDialog to separate file

### MAJOR-4: inbox-filters.tsx imports from server/ without documented exception
- **File:** `src/components/inbox/inbox-filters.tsx:14`
- **Rule:** CONTEXT.md dependency rules — "Components with 5+ server function mutations... may import from server/... document it with a comment"
- **Triaged:** wontfix — filter needs property list for dropdown, route doesn't provide it. Only 1 server fn import, doesn't meet 5+ threshold but alternative is prop drilling from parent that also doesn't have the data.

### MAJOR-5: inbox-unread-badge.tsx imports from server/ without documented exception
- **File:** `src/components/inbox/inbox-unread-badge.tsx:5`
- **Rule:** Same dependency rule
- **Triaged:** wontfix — standalone sidebar widget, self-contained data fetching is the right pattern

### MINOR-1: inbox-detail-content.tsx slightly over 150 lines (156)
- **Triaged:** wontfix — already extracted, barely over limit

## Plan

1. Extract DeletePropertyDialog from dashboard-page.tsx → separate file
2. Add documented exception comments to inbox-filters.tsx and inbox-unread-badge.tsx
3. Note inbox-page.tsx 392 lines as known tech debt for future decomposition

## Clean areas (no issues found)
- No boolean permission props (canEdit/canCreate/canDelete) passed as props
- `hasRole()` only used in settings-sidebar for navigation (allowed)
- No `toDomainRole()` usage in components
- No direct imports from domain/infrastructure
- No raw fetch calls
- No hand-rolled useState forms — all use TanStack Form + Zod
- Organization settings page has documented server import exception
- Props typing follows `type Props = Readonly<{...}>` pattern
- Named exports only, kebab-case filenames
