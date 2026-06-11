# Inbox Context — Infrastructure & Server Review

**Reviewed:** 2026-06-10
**Scope:** `src/contexts/inbox/infrastructure/`, `src/contexts/inbox/server/`
**Dimensions:** D5, D7, D8, D12, D15

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 2     |
| MAJOR    | 5     |
| MINOR    | 3     |
| NIT      | 2     |

---

## Findings

### BLOCKER

````
[D15] [BLOCKER] throw new Error in infrastructure repository
  File: src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:219,244,294
  Quote: ```throw new Error('Inbox item insert failed — no row returned')
throw new Error('Inbox item status update failed — no row returned')
throw new Error('Inbox item assignment update failed — no row returned')```
  Rule:  D15 — No throw new Error in domain/application; infrastructure should use tagged errors or domain error factories
  Fix:   Replace with a domain-level InboxError (e.g. `inboxError('not_found', ...)`) or a shared infrastructure error type. Callers cannot pattern-match plain Error.
````

````
[D15] [BLOCKER] throw new Error in inbox-note repository
  File: src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts:32,39
  Quote: ```throw new Error(`InboxNote.create: tenant mismatch — note.orgId=...`)
throw new Error('Inbox note insert failed — no row returned')```
  Rule:  D15 — No bare throw new Error; use tagged error types
  Fix:   Use InboxError with appropriate code or a shared infrastructure error. The tenant-mismatch guard is good defense-in-depth but should not produce an untyped error.
````

### MAJOR

````
[D7] [MAJOR] create() in inbox repository has no orgId WHERE clause
  File: src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:213-223
  Quote: ```create: async (item: InboxItem) => {
    return trace('inbox.create', async () => {
      const row = inboxItemToInsertRow(item)
      const result = await db.insert(inboxItems).values(row).returning()
````

Rule: D7 — Every DB query on tenant-owned table has organizationId
Fix: INSERT does not use a WHERE clause, but should validate `item.organizationId` is set. More importantly, there is no tenant-mismatch guard (unlike inbox-note.repository.ts which checks `note.organizationId !== orgId`). Add an `orgId` parameter and assertion matching the note repo pattern, or pass orgId through the port interface.

```

```

[D12] [MAJOR] CONTEXT.md claims review.updated consumed but event-handlers/index.ts also registers review.reply.submitted which is undocumented
File: src/contexts/inbox/infrastructure/event-handlers/index.ts:39-44
Quote: `deps.events.on(
    'review.reply.submitted',
    onReplySubmitted({ repo: deps.repo }),
  )`
Rule: D12 — CONTEXT.md "Events consumed" table must match actual code
Fix: Add `review.reply.submitted` to the CONTEXT.md "Events consumed" table with handler action "Set firstReplySubmittedAt milestone on inbox item".

```

```

[D12] [MAJOR] CONTEXT.md server functions table is missing getInboxFolderCountsFn
File: src/contexts/inbox/server/inbox-queries.ts:133-164
Quote: `export const getInboxFolderCountsFn = createServerFn({ method: 'GET' })`
Rule: D12 — CONTEXT.md "Server functions" table must match actual code
Fix: Add `getInboxFolderCountsFn` (GET, `inbox.read`) to the CONTEXT.md server functions table.

```

```

[D15] [MAJOR] Silent error swallowing in redis-new-counter adapter
File: src/contexts/inbox/infrastructure/adapters/redis-new-counter.ts:40-42,48-49,60-62,68-70,76-78,84-86
Quote: `} catch {
    return 0 // Redis down — serve 0, don't crash
  }`
Rule: D15 — No bare catch, no swallowed errors; errors should be logged at minimum
Fix: Import getLogger and log at warn/error level inside each catch block. The comment says "log would go here if logger was available" — logger is already available via `#/shared/observability/logger`. The `setCount` and `increment` catches especially need logging since silent data loss could occur.

```

```

[D5] [MAJOR] Repository create() port accepts no orgId — inconsistent with other methods
File: src/contexts/inbox/application/ports/inbox.repository.ts:52
Quote: `create(item: InboxItem): Promise<InboxItem>`
Rule: D5 — Port factory create{Entity}Repository(db), adapter returns domain types; all mutations should carry tenant context
Fix: Add `orgId: OrganizationId` parameter to `create()` (matching the `InboxNoteRepository` pattern where `create(note, orgId)` validates tenant). The Drizzle adapter should assert `item.organizationId === orgId` before insert.

```

### MINOR

```

[D12] [MINOR] CONTEXT.md architecture layers omits on-reply-submitted.ts from event-handlers listing
File: src/contexts/inbox/CONTEXT.md:83-84
Quote: `event-handlers/    on-review-created.ts, on-review-updated.ts, on-feedback-submitted.ts,
                      on-reply-published.ts`
Rule: D12 — CONTEXT.md claims must match actual code
Fix: Add `on-reply-submitted.ts` to the event-handlers file listing in CONTEXT.md.

```

```

[D7] [MINOR] inbox-note.repository create() tenant guard uses throw new Error instead of domain error
File: src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts:30-33
Quote: ``if (note.organizationId !== orgId) {
    throw new Error(`InboxNote.create: tenant mismatch — ...`)
  }``
Rule: D7/D15 — Tenant guard is good practice but error should be typed
Fix: While the guard itself is correct defense-in-depth, the error should be an InboxError or ForbiddenError to allow callers to handle it properly.

```

```

[D5] [MINOR] InboxNoteRepository port has only 2 methods — findByInboxItemId and create
File: src/contexts/inbox/application/ports/inbox-note.repository.ts:7-13
Quote: `export type InboxNoteRepository = Readonly<{
  findByInboxItemId(...): Promise<...>
  create(note: InboxNote, orgId: OrganizationId): Promise<InboxNote>
}>`
Rule: D5 — Port naming convention {Entity}Repository
Fix: The port is correctly named and minimal. No issue — noted for completeness. The asymmetry with InboxRepository.create (no orgId param) is a minor naming concern already captured above.

```

### NIT

```

[D8] [NIT] getNewCountFn and getInboxFolderCountsFn accept data but ignore it
File: src/contexts/inbox/server/inbox-queries.ts:103,137-138
Quote: `async ({ data: _data }) => {
    void _data`
Rule: D8 — Input validation via DTO
Fix: If these DTOs validate only organizationId (which comes from auth context), consider whether the inputValidator is needed at all. If the DTO is `z.object({})`, remove the unused `_data` parameter and void. Otherwise, these functions work correctly — purely cosmetic.

```

```

[D15] [NIT] Event handlers catch non-InboxError errors with only log.error — no reclassification
File: src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts:29-35
Quote: `} catch (err) {
    if (isInboxError(err) && err.code === 'already_exists') return
    getLogger().error({ err, reviewId: event.reviewId }, 'inbox: failed to handle ...')
  }`
Rule: D15 — Consistent error envelope
Fix: This is the correct pattern for event handlers (idempotent, errors logged not propagated per Q12 decision). No action needed. Noted as correct-by-design.

```

---

## Dimension-by-Dimension Notes

### D5 — Repository & Port Standards
- **Port location:** Both ports correctly placed in `application/ports/`.
- **Factory pattern:** `createInboxRepository(db, ports)` and `createInboxNoteRepository(db)` — both factory functions returning `Readonly<{ method }>`. Correct.
- **Domain-generated IDs:** `inboxItemToInsertRow` maps branded IDs to unbranded for Drizzle. Correct.
- **Adapter returns domain types:** Mappers convert rows → domain types with branded IDs. Correct.
- **Issue:** `InboxRepository.create()` takes no `orgId` parameter, inconsistent with `InboxNoteRepository.create(note, orgId)`.

### D7 — Multi-Tenancy
- **Every SELECT includes `organizationId`:** findById, findByIds, findBySource, findFilteredPaginated, findDetailById, countByStatus — all have `eq(inboxItems.organizationId, orgId)`. ✓
- **Every UPDATE includes `organizationId`:** updateStatus, bulkUpdateStatus, updateAssignment, syncDenormalizedFields — all have `eq(inboxItems.organizationId, orgId)`. ✓
- **Note repo:** findByInboxItemId and create both include orgId. ✓
- **Issue:** `InboxRepository.create()` (INSERT) has no orgId guard — relies on the `item` object's `organizationId` field being correct. Should add assertion.
- **organizationId source:** All server functions derive `ctx.organizationId` from `resolveTenantContext(headers)` — never from request body. ✓

### D8 — Server Functions
- **All wrapped in `createServerFn` + `tracedHandler`:** ✓
- **Auth middleware:** Every handler calls `resolveTenantContext(headers)`. ✓
- **Input validation:** Every handler uses `.inputValidator(dtoSchema)`. ✓
- **Permission check:** Every handler calls `can(ctx.role, 'inbox.read'|'inbox.write')`. ✓
- **Use case from composition:** `getContainer().useCases.xxx(...)`. ✓
- **Server functions present (8):** getInboxItemsFn, updateInboxStatusFn, bulkUpdateInboxStatusFn, assignInboxItemFn, addInboxNoteFn, getNewCountFn, getInboxItemDetailFn, getInboxNotesFn. ✓
- **Missing from CONTEXT.md:** getInboxFolderCountsFn is implemented but not listed in server functions table.

### D12 — CONTEXT.md Accuracy
- **Events consumed — documented:** review.created, review.updated, guest.feedback.submitted, review.reply.published
- **Events consumed — actual:** review.created, guest.feedback.submitted, review.updated, review.reply.published, **review.reply.submitted** (extra, undocumented)
- **Server functions — documented:** 8 functions
- **Server functions — actual:** 9 functions (getInboxFolderCountsFn missing from CONTEXT.md)
- **Architecture layers:** on-reply-submitted.ts missing from event-handlers file listing

### D15 — Error Handling
- **Domain errors:** `InboxError` with `_tag: 'InboxError'` and typed codes. Correct.
- **Server layer:** Uses `isInboxError(e)` → `throwContextError(...)` with exhaustive HTTP status mapping. Correct.
- **Issue:** Repository layer uses `throw new Error(...)` for DB failures — not tagged, not catchable by type.
- **Issue:** Redis adapter swallows all errors silently with `catch {}` — no logging despite logger being available.
```
