# Review 3: Domain Layer Purity

**Date:** 2026-05-23
**Branch:** feat/phase-15c-goal-ui
**Reviewer:** Automated domain purity scan
**Scope:** All `src/contexts/*/domain/` directories (12 contexts, 54 non-test files)

## Summary

The domain layer is in **strong shape overall**. All entity IDs use branded types from `#/shared/domain/ids`. All constructors return `Result` via neverthrow. All entities use `Readonly<>` wrappers. No framework imports, no `async`, no I/O, no `class`, no `this`, no `enum`. Time and random are properly injected via `now: Date` or `clock: () => Date` parameters. The `referral-code.ts` module injects `randomBytesFn` as a dependency rather than calling `crypto` directly.

A small number of violations were found: exhaustive-check `throw` statements in goal domain (forbidden per architecture), mutable array types in dashboard (violates `ReadonlyArray<T>` rule), non-Readonly input types in review constructors, and several identifier-like fields using raw `string` instead of branded types.

---

## Findings

### [MINOR] 1. `throw new Error()` in domain — goal context (3 instances)

**File:** `src/contexts/goal/domain/constructors.ts`
**Quote:** `throw new Error(`Unhandled goal type: ${\_exhaustive}`)` (line 140)
**Rule:** Domain layer forbids `throw`. Per `src/contexts/CONTEXT.md` line 44: domain is forbidden from using `throw`. Per error pattern (line 132): "Domain: Returns `Result<T, DomainError>`. Never throws."
**Fix:** Return `err()` with a tagged error instead. The exhaustive check can be preserved as a type-level assertion via a helper: `const _exhaustive: never = input.goalType; return err(...)`.

---

**File:** `src/contexts/goal/domain/progress-strategy.ts`
**Quote:** `throw new Error(`Unhandled goal type: ${\_exhaustive}`)` (line 125)
**Rule:** Same as above.
**Fix:** Same as above — return `err()` with a `ProgressQueryError` variant.

---

**File:** `src/contexts/goal/domain/progress-strategy.ts`
**Quote:** `throw new Error(`Unhandled aggregation: ${\_exhaustive}`)` (line 160)
**Rule:** Same as above.
**Fix:** Return `err()` or add a tagged error variant for unhandled aggregation.

---

### [NIT] 2. Mutable array fields inside `Readonly<>` — dashboard context (3 instances)

**File:** `src/contexts/dashboard/domain/types.ts`
**Quote:**

- `ratingTrend: RatingTrendPoint[]` (line 98)
- `reviewVolume: ReviewVolumePoint[]` (line 99)
- `recentReviews: RecentReview[]` (line 102)

**Rule:** Per `src/contexts/CONTEXT.md` line 119: "`readonly` on all domain fields. `ReadonlyArray<T>` in domain." While the parent `DashboardData` type is wrapped in `Readonly<>`, this only freezes the reference, not the array contents. The arrays are still mutable at the element level.
**Fix:** Change to `readonly RatingTrendPoint[]` / `readonly ReviewVolumePoint[]` / `readonly RecentReview[]` (or `ReadonlyArray<T>`).

---

### [NIT] 3. Non-`Readonly` input types — review constructors (2 instances)

**File:** `src/contexts/review/domain/constructors.ts`
**Quote:**

- `type BuildReviewArgs = {` (line 18) — no `Readonly<>` wrapper
- `type BuildReplyArgs = {` (line 50) — no `Readonly<>` wrapper

**Rule:** Per `src/contexts/CONTEXT.md` line 119: "`readonly` on all domain fields." All other contexts use `Readonly<>` on their input types (e.g., `BuildGoalInput`, `BuildPortalInput`, `BuildStaffAssignmentInput`).
**Fix:** Wrap in `Readonly<{}>` to match the established pattern across all other contexts.

---

### [NIT] 4. Behavior (validation function) in `types.ts` — dashboard context

**File:** `src/contexts/dashboard/domain/types.ts`
**Quote:** `export function toDashboardReplyStatus(value: string): Result<DashboardReplyStatus, string>` (line 78)
**Rule:** Per architecture, `types.ts` files contain data types only. Behavior (validation, construction) belongs in `rules.ts` or `constructors.ts`. All other contexts follow this separation strictly.
**Fix:** Move `toDashboardReplyStatus()` and its `DASHBOARD_REPLY_STATUSES` constant to `dashboard/domain/rules.ts` (create if needed) or inline at the mapper level.

---

### [NIT] 5. Primitive obsession on identifier-like fields (multiple instances)

Several fields carry identifier semantics but use raw `string` instead of branded types:

**File:** `src/contexts/guest/domain/types.ts`
**Quote:** `sessionId: string` (lines 19, 30, 43)
**Rule:** Primitive obsession — `sessionId` identifies a guest session across `ScanEvent`, `Rating`, and `Feedback`. Should be a branded `SessionId` type for type safety.
**Fix:** Add `type SessionId = Brand<string, 'SessionId'>` to `#/shared/domain/ids` and use it here.

---

**File:** `src/contexts/review/domain/types.ts`
**Quote:** `externalId: string` and `externalLocationId: string` (lines 30–31, 75–76)
**Rule:** These are external platform identifiers that could be confused with each other or with internal IDs. Branded types would prevent accidental substitution.
**Fix:** Consider `ExternalReviewId` and `ExternalLocationId` branded types, or at minimum a shared `ExternalId` brand.

---

**File:** `src/contexts/integration/domain/types.ts`
**Quote:** `googleAccountId: string` (line 21), `gbpPlaceId: string` (lines 40, 72)
**Rule:** External identifiers that cross context boundaries (integration ↔ property). `gbpPlaceId` also appears in `property/domain/types.ts` as `string | null`.
**Fix:** Consider branded `GoogleAccountId` and `GbpPlaceId` types in `#/shared/domain/ids`.

---

**File:** `src/contexts/property/domain/types.ts`
**Quote:** `gbpPlaceId: string | null` (line 15)
**Rule:** Same `gbpPlaceId` as integration context — shared concept should be a branded type.

---

### [NIT] 6. `inbox/domain/types.ts` — `platform: string | null` should be union type

**File:** `src/contexts/inbox/domain/types.ts`
**Quote:** `platform: string | null` (line 26)
**Rule:** Per architecture, domain types should use closed unions rather than open `string`. The only known platform is `'google'` (matching `ReviewPlatform` in review context).
**Fix:** Change to `platform: ReviewPlatform | null` (importing `ReviewPlatform` from review's public API) or define `type InboxPlatform = 'google' | null`.

---

## Clean Areas (No Violations Found)

- **Framework imports:** Zero React, Drizzle, better-auth, @tanstack, fetch, or `process.env` imports in any domain file.
- **`new Date()` for current time:** All production domain code receives time via injected `now: Date` or `clock: () => Date`. The only `new Date(timestamp)` call in `review/domain/rules.ts:21` is pure arithmetic on an injected value, not a system clock read.
- **Random/UUID inline:** No inline `crypto.randomUUID()`, `uuid()`, `nanoid()`, or `Math.random()` in domain. The `staff/domain/referral-code.ts` properly injects `randomBytesFn`.
- **Mutable public fields:** All entity types use `Readonly<>` wrapper. No `class` or `this` usage. No `enum` usage.
- **Anemic entities:** Not flagged. The architecture explicitly uses functional style: types are data-only, behavior lives in `rules.ts` and `constructors.ts`. This is a deliberate design choice (documented in multiple `types.ts` headers), not an anemic anti-pattern.
- **Core ID branding:** All primary entity IDs (OrganizationId, PropertyId, ReviewId, etc.) are properly branded via `#/shared/domain/ids`.
- **Error pattern:** All contexts use tagged error shapes with `_tag`, smart constructors, and type guards. Domain returns `Result`, never throws (except the 3 exhaustive-check violations above).

---

## Final Counts

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 0      |
| MAJOR     | 0      |
| MINOR     | 3      |
| NIT       | 12     |
| **Total** | **15** |

**Total findings: 15**
