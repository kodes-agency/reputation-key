# Round 1B: Slop + Dead Code + Type Safety

Branch: `feat/phase-15c-goal-ui`
Date: 2026-05-24

---

### [MAJOR] Duplicate type name `GoalWithProgress` exported from two files

**File:** `src/contexts/goal/server/staff-goals.ts:14` and `src/contexts/goal/application/use-cases/list-goals.ts:14`
**Issue:** Both files `export type GoalWithProgress` with different shapes. The server version is a mutable `{ goal, progress }` while the use-case version is `Readonly<{ goal, progress, instances }>`. Importing the wrong one is a silent type mismatch.
**Fix:** Rename the server version to `StaffGoalEntry` or similar. Remove the re-declaration; re-export from the use-case file if compatible, or use a distinct name.

---

### [MAJOR] Duplicate type names `CreateGoalInput`, `UpdateGoalInput`, `CancelGoalInput` in dto vs use-case

**File:** `src/contexts/goal/application/dto/goal.dto.ts:57,71,79` and `src/contexts/goal/application/use-cases/create-goal.ts:40`, `update-goal.ts:14`, `cancel-goal.ts:14`
**Issue:** Each of these type names is exported from two locations. The DTO version derives from `z.infer<typeof schema>` while the use-case version is a hand-written `Readonly<{...}>`. They may diverge. A consumer importing `CreateGoalInput` could silently get the wrong shape depending on the import path.
**Fix:** Remove the duplicate from use-case files. Re-export from the dto file, or have use-cases accept the DTO type directly.

---

### [MAJOR] `JOB_NAME` exported identically from two files in the same context

**File:** `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts:21` and `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts:16`
**Issue:** Both files `export const JOB_NAME = '...' as const`. If both are imported into the same file, one silently shadows the other. The bootstrap file already works around this with aliasing (`RECONCILE_JOB_NAME`, `SPAWN_JOB_NAME`).
**Fix:** Rename to `RECONCILE_GOAL_JOB_NAME` and `SPAWN_RECURRING_JOB_NAME` respectively (or use a single `GOAL_JOB_NAMES` const object).

---

### [MINOR] Non-null assertions on `jobQueue` in production build functions

**File:** `src/contexts/integration/build.ts:90`, `src/contexts/review/build.ts:60`, `src/contexts/review/build.ts:77`
**Issue:** `deps.jobQueue!.add(...)` and `input.jobQueue!.add(...)` use non-null assertions. If `jobQueue` is `undefined` at runtime, this throws an opaque error instead of a clear one.
**Fix:** Add a guard: `if (!deps.jobQueue) throw new Error('jobQueue is required')`, or make `jobQueue` non-optional in the deps type.

---

### [MINOR] Hardcoded job queue name strings instead of constants

**File:** `src/contexts/integration/build.ts:90`, `src/contexts/review/build.ts:60,77`, `src/worker/index.ts:127,129`, `src/bootstrap.ts:62,82,130`
**Issue:** Job names like `'import-property'`, `'sync-property-reviews'`, `'publish-reply'`, `'reconcile-goal-progress'`, `'spawn-recurring-instances'` are hardcoded strings repeated across build, bootstrap, and worker files. The goal context defines `JOB_NAME` constants but they are not used consistently; other contexts don't define constants at all.
**Fix:** Define a `JOB_NAME` constant in each context's job file (like goal does) and use it everywhere. Import the constant in bootstrap.ts and worker/index.ts.

---

### [MINOR] Inconsistent `build.ts` deps type naming pattern across contexts

**File:** Multiple `src/contexts/*/build.ts`
**Issue:** Two naming patterns coexist:

- **Pattern A** (exported): `XxxContextBuildInput` + `XxxContextApi` — used by `dashboard`, `goal`, `inbox`, `metric`, `review`
- **Pattern B** (unexported): `XxxContextDeps` — used by `guest`, `identity`, `integration`, `portal`, `property`, `staff`, `team`

This means some contexts expose their build input/output types publicly while others keep them private. No architectural justification for the split.
**Fix:** Standardize on one pattern. Given the codebase's "composition root" architecture, `XxxContextDeps` (unexported) seems more appropriate since only `bootstrap.ts` calls these functions. Remove the exported `*BuildInput`/`*Api` types where they exist, or adopt them everywhere.

---

### [MINOR] Dead export: `computeProgressValue` unused outside tests

**File:** `src/contexts/goal/domain/progress-strategy.ts:138`
**Issue:** `computeProgressValue` is exported but never imported by any non-test production code. It was likely superseded by `onMetricRecorded` calling the progress strategy directly.
**Fix:** Remove the export (make it module-private) or delete it if no test depends on it via import.

---

### [MINOR] Local `EventBus` type in goal event handler duplicates shared type

**File:** `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts:13`
**Issue:** Defines `export type EventBus = Readonly<{ emit: ... }>` locally. The shared module `#/shared/events/event-bus` already provides an `EventBus` type. This local version creates a hidden coupling where consumers must match this specific shape rather than the canonical shared type.
**Fix:** Import `EventBus` from `#/shared/events/event-bus` instead of re-declaring it. If a narrower type is needed, use `Pick<EventBus, 'emit'>`.

---

### [NIT] `as any` in test files for mock wiring

**File:** `src/contexts/goal/infrastructure/event-handlers/on-portal-deleted.test.ts:107`, `on-team-deleted.test.ts:107`, `on-staff-unassigned.test.ts:116`, `src/contexts/guest/application/use-cases/track-review-link-click.test.ts:36`
**Issue:** `getLogger: () => logger as any` and `events: throwingBus as any` bypass type checking on mock objects. If the real interface changes, these tests won't catch it.
**Fix:** Use `vi.fn()` with proper typing or `satisfies` to ensure mock matches the real interface shape.

---

### [NIT] No `console.log/warn/error` in production code

**File:** N/A
**Issue:** Clean — no console calls found in `src/`. The codebase consistently uses the pino logger via `getLogger()`.
**Fix:** No action needed.

---

### [NIT] No `@ts-expect-error` suppressions found

**File:** N/A
**Issue:** Zero instances. Type safety is not being suppressed.
**Fix:** No action needed.

---

### [NIT] `pnpm tsc --noEmit` passes cleanly

**File:** N/A
**Issue:** No type errors reported. No unused imports flagged.
**Fix:** No action needed.

---

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 3     |
| MINOR    | 5     |
| NIT      | 4     |

**Top priorities:**

1. Resolve duplicate `GoalWithProgress` / `CreateGoalInput` / etc. type names (MAJOR — silent type mismatch risk)
2. Rename colliding `JOB_NAME` exports (MAJOR — shadowing risk)
3. Guard or type-annotate `jobQueue!` non-null assertions (MINOR — runtime crash risk)
