# GBP Data Loading Fixes — Implementation Plan

## Phase 1: Extract hooks + fix polling bug + fix invalidation

### Task 1.1: Create `useGbpLocations` hook

- **Path:** `src/components/features/integration/import-connected-view/use-gbp-locations.ts`
- **What:** Encapsulates `selectedConnectionId` → fetch locations → loading/error/data state
- **Why:** `useAction` is for mutations, not reads. This is a parametric data fetch triggered by user selection.
- **Details:**
  - Takes `connectionId: string | undefined`
  - Returns `{ locations: readonly GbpLocation[], isLoading: boolean, error: Error | null }`
  - Uses `useState` + `useEffect` internally
  - Stable fetch via `useRef` for the server fn reference

### Task 1.2: Create `useImportJobPolling` hook

- **Path:** `src/components/features/integration/import-progress/use-import-job-polling.ts`
- **What:** Encapsulates polling logic for import job status
- **Why:** Current polling has a bug — `getStatusAction` dep causes interval reset every render
- **Details:**
  - Takes `importId: string, initialJob: GbpImportJob`
  - Returns `{ job: GbpImportJob | null, isPolling: boolean, error: Error | null }`
  - Uses `useRef` for stable action reference
  - Stops polling on terminal status
  - Stops after N consecutive errors (e.g., 5)
  - Fixed 2s interval (no backoff needed — jobs are short-lived)

### Task 1.3: Refactor `ImportConnectedView`

- **Path:** `src/components/features/integration/import-connected-view/import-connected-view.tsx`
- **What:** Replace internal effects/fetch with `useGbpLocations` hook
- **Details:**
  - Remove `useState(locations)`, `useCallback(fetchLocations)`, both `useEffect`s
  - Call `useGbpLocations(selectedConnectionId)` at top level
  - Pass `locations`/`isLoading`/`error` down to `ImportLocationsSection`
  - Keep `selectedConnectionId` state (user interaction, not data fetch)

### Task 1.4: Refactor `$importId.tsx`

- **Path:** `src/routes/_authenticated/properties/import/$importId.tsx`
- **What:** Replace hand-rolled polling with `useImportJobPolling` hook
- **Details:**
  - Remove `useState(job)`, `useRef(intervalRef)`, `useEffect(polling)`
  - Call `useImportJobPolling(importId, initialData.job)`
  - Render from hook's returned `job`

### Task 1.5: Fix import action invalidation

- **Path:** `src/routes/_authenticated/properties/import/index.tsx`
- **What:** Add `invalidateRoutes` so property list refreshes after import
- **Change:** `{ invalidate: false }` → `{ invalidateRoutes: ['/_authenticated'] }`

### Task 1.6: Refactor `ConnectGoogleButton`

- **Path:** `src/components/features/integration/connect-google-button/connect-google-button.tsx`
- **What:** Remove duplicate loading/error state, use the `getAuthUrl` as-is (it's a promise fn, not an Action)
- **Details:**
  - Actually, `getAuthUrl` is passed from the route as `useServerFn(getGoogleAuthUrl)` — it's already a plain async function
  - The button's internal state management is appropriate for a one-shot redirect action
  - **Decision:** Leave as-is. The button does a `window.location.href` redirect — it can't meaningfully use `Action` because the page unloads.

## Phase 2: Review loop — check all routes + components for remaining issues

- Run `tsc --noEmit`
- Verify all conventions compliance
- Check for any missed patterns
- Loop until clean
