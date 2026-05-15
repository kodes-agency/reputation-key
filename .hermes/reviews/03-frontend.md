# Review: Frontend (Routes + Components)

## Summary

Overall assessment: **17 issues found** — 0 critical (P0), 3 high (P1), 9 medium (P2), 5 low (P3/suggestions).

The GBP import frontend is generally well-structured. The architecture correctly follows the convention of server functions being wrapped with `useServerFn` in routes and passed as props to components. Components use `useAction`/`useMutationActionSilent` wrappers for reactive state, and there are no violations of the "no `useQuery`/`useMutation`" rule. UX is strong — loading, error, empty, and disabled states are consistently handled. Accessibility attributes are present throughout.

The main issues are: a domain-layer import in a route file, an unsafe double type cast, one component exceeding the 150-line limit, and dead types in a shared file.

---

## Critical Issues (P0)

None found.

---

## High Issues (P1)

### P1-1: Domain layer import in route file

- **File:** `src/routes/_authenticated/properties/import/$importId.tsx` — Line 8
- **Code:** `import { type GbpImportJob } from '#/contexts/integration/domain/types'`
- **Description:** The convention explicitly states: _"Never import from domain/, application/ (non-dto), infrastructure/"._ The `GbpImportJob` type is available from `#/shared/domain` (as correctly used in `import-progress.tsx` line 1). This route should import from `#/shared/domain` instead of directly from the integration context's domain layer. This creates an unwanted coupling between the route and the domain internals.

### P1-2: Unsafe double type cast (`as unknown as`)

- **File:** `src/routes/_authenticated/properties/import/index.tsx` — Line 60
- **Code:** `connections as unknown as Array<import('#/shared/domain').GoogleConnection>`
- **Description:** The loader returns `{ connections: result.connections }` from `listGoogleConnections()`. The type of `result.connections` apparently doesn't match `Array<GoogleConnection>`, requiring a `as unknown as` double cast. This completely bypasses TypeScript's type safety and indicates a real type mismatch in the loader return value. The fix should be at the source: ensure `listGoogleConnections` returns the correct DTO type, or adjust the component's prop type to match the actual loader data shape.

### P1-3: Component exceeds 150-line limit

- **File:** `src/components/features/integration/import-connected-view/import-connected-view.tsx` — 157 lines
- **Description:** The file is 157 lines, exceeding the 150-line maximum convention. The comment on line 1 acknowledges this ("Server import exception: 6 mutations...") but this should still be refactored. The inline "Connect another account" button (lines 107–124) duplicates the logic in `ConnectGoogleButton` and could be extracted or the existing component reused, which would bring the file under 150 lines.

---

## Medium Issues (P2)

### P2-1: Dead types in shared import-types file

- **File:** `src/components/features/integration/shared/import-types.ts` — Lines 4–18
- **Description:** All three exported types (`GoogleConnectionDisplay`, `LocationRowProps`, `LocationPickerProps`) are defined but never imported anywhere outside this file. Each component defines its own inline `Props` type instead. These types are dead code and should be removed. They are also re-exported from `integration/index.ts` line 6 (`export * from './shared/import-types'`), which pollutes the barrel export with unused types.

### P2-2: Shared types not Readonly

- **File:** `src/components/features/integration/shared/import-types.ts` — Lines 8–12, 14–18
- **Description:** `LocationRowProps` and `LocationPickerProps` are not wrapped in `Readonly<{ ... }>`, violating the component convention for prop types. (Though these are dead code and should be removed entirely.)

### P2-3: Missing authorization guard (`beforeLoad`)

- **File:** `src/routes/_authenticated/properties/import/index.tsx`
- **File:** `src/routes/_authenticated/properties/import/$importId.tsx`
- **Description:** Neither route defines a `beforeLoad` hook with `can(role, 'resource.action')` for authorization. The convention states: _"can(role, 'resource.action') in beforeLoad for guards."_ Without this, any authenticated user can access the import feature regardless of permissions. This should be added to both routes.

### P2-4: Unnecessary array spread

- **File:** `src/routes/_authenticated/properties/import/index.tsx` — Line 52
- **Code:** `[...connections].length === 0`
- **Description:** Spreading `connections` into a new array just to check `.length` is wasteful. Should be `connections.length === 0`.

### P2-5: Unnecessary array spread in component

- **File:** `src/components/features/integration/import-connected-view/import-connected-view.tsx` — Line 50
- **Code:** `setLocations([...result.locations])`
- **Description:** Spreading into a new array is unnecessary. If the goal is to ensure a new reference, `result.locations` is already a new value from the server call. Use `setLocations(result.locations)` directly.

### P2-6: Missing dependency in useEffect

- **File:** `src/routes/_authenticated/properties/import/$importId.tsx` — Line 47
- **Code:** `}, [job?.status, importId])`
- **Description:** `getStatusAction` is used inside the `useEffect` but is not listed in the dependency array. While `getStatusAction` is referentially stable (due to `useCallback` in `useAction`), omitting it from deps violates the exhaustive-deps rule and could cause issues if the underlying implementation changes. Add `getStatusAction` to the dependency array.

### P2-7: Duplicated "connect" logic

- **File:** `src/components/features/integration/import-connected-view/import-connected-view.tsx` — Lines 107–124
- **Description:** The inline "Connect another account" button duplicates the exact same logic as `ConnectGoogleButton` (loading state, error handling, `window.location.href` redirect). The existing `ConnectGoogleButton` component should be reused with appropriate props to avoid duplication.

### P2-8: Import progress page has no loading state for initial render

- **File:** `src/routes/_authenticated/properties/import/$importId.tsx` — Lines 21–68
- **Description:** When `initialData.job` is `null`, the page immediately shows the "not found" error state. There is no intermediate loading/transition state while the route is transitioning or if the initial loader is slow. Consider adding a loading spinner for the initial render.

### P2-9: Import action error not cleared on retry

- **File:** `src/components/features/integration/import-connected-view/import-connected-view.tsx` — Lines 142–154
- **Description:** The `importAction.error` is displayed below the section, but there's no mechanism to dismiss it. If the user changes their selection and tries again, the previous error remains visible until a new action succeeds or fails. The error should be cleared when the user changes selection or when a new import attempt starts. (Note: `useAction` does clear error on new calls, so this partially self-resolves, but the error from `listLocations` persists across connection switches if the catch path doesn't reset it.)

---

## Low Issues (P3 / Suggestions)

### P3-1: Hardcoded UI strings (no i18n)

- **Files:** All component and route files
- **Description:** All user-facing strings are hardcoded (e.g., "Import Properties", "Connect Google Account", "No locations found for this account.", etc.). The project doesn't appear to have an i18n system yet, so this is acceptable for now but should be flagged for future internationalization.

### P3-2: Inline type import syntax

- **File:** `src/routes/_authenticated/properties/import/index.tsx` — Line 60
- **Code:** `Array<import('#/shared/domain').GoogleConnection>`
- **Description:** Using an inline `import()` type assertion in a cast expression is hard to read. If the type is needed, import it at the top of the file with a named import.

### P3-3: "No locations found" empty state missing aria attributes

- **File:** `src/components/features/integration/import-connected-view/import-locations-section.tsx` — Line 84
- **Description:** The empty state `<p>` for "No locations found for this account." lacks `role="status"` or `aria-live="polite"`. Compare with the loading state on lines 29–38 which correctly uses `role="status"` and `aria-live="polite"`.

### P3-4: Error div in import-locations-section missing role attribute

- **File:** `src/components/features/integration/import-connected-view/import-locations-section.tsx` — Lines 44–50
- **Description:** The error state div lacks `role="alert"`. Compare with `import-connected-view.tsx` line 145 which correctly includes `role="alert"`.

### P3-5: Polling interval hardcoded

- **File:** `src/routes/_authenticated/properties/import/$importId.tsx` — Line 42
- **Code:** `}, 2000)`
- **Description:** The 2-second polling interval is hardcoded. Consider extracting it as a named constant (e.g., `POLL_INTERVAL_MS = 2000`) for readability and configurability.

---

## Positive Findings

1. **Consistent architecture**: Server functions are correctly wrapped with `useServerFn` in route files and passed as `Action` props to components. No component directly calls server functions — the separation of concerns is clean.

2. **No `useQuery`/`useMutation` violations**: Zero imports from `@tanstack/react-query` across all files, respecting the project's lack of `QueryClientProvider`.

3. **Excellent UX coverage**: Every async operation has proper loading, error, and empty states. The `ImportLocationsSection` component is particularly well-structured with explicit handling for loading, error, populated, and empty states.

4. **Strong accessibility foundation**: `role="alert"`, `role="status"`, `aria-live="polite"`, `aria-busy`, `aria-hidden`, `aria-label` are used consistently. Form elements have associated labels via `htmlFor`/`id` pairs.

5. **Clean component decomposition**: Components are small and focused. `LocationPicker`/`LocationRow`, `ImportStatusBadge`, `ConnectGoogleButton` are all single-responsibility and under 100 lines.

6. **Proper disabled states**: All buttons are disabled during pending mutations (`isConnecting`, `isImporting`, `isPending`), preventing double-submissions.

7. **Route loader as single source of truth**: Both routes correctly use loaders for initial data, and components use `Route.useLoaderData()` instead of `useQuery`.

8. **Kebab-case filenames and named exports**: All files follow the naming convention. No default exports found.

9. **Readonly props**: All component `Props` types correctly use `Readonly<{ ... }>`.

10. **No `console.*` calls, no hardcoded secrets, no `any` types** in the reviewed component files.

---

## Files Reviewed

| File                                                                                      | Lines |
| ----------------------------------------------------------------------------------------- | ----- |
| `src/routes/_authenticated/properties/import/index.tsx`                                   | 70    |
| `src/routes/_authenticated/properties/import/$importId.tsx`                               | 68    |
| `src/routes/_authenticated/properties/import/-import-page-header.tsx`                     | 25    |
| `src/components/features/integration/connect-google-button/connect-google-button.tsx`     | 43    |
| `src/components/features/integration/connect-google-button/index.ts`                      | 1     |
| `src/components/features/integration/google-account-selector/google-account-selector.tsx` | 36    |
| `src/components/features/integration/google-account-selector/index.ts`                    | 1     |
| `src/components/features/integration/import-connected-view/import-connected-view.tsx`     | 157   |
| `src/components/features/integration/import-connected-view/import-locations-section.tsx`  | 91    |
| `src/components/features/integration/import-connected-view/index.ts`                      | 1     |
| `src/components/features/integration/import-progress/import-progress.tsx`                 | 79    |
| `src/components/features/integration/import-progress/import-status-badge.tsx`             | 50    |
| `src/components/features/integration/import-progress/index.ts`                            | 2     |
| `src/components/features/integration/index.ts`                                            | 6     |
| `src/components/features/integration/location-picker/location-picker.tsx`                 | 66    |
| `src/components/features/integration/location-picker/location-row.tsx`                    | 33    |
| `src/components/features/integration/location-picker/index.ts`                            | 2     |
| `src/components/features/integration/shared/import-types.ts`                              | 18    |
| `src/components/hooks/use-action.ts`                                                      | 91    |
| `src/components/hooks/use-mutation-action.ts`                                             | 125   |

**Total: 20 files, ~1,066 lines reviewed**
