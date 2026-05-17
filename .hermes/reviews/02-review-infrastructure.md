# Review: Review Context — Infrastructure

## Summary

Well-structured infrastructure layer with strong tenant isolation, proper upsert patterns, and thorough test coverage. Schema indexes match conventions. Job handlers follow event-before-delete ordering with per-item error resilience. A few convention violations and test gaps worth addressing.

## Critical Issues (P0/P1)

### P1-1: Misleading import path in `reply.repository.test.ts` (line 7)

```typescript
import { createReviewRepository } from '../repositories/review.repository'
```

Both files live in `infrastructure/repositories/`. The path `../repositories/review.repository` navigates up to `infrastructure/` then back into `repositories/` — it works only because it resolves to the same directory. Should be:

```typescript
import { createReviewRepository } from './review.repository'
```

Direct, idiomatic, no ambiguity. The current path will break if the directory is ever moved or aliased differently.

## Warnings (P2/P3)

### P2-1: `reviewToRow` / `replyToRow` pass branded IDs without `as string` unbranding

**Files:** `review.mapper.ts` lines 33–35, `reply.mapper.ts` lines 25–27

The convention states: *"Branded IDs: use `as string` for unbranding."* The `toRow` mappers pass branded IDs (`ReviewId`, `OrganizationId`, `PropertyId`, etc.) directly into Drizzle insert rows. This works at runtime because `Brand<string, T>` is a structural subtype of `string`, but it contradicts the explicit convention. For example:

```typescript
// review.mapper.ts — current
id: review.id,
organizationId: review.organizationId,
propertyId: review.propertyId,

// Expected per convention
id: review.id as string,
organizationId: review.organizationId as string,
propertyId: review.propertyId as string,
```

The `refresh-expiring-reviews.job.ts` already follows this pattern correctly (lines 33–35). Mappers should be consistent.

### P2-2: No cross-org delete protection test for review `deleteById`

**File:** `review.repository.test.ts`

The `deleteById` test (line 267) only tests that ORG_A can delete its own review. It does **not** test that ORG_B attempting to delete ORG_A's review is a no-op (the WHERE clause includes `organizationId`, so the delete would match zero rows). This is a tenant isolation gap in test coverage. The port enforces `organizationId` in the WHERE, but there's no test proving a cross-org delete is harmless.

**What to add:**
```typescript
it('deleteById does not delete review from another org', async () => {
  // seed review for ORG_A, attempt deleteById(review.id, ORG_B)
  // verify review still exists for ORG_A
})
```

### P2-3: No cross-org delete protection tests for reply `deleteById`

**File:** `reply.repository.test.ts`

Same pattern as P2-2. The `deleteById` test (line 224) only tests same-org deletion. No test verifies that `deleteById(reply.id, ORG_B)` when the reply belongs to ORG_A is a safe no-op.

### P2-4: Review mapper round-trip test doesn't cover null `googleConnectionId` path

**File:** `review.mapper.test.ts`

The round-trip test (line 88) uses `sampleRow` which has `googleConnectionId: 'conn-uuid-001'`. While `fromRow` null handling is tested separately (line 61), the round-trip (fromRow → toRow → compare) is never verified with null `googleConnectionId`. The `toRow` function passes `googleConnectionId` through as-is, so this is low risk but still a coverage gap.

### P3-1: Undocumented magic-number query limits

**File:** `review.repository.ts`

- `findByPropertyId`: `.limit(500)` (line 73)
- `findByOrganizationId`: `.limit(500)` (line 84)
- `findAllExpiringBefore`: `.limit(5000)` (line 96)
- `findAllExpiredBefore`: `.limit(5000)` (line 108)
- `reply.repository.ts`: `findByReviewId` has **no limit** at all

These limits are arbitrary, undocumented, and silently truncate results. Consider either:
- Making limits configurable parameters with documented defaults
- Adding a code comment explaining the chosen values
- Adding limits to reply queries too (consistency)

### P3-2: `reply.repository.test.ts` tenant isolation test seeds review for wrong org

**File:** `reply.repository.test.ts`, lines 179–203

The tenant isolation test seeds a review for ORG_A only (via `seedReview`), then creates a reply for ORG_B that references the same `reviewId` (belonging to ORG_A's review). At the DB level, the FK on `replies.reviewId → reviews.id` doesn't enforce org matching, so the insert succeeds. This is valid for testing repo-level filtering, but it creates an unrealistic data state (a reply from ORG_B pointing to ORG_A's review). A more realistic test would seed separate reviews for each org.

## Positive Findings

- **Tenant isolation** is correctly enforced in all repo WHERE clauses. Every tenant-scoped query includes `organizationId`. System-level queries (`findAllExpiringBefore`, `findAllExpiredBefore`) are properly named with `findAll*` prefix and documented as system-level.
- **Upsert patterns** use `onConflictDoUpdate` with correct targets matching the unique indexes — no select-then-write antipattern.
- **Schema indexes** match conventions: unique index on `(platform, externalId, organizationId)` for reviews, `(reviewId, source, organizationId)` for replies, index on `expiresAt`.
- **Event-before-delete ordering** in purge job is correct and verified with a call tracker in tests.
- **Per-item error resilience** in both job handlers — try/catch inside loops, processing continues on failure.
- **Logger mocking** follows convention: `vi.mock('#/shared/observability/logger')` in both job test files.
- **Job data uses primitive strings** — `refresh-expiring-reviews.job.ts` correctly casts branded IDs to `string` for BullMQ serialization with explanatory comments.
- **Mappers** use pure functions, handle nulls correctly, and round-trip tests verify all fields.
- **Named exports only** throughout. Kebab-case filenames. No `any`, no `console.*`.
- **Test coverage** is thorough — upsert conflict resolution, tenant isolation cross-contamination, null handling, edge cases all tested.

## Files Reviewed

| File | Status |
|------|--------|
| `src/shared/db/schema/review.schema.ts` | ✅ Clean |
| `src/contexts/review/domain/types.ts` | ✅ Reference only |
| `src/contexts/review/domain/events.ts` | ✅ Reference only |
| `src/contexts/review/application/ports/review.repository.ts` | ✅ Reference only |
| `src/contexts/review/application/ports/reply.repository.ts` | ✅ Reference only |
| `src/contexts/review/infrastructure/repositories/review.repository.ts` | ✅ Clean |
| `src/contexts/review/infrastructure/repositories/review.repository.test.ts` | ⚠️ P2-2 missing cross-org delete test |
| `src/contexts/review/infrastructure/repositories/reply.repository.ts` | ⚠️ P3-1 no limit on findByReviewId |
| `src/contexts/review/infrastructure/repositories/reply.repository.test.ts` | ⚠️ P1-1 wrong import path, P2-3, P3-2 |
| `src/contexts/review/infrastructure/mappers/review.mapper.ts` | ⚠️ P2-1 branded IDs |
| `src/contexts/review/infrastructure/mappers/review.mapper.test.ts` | ⚠️ P2-4 round-trip null gap |
| `src/contexts/review/infrastructure/mappers/reply.mapper.ts` | ⚠️ P2-1 branded IDs |
| `src/contexts/review/infrastructure/mappers/reply.mapper.test.ts` | ✅ Clean |
| `src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts` | ✅ Clean |
| `src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts` | ✅ Clean |
| `src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.test.ts` | ✅ Clean — exemplary test quality |
| `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts` | ✅ Clean |
| `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.test.ts` | ✅ Clean |
