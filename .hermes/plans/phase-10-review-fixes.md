# Phase 10 Review Context — Fix Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix all 22 issues found in the Phase 10 review context audit (4 P0, 5 P1, 7 P2, 6 P3).

**Architecture:** Tenant isolation fixes (P0) are the highest priority — every repo query, delete, and unique index must include `organizationId`. P1/P2 fixes improve architecture compliance. P3 are style/nice-to-have.

**Working directory:** `/Users/bozhidardenev/conductor/workspaces/reputation-key/guangzhou`

---

## Phase 1: P0 — Tenant Isolation (4 tasks)

### Task 1: Add `organizationId` to `findByPropertyId` port + repo

**Objective:** Fix cross-tenant data leak in review `findByPropertyId`.

**Files:**
- Modify: `src/contexts/review/application/ports/review.repository.ts`
- Modify: `src/contexts/review/infrastructure/repositories/review.repository.ts`

**Step 1:** Update port signature — add `organizationId` parameter:

```ts
// review.repository.ts port — change this line:
findByPropertyId(propertyId: PropertyId): Promise<ReadonlyArray<Review>>
// to:
findByPropertyId(propertyId: PropertyId, organizationId: OrganizationId): Promise<ReadonlyArray<Review>>
```

**Step 2:** Update repo implementation — add `organizationId` to WHERE:

```ts
// review.repository.ts impl — change findByPropertyId to:
findByPropertyId: async (propertyId: PropertyId, organizationId: OrganizationId) => {
  return trace('review.findByPropertyId', async () => {
    const rows = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.propertyId, propertyId),
          eq(reviews.organizationId, organizationId),
        ),
      )
      .limit(500)
    return rows.map(reviewFromRow)
  })
},
```

**Step 3:** Search all callers of `findByPropertyId` and pass `organizationId`:
```bash
grep -rn "findByPropertyId" src/
```

**Step 4:** Run `npx tsc --noEmit` to verify no type errors.

**Step 5:** Commit: `fix: add organizationId to review findByPropertyId for tenant isolation`

---

### Task 2: Add `organizationId` to `deleteById` port + repo (review)

**Objective:** Fix cross-tenant deletion in review `deleteById`.

**Files:**
- Modify: `src/contexts/review/application/ports/review.repository.ts`
- Modify: `src/contexts/review/infrastructure/repositories/review.repository.ts`

**Step 1:** Update port signature:

```ts
// Change:
deleteById(id: ReviewId): Promise<void>
// To:
deleteById(id: ReviewId, organizationId: OrganizationId): Promise<void>
```

**Step 2:** Update repo implementation:

```ts
deleteById: async (id: ReviewId, organizationId: OrganizationId) => {
  return trace('review.deleteById', async () => {
    await db.delete(reviews).where(
      and(eq(reviews.id, id), eq(reviews.organizationId, organizationId)),
    )
  })
},
```

**Step 3:** Update all callers. Key caller: `purge-expired-reviews.job.ts` — pass `review.organizationId`:

```ts
// In purge job loop:
await deps.reviewRepo.deleteById(review.id, review.organizationId)
```

**Step 4:** Run `npx tsc --noEmit`.

**Step 5:** Commit: `fix: add organizationId to review deleteById for tenant isolation`

---

### Task 3: Add `organizationId` to `deleteByPropertyId` port + repo (review)

**Objective:** Fix cross-tenant deletion in review `deleteByPropertyId`.

**Files:**
- Modify: `src/contexts/review/application/ports/review.repository.ts`
- Modify: `src/contexts/review/infrastructure/repositories/review.repository.ts`

**Step 1:** Update port signature:

```ts
// Change:
deleteByPropertyId(propertyId: PropertyId): Promise<void>
// To:
deleteByPropertyId(propertyId: PropertyId, organizationId: OrganizationId): Promise<void>
```

**Step 2:** Update repo implementation:

```ts
deleteByPropertyId: async (propertyId: PropertyId, organizationId: OrganizationId) => {
  return trace('review.deleteByPropertyId', async () => {
    await db.delete(reviews).where(
      and(eq(reviews.propertyId, propertyId), eq(reviews.organizationId, organizationId)),
    )
  })
},
```

**Step 3:** Search and update all callers:
```bash
grep -rn "deleteByPropertyId" src/
```

**Step 4:** Run `npx tsc --noEmit`.

**Step 5:** Commit: `fix: add organizationId to review deleteByPropertyId for tenant isolation`

---

### Task 4: Add `organizationId` to `deleteById` port + repo (reply)

**Objective:** Fix cross-tenant deletion in reply `deleteById`.

**Files:**
- Modify: `src/contexts/review/application/ports/reply.repository.ts`
- Modify: `src/contexts/review/infrastructure/repositories/reply.repository.ts`

**Step 1:** Update port signature:

```ts
// Change:
deleteById(id: ReplyId): Promise<void>
// To:
deleteById(id: ReplyId, organizationId: OrganizationId): Promise<void>
```

**Step 2:** Update repo implementation:

```ts
deleteById: async (id: ReplyId, organizationId: OrganizationId) => {
  return trace('reply.deleteById', async () => {
    await db.delete(replies).where(
      and(eq(replies.id, id), eq(replies.organizationId, organizationId)),
    )
  })
},
```

**Step 3:** Search and update all callers:
```bash
grep -rn "replyRepo.deleteById\|reply\.deleteById" src/
```

**Step 4:** Run `npx tsc --noEmit`.

**Step 5:** Commit: `fix: add organizationId to reply deleteById for tenant isolation`

---

## Phase 2: P1 — Architecture Compliance (5 tasks)

### Task 5: Add `invalid_reply` error code and fix constructor

**Objective:** Fix semantically wrong error code in `buildReply` constructor.

**Files:**
- Modify: `src/contexts/review/domain/errors.ts`
- Modify: `src/contexts/review/domain/constructors.ts`

**Step 1:** Add `'invalid_reply'` to `ReviewErrorCode` union:

```ts
export type ReviewErrorCode =
  | 'unauthorized'
  | 'property_not_found'
  | 'connection_not_found'
  | 'connection_inactive'
  | 'sync_failed'
  | 'invalid_rating'
  | 'invalid_reply'       // NEW
  | 'review_not_found'
  | 'reply_not_found'
  | 'reply_already_exists'
```

**Step 2:** Fix `buildReply` in `constructors.ts`:

```ts
// Change:
return err(reviewError('reply_not_found', 'Reply text cannot be empty'))
// To:
return err(reviewError('invalid_reply', 'Reply text cannot be empty'))
```

**Step 3:** Run `npx tsc --noEmit`.

**Step 4:** Commit: `fix: use correct error code for empty reply text`

---

### Task 6: Add logging to sync loop per-item catch block

**Objective:** Stop silently swallowing errors in the sync reviews loop.

**Files:**
- Modify: `src/contexts/review/application/use-cases/sync-reviews.ts`

**Step 1:** Import logger at top of file:

```ts
import { getLogger } from '#/shared/observability/logger'
```

**Step 2:** Replace empty catch block (around line 97):

```ts
// Change:
} catch {
  failed++
  continue
}

// To:
} catch (err) {
  getLogger().warn({ err, externalId: gr.externalId }, 'Failed to sync review, continuing')
  failed++
  continue
}
```

**Step 3:** Commit: `fix: log per-item sync failures instead of swallowing silently`

---

### Task 7: Map 429 to `gbp_api_rate_limited` in adapter

**Objective:** Use the correct error code for rate-limited GBP API responses so BullMQ can retry.

**Files:**
- Modify: `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts`

**Step 1:** Add 429 mapping in `fetchReviews` (after `!response.ok` check, around line 67):

```ts
// Change:
if (!response.ok) {
  const body = await response.text()
  throw integrationError('gbp_api_error', `GBP reviews fetch failed: ${response.status} ${body}`)
}

// To:
if (!response.ok) {
  const body = await response.text()
  const code = response.status === 429 ? 'gbp_api_rate_limited' : 'gbp_api_error'
  throw integrationError(code, `GBP reviews fetch failed: ${response.status} ${body}`)
}
```

**Step 2:** Same change in `replyToReview` (around line 117):

```ts
if (!response.ok) {
  const body = await response.text()
  const code = response.status === 429 ? 'gbp_api_rate_limited' : 'gbp_api_error'
  throw integrationError(code, `GBP reply failed: ${response.status} ${body}`)
}
```

**Step 3:** Commit: `fix: map 429 responses to gbp_api_rate_limited error code`

---

### Task 8: Verify GBP `reviewReply.text` field name

**Objective:** Verify whether GBP API uses `.text` or `.comment` for reply text. The adapter currently reads `(raw.reviewReply)?.text` but GBP v4 API uses `.comment`.

**Files:**
- Modify: `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts` (if needed)

**Step 1:** Check the Google My Business API v4 documentation for the `ReviewReply` resource shape. The field is `comment` not `text`.

**Step 2:** If confirmed, fix line ~100:

```ts
// Change:
replyText: (raw.reviewReply as Record<string, unknown> | undefined)?.text as string | null ?? null,
// To:
replyText: (raw.reviewReply as Record<string, unknown> | undefined)?.comment as string | null ?? null,
```

And line ~102:
```ts
// Change:
replyUpdatedAt: (raw.reviewReply as Record<string, unknown> | undefined)?.updateTime
// To:
replyUpdatedAt: (raw.reviewReply as Record<string, unknown> | undefined)?.updateTime
// (this one is correct already — no change needed)
```

**Step 3:** Commit: `fix: use correct GBP API field name for reply text`

---

### Task 9: Re-export `GoogleConnectionVisibilityChanged` from master events

**Objective:** Complete the events barrel — all event types should be re-exported.

**Files:**
- Modify: `src/shared/events/events.ts`

**Step 1:** Add to the Integration context exports block:

```ts
// Integration context events
export type {
  // fallow-ignore-next-line unused-type
  IntegrationEvent,
  // fallow-ignore-next-line unused-type
  GoogleAccountConnected,
  // fallow-ignore-next-line unused-type
  GoogleAccountDisconnected,
  // fallow-ignore-next-line unused-type
  GoogleConnectionVisibilityChanged,   // ADD THIS
  // fallow-ignore-next-line unused-type
  PropertyImportCompleted,
} from '#/contexts/integration/domain/events'
```

**Step 2:** Commit: `fix: re-export GoogleConnectionVisibilityChanged from master events barrel`

---

## Phase 3: P2 — Medium Priority (7 tasks)

### Task 10: Rename system-level query methods for clarity

**Objective:** Make it obvious that `findExpiringBefore`/`findExpiredBefore` are system-level (no tenant filter).

**Files:**
- Modify: `src/contexts/review/application/ports/review.repository.ts`
- Modify: `src/contexts/review/infrastructure/repositories/review.repository.ts`
- Update callers: `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts`, `src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts`

**Step 1:** Rename in port:
```ts
// Change:
findExpiringBefore(date: Date): Promise<ReadonlyArray<Review>>
findExpiredBefore(date: Date): Promise<ReadonlyArray<Review>>
// To:
findAllExpiringBefore(date: Date): Promise<ReadonlyArray<Review>>
findAllExpiredBefore(date: Date): Promise<ReadonlyArray<Review>>
```

**Step 2:** Rename in repo implementation and update callers.

**Step 3:** Commit: `refactor: rename system-level review queries to findAll* prefix`

---

### Task 11: Verify `locationName` vs `externalLocationId` in refresh job

**Objective:** Confirm the refresh-expiring-reviews job uses the correct field for the GBP API location name.

**Files:**
- Possibly modify: `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts`

**Step 1:** Check if `externalLocationId` in the reviews table stores the full `locations/{accountId}/{locationId}` path or just the location ID. The GBP API `batchGetReviews` requires the full location name. If `externalLocationId` is just an ID, the sync will fail.

**Step 2:** If it stores the full path (likely since `sync-reviews.ts` sets it from `gr.externalLocationId` which comes from the adapter's `locationName`), add a code comment documenting this assumption:

```ts
// externalLocationId stores the full GBP location name (e.g., "locations/12345/67890")
// which is required by the reviews API for sync.
locationName: review.externalLocationId,
```

**Step 3:** Commit: `docs: document externalLocationId stores full GBP location name`

---

### Task 12: Clarify webhook route exception in CONTEXT.md

**Objective:** Make the webhook route exception in routes CONTEXT.md explicit about Drizzle schema imports.

**Files:**
- Modify: `src/routes/CONTEXT.md`

**Step 1:** Update the webhook exception section to explicitly list what's allowed:

```markdown
### Webhook route exception

Webhook routes (`routes/api/webhooks/`) are exempt from the standard API route rules. Allowed:
- `getDb()` + Drizzle schema table imports + `drizzle-orm` helpers for resource resolution
- `getContainer()` for queue access (to enqueue background jobs)
- `shared/auth/` imports for token/JWT verification
- Direct `Response` construction (no server fn wrapping needed)

NOT allowed:
- Importing use cases, repositories, or domain logic directly
- Creating new Queue instances (use container's singleton)
```

**Step 2:** Commit: `docs: clarify webhook route exception allows Drizzle imports`

---

### Task 13: Add `organizationId` to `gbp_cache` schema unique index

**Objective:** Tenant-isolate the gbp_cache table unique constraint.

**Files:**
- Modify: `src/shared/db/schema/gbp-cache.schema.ts`

**Step 1:** Add `organizationId` column and update unique index. **Note:** This is a bigger change — `gbp_cache` currently has no `organizationId` column. Adding one requires:
1. Add `organizationId` column to schema
2. Update unique index to include it
3. Update all mappers and repos that read/write gbp_cache
4. Run `drizzle-kit push` to sync

**This task may be deferred** if the table is considered a property-level cache (one property = one org via FK). If deferring, add a code comment and CONTEXT.md note:

```ts
// NOTE: gbp_cache unique index does not include organizationId.
// Tenant isolation relies on the property→organization FK chain.
// If gbp_cache is ever queried directly by organizationId, add the column.
```

**Decision needed:** Defer or implement now?

---

### Task 14: Add JWKS cache invalidation to pubsub verifier

**Objective:** Handle Google key rotation without requiring process restart.

**Files:**
- Modify: `src/shared/auth/pubsub-jwt.verifier.ts`

**Step 1:** Add TTL-based cache invalidation:

```ts
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
let jwksCreatedAt = 0
const JWKS_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

const getJwks = () => {
  const now = Date.now()
  if (!jwks || (now - jwksCreatedAt) > JWKS_CACHE_TTL) {
    jwks = createRemoteJWKSet(new URL(JWKS_URI))
    jwksCreatedAt = now
  }
  return jwks
}
```

**Step 2:** Update test if needed.

**Step 3:** Commit: `fix: add JWKS cache TTL to handle Google key rotation`

---

### Task 15: Normalize webhook success response to `Response.json`

**Objective:** Consistent response format across all API endpoints.

**Files:**
- Modify: `src/routes/api/webhooks/gbp/notifications.ts`

**Step 1:** Change lines 89 and 124:

```ts
// Change both instances of:
return new Response('OK', { status: 200 })
// To:
return Response.json({ ok: true }, { status: 200 })
```

**Step 2:** Commit: `fix: normalize webhook success responses to Response.json`

---

### Task 16: Add comment about single queue architecture in worker

**Objective:** Document the intentional decision to share one queue.

**Files:**
- Modify: `src/worker/index.ts`

**Step 1:** Add comment where the worker is registered:

```ts
// NOTE: All job types (review sync, import, retention) share the 'default' queue.
// At scale, consider separate queues per job type for isolation.
// Single queue is acceptable for current traffic levels.
```

**Step 2:** Commit: `docs: document single-queue decision in worker`

---

## Phase 4: P3 — Low Priority / Backlog (2 tasks)

### Task 17: Add CHECK constraint for rating 1-5 in schema

**Objective:** Defense-in-depth at the DB level.

**Files:**
- Modify: `src/shared/db/schema/review.schema.ts`

**Step 1:** This requires a raw SQL migration or Drizzle custom check. Drizzle doesn't have a `.check()` helper on columns yet. Options:
- Add a raw SQL check via `sql` helper
- Document as backlog item

**Recommendation:** Document as backlog. Domain validation is sufficient.

---

### Task 18: Add comment about `SyncPropertyReviewsJobData` primitive strings

**Objective:** Document why BullMQ job data uses primitives, not branded IDs.

**Files:**
- Modify: `src/contexts/review/application/ports/review-queue.port.ts`

**Step 1:** Add comment:

```ts
// BullMQ serializes job data to JSON — branded types are just strings at runtime.
// Consumer (sync-property-reviews.job) re-brands via id constructors.
// Using string here avoids serialization overhead and keeps BullMQ dashboard readable.
export type SyncPropertyReviewsJobData = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string
  locationName: string
}>
```

**Step 2:** Commit: `docs: document why job data uses primitive strings`

---

## Execution Order

1. **Phase 1 (P0)** — Tasks 1–4 in sequence (each builds on the previous `tsc` check)
2. **Phase 2 (P1)** — Tasks 5–9 (mostly independent, can parallelize 5+6+7+9)
3. **Phase 3 (P2)** — Tasks 10–16 (independent, can parallelize)
4. **Phase 4 (P3)** — Tasks 17–18 (quick wins)

**Verification gate after each phase:** `npx tsc --noEmit && pnpm test`

**Total: 18 tasks across 4 phases. Estimated ~2-3 hours of focused work.**
