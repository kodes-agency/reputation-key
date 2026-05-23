# Phase 14.5 Staff Attribution — Master Review Report

## Executive Summary

3 independent reviewers examined 56 files across architecture, schema/data integrity, and test coverage.
Reviews found issues across all severity levels, with 3 converging P0 findings.

## Consolidated Critical Issues (P0) — MUST FIX

### P0-1: `submitRating` and `submitFeedback` hardcode `staffId: null`

**Source:** Review 01 (Architecture) + Review 03 (Tests)  
**Files:** `src/contexts/guest/application/use-cases/submit-rating.ts`, `submit-feedback.ts`  
**Problem:** Neither use case accepts `staffId` in its input type. Both constructors and event emissions hardcode `staffId: null`. Despite the server function (`public.ts`) correctly calling `getStaffIdForSession` for ratings, the resolved staffId is **silently dropped** because the use case input type doesn't include it.  
**Impact:** Staff attribution for ratings and feedback is completely non-functional.

### P0-2: `getStaffIdForSession` never wired into guest build

**Source:** Review 01 (Architecture)  
**Files:** `src/contexts/guest/build.ts`  
**Problem:** `getStaffIdForSession` is created but not added to the `useCases` object. `public.ts` line 153 calls `useCases.getStaffIdForSession()` which will throw `TypeError` at runtime.  
**Impact:** Runtime crash when any guest submits a rating.

### P0-3: `getLatestScanBySession` lacks tenant isolation

**Source:** Review 02 (Schema/Data Integrity)  
**Files:** `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts`  
**Problem:** Queries by `session_id` only with NO `organizationId` filter. If two organizations generate the same session UUID (unlikely but possible), cross-tenant data leakage occurs.  
**Impact:** Potential cross-tenant staff attribution leak.

## Consolidated High Issues (P1) — SHOULD FIX

### P1-1: `referral_code` has global unique constraint instead of per-org

**Source:** Review 02  
**Files:** `src/shared/db/schema/staff-assignment.schema.ts`  
**Problem:** `.unique()` makes referral codes globally unique across ALL tenants. Two orgs can't use the same code. Should be composite unique `(organization_id, referral_code)`.  
**Impact:** Cross-org insert failures; prevents legitimate same-code reuse.

### P1-2: Guest context directly imports staff repository port (bounded context violation)

**Source:** Review 01  
**Files:** `src/contexts/guest/application/use-cases/record-scan-with-ref.ts`  
**Problem:** `recordScanWithRef` imports `StaffAssignmentRepository` from `staff` context directly. Should use a port/anti-corruption layer.  
**Impact:** Tight coupling between bounded contexts.

### P1-3: Referral code collision not handled at insert time

**Source:** Review 02  
**Files:** `src/contexts/staff/domain/referral-code.ts`  
**Problem:** 4-char hex = 65,536 space. No retry logic on collision. Unique constraint will throw DB error.  
**Impact:** Staff assignment creation fails for rare collisions.

### P1-4: No integration test for full staff attribution flow

**Source:** Review 03  
**Problem:** No test exercises: generate code → resolve → scan with ref → check staffId.  
**Impact:** Regression risk.

### P1-5: Metric event handlers only test `staffId: null` path

**Source:** Review 03  
**Files:** All metric event handler tests  
**Problem:** Non-null staffId pass-through is completely untested.  
**Impact:** Untested code path in production.

## Consolidated Medium Issues (P2)

### P2-1: Missing indexes on `staff_id` columns

**Source:** Review 02  
**Problem:** No indexes on `staff_id` in scan_events, ratings, feedback, metric_readings. Future per-staff analytics queries will be slow.

### P2-2: Missing indexes on `session_id` in scan_events

**Source:** Review 02  
**Problem:** `getLatestScanBySession` queries by session_id without index = full table scan.

### P2-3: `generateReferralCode` uses `randomBytes` (I/O) in domain layer

**Source:** Review 01  
**Problem:** Domain layer should be pure. `randomBytes` is I/O. Should be injected as dependency.

### P2-4: `scanEventFromRow` untested

**Source:** Review 03  
**Problem:** New mapper has no dedicated test. Round-trip correctness unverified.

### P2-5: Mapper tests don't cover non-null staffId round-trips

**Source:** Reviews 02 + 03  
**Problem:** All mapper fixtures use `staffId: null`. Non-null path untested.

### P2-6: `submitFeedbackFn` doesn't call `getStaffIdForSession`

**Source:** Reviews 01 + 03  
**Problem:** Only rating was wired to look up staffId. Feedback was missed.

### P2-7: Duplicate metric key validation sets in two files

**Source:** Review 01  
**Files:** Two metric handler files have identical `VALID_METRIC_KEYS` sets. Should be shared.

## Consolidated Low Issues (P3)

- **P3-1:** `staffId` stores `userId` semantically but typed as `StaffId` — naming confusion (Review 02)
- **P3-2:** No FK on `staff_id` columns — dangling references if users deleted (Review 02)
- **P3-3:** `source` cast in `scanEventFromRow` is unsafe — should validate (Reviews 01 + 03)
- **P3-4:** Portal page `recordScan` call in `useEffect` fires on every mount — no dedup (Review 03)
- **P3-5:** `db:push` needs proper migration for production (Review 02)
- **P3-6:** Slug not truncated — long names risk 50-char column limit (Review 02)

## Positive Findings

- Clean hexagonal layering overall
- Consistent `StaffId` branded type usage across all new code
- Thorough test coverage for the committed slices (8 referral code test cases, mapper tests, constructor tests)
- Proper event design with staffId carried through DomainEvent union
- Metric handlers correctly propagate staff attribution to readings
- Correct null handling in mappers
- Cryptographic randomness for referral codes
- Soft-delete preserves attribution history
- Good use of `resolveReferralCode` as a pure, testable use case

## Priority Fix Order

1. **P0-1** — Add `staffId` to `submitRating`/`submitFeedback` input types, propagate through constructors + events
2. **P0-2** — Wire `getStaffIdForSession` into `guest/build.ts` useCases
3. **P0-3** — Add `organizationId` filter to `getLatestScanBySession`
4. **P1-1** — Change `referral_code` unique to composite `(organization_id, referral_code)`
5. **P2-6** — Add `getStaffIdForSession` call to `submitFeedbackFn`
6. **P1-5** — Add non-null staffId tests to metric event handlers
7. **P2-1/P2-2** — Add indexes on `staff_id` and `session_id` columns
8. Remaining P1/P2/P3 issues

## Detailed Reports

- [14.5-01-architecture.md](14.5-01-architecture.md) — Architecture & Domain Integrity
- [14.5-02-schema-data-integrity.md](14.5-02-schema-data-integrity.md) — Schema, Data Integrity & Tenant Isolation
- [14.5-03-test-coverage-edge-cases.md](14.5-03-test-coverage-edge-cases.md) — Test Coverage & Edge Cases
