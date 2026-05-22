# Deep Review r07 — Routes, Loaders & Mutations

## Findings

### MAJOR-1: Inbox route exceeds 80-line layout rule (398 lines)
- **File:** `src/routes/_authenticated/inbox/index.tsx`
- **Rule:** "Route file containing JSX > ~80 lines of layout — should extract a component"
- **Fix:** Extract `InboxPage` component to `src/components/inbox/inbox-page.tsx`

### MAJOR-2: Dashboard route exceeds 80-line layout rule (161 lines)
- **File:** `src/routes/_authenticated/dashboard.tsx:25-69,75-161`
- **Rule:** Same as above
- **Fix:** Extract `DeletePropertyDialog` and `DashboardPage` to `src/components/features/property/`

### MAJOR-3: People route exceeds 80-line layout rule (121 lines)
- **File:** `src/routes/_authenticated/properties/$propertyId/people.tsx`
- **Rule:** Same as above
- **Fix:** Extract `PeoplePage` component to `src/components/features/property/people-page.tsx`

### MAJOR-4: Inbox route has no loader
- **File:** `src/routes/_authenticated/inbox/index.tsx:45-49`
- **Triaged:** wontfix — cursor-based pagination requires client-side data management; useServerFn pattern is correct

### MINOR: Missing head/meta on multiple routes
- **Triaged:** wontfix — low priority, many are placeholder pages

## Plan

1. Extract InboxPage → component file
2. Extract DashboardPage + DeletePropertyDialog → component files
3. Extract PeoplePage → component file
4. Keep route files thin (route definition + import + render)

## Notes

- All routes correctly use server functions (no direct repo/ORM calls)
- All authenticated routes nested under `_authenticated.tsx`
- `beforeLoad` only used for auth guards (returns context, no data fetching)
- Permission checks use `can()` in `beforeLoad` correctly
- No tenant ID from URL params — all via auth context
- Mutation invalidation routes match loader routes correctly
