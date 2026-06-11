# Inbox Context — Domain & Application Layer Review

**Reviewed:** domain/, application/, build.ts, build-use-cases.ts
**Dimensions:** D2 (Events), D3 (Use Cases), D4 (Build Function), D11 (Domain Purity), D12 (CONTEXT.md Accuracy), D15 (Error Handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 2     |
| MAJOR    | 5     |
| MINOR    | 5     |
| NIT      | 2     |

---

## BLOCKER

### [D3] BLOCKER getInboxItemDetail missing `can(role, 'inbox.read')` authorization gate

File: src/contexts/inbox/application/use-cases/get-inbox-item-detail.ts:28
Quote: ```ts
async (input: GetInboxItemDetailInput): Promise<InboxItemDetail> => {
const detail = await deps.repo.findDetailById(input.inboxItemId, input.organizationId)

````
Rule:  D3 — Steps: Authorize → Load → Check rules → Build domain → Persist → Emit events → Return
Fix:   Add `if (!can(input.role, 'inbox.read')) { throw inboxError('forbidden', 'No inbox read permission') }` before the repo call. CONTEXT.md documents this use case requires `inbox.read`.

### [D3] BLOCKER addInboxNote missing `can(role, 'inbox.write')` authorization gate
File: src/contexts/inbox/application/use-cases/add-inbox-note.ts:41
Quote: ```ts
async (input: AddInboxNoteInput): Promise<InboxNote> => {
  // 1. Find item
  const item = await deps.repo.findById(input.inboxItemId, input.organizationId)
````

Rule: D3 — Steps: Authorize → Load → Check rules → Build domain → Persist → Emit events → Return
Fix: Add `if (!can(input.role, 'inbox.write')) { throw inboxError('forbidden', 'No inbox write permission') }` before the repo call. CONTEXT.md documents this use case requires `inbox.write`.

---

## MAJOR

### [D3] MAJOR getInboxNotes missing `can(role, 'inbox.read')` authorization gate

File: src/contexts/inbox/application/use-cases/get-inbox-notes.ts:30
Quote: ```ts
async (input: GetInboxNotesInput): Promise<ReadonlyArray<InboxNote>> => {
const item = await deps.repo.findById(input.inboxItemId, input.organizationId)

````
Rule:  D3 — Steps: Authorize → Load. CONTEXT.md lists `inbox.read` permission.
Fix:   Add `if (!can(input.role, 'inbox.read')) { throw inboxError('forbidden', ...) }` before the repo call. Same pattern as `getInboxItems`.

### [D15] MAJOR Use cases throw domain errors instead of returning Result
File: src/contexts/inbox/application/use-cases/update-inbox-status.ts:68
Quote: ```ts
if (transitionResult.isErr()) {
  throw transitionResult.error
}
````

Rule: D15 — No throw new Error in domain/application. Also violates D3 — use cases should return typed errors via Result, not throw.
Fix: Return `Result<InboxItem, InboxError>` from the use case function. Unwrap `transitionResult` and other errors via Result propagation instead of throw. This pattern repeats across: `create-inbox-item.ts:75`, `assign-inbox-item.ts:42-43`, `add-inbox-note.ts:79-80`, `getInboxItems.ts:34`, `getNewCount.ts:32`, `getFolderCounts.ts:33-35`, `getInboxItemDetail.ts:31-34`, `getInboxNotes.ts:33-36`.

### [D12] MAJOR CONTEXT.md claims `getInboxItemDetail` has permission `inbox.read` but use case never checks it

File: src/contexts/inbox/CONTEXT.md:95
Quote: ```  |`getInboxItemDetail`   | inboxItemId, organizationId, userId, role                           |`InboxItemDetail`    |`inbox.read` |

````
Rule:  D12 — Verify CONTEXT.md claims match actual code.
Fix:   Either add the `can(input.role, 'inbox.read')` check to the use case, or update CONTEXT.md to reflect that only property-scoped access control is enforced.

### [D12] MAJOR CONTEXT.md claims `addInboxNote` has permission `inbox.write` but use case never checks it
File: src/contexts/inbox/CONTEXT.md:99
Quote: ```
| `addInboxNote`          | inboxItemId, organizationId, authorUserId, text, role               | `InboxNote`           | `inbox.write` |
````

Rule: D12 — Verify CONTEXT.md claims match actual code.
Fix: Add the `can(input.role, 'inbox.write')` authorization gate to `addInboxNote` use case.

### [D12] MAJOR CONTEXT.md claims `getInboxNotes` has permission `inbox.read` but use case never checks it

File: src/contexts/inbox/CONTEXT.md:101
Quote: ```  |`getInboxNotes`        | inboxItemId, organizationId, userId, role                           |`InboxNote[]`        |`inbox.read` |

````
Rule:  D12 — Verify CONTEXT.md claims match actual code.
Fix:   Add the `can(input.role, 'inbox.read')` authorization gate to `getInboxNotes` use case.

---

## MINOR

### [D2] MINOR Event constructor `inboxItemCreated` allows empty-string `inboxItemId` via assertion on `!== ''` instead of branded ID validation
File: src/contexts/inbox/domain/events.ts:36
Quote: ```ts
assert(args.inboxItemId !== '', 'inboxItemId required')
````

Rule: D2 — Constructor validation: assertions for impossible states.
Fix: The assertion checks for empty string but accepts any non-empty string. Other constructors (e.g. `inboxItemStatusChanged`, `inboxItemAssigned`) don't assert `inboxItemId` at all — inconsistent. Either assert on all constructors or validate the ID format.

### [D2] MINOR Event constructors use `crypto.randomUUID()` directly instead of IdGenerator port

File: src/contexts/inbox/domain/events.ts:39
Quote: ```ts
eventId: crypto.randomUUID(),

````
Rule:  D11 — Time via Clock port, UUID via IdGenerator.
Fix:   Accept an `idGen` parameter (or use a passed-in function) for `eventId` generation to maintain domain purity. `crypto.randomUUID()` is a Node.js global which violates the port abstraction principle.

### [D2] MINOR Event constructors silently default `propertyId` and `userId` to empty-string cast as branded types
File: src/contexts/inbox/domain/events.ts:41-42
Quote: ```ts
propertyId: args.propertyId ?? ('' as PropertyId),
userId: args.userId ?? ('' as UserId),
````

Rule: D2 — Constructor validation: assertions for impossible states.
Fix: These empty-string branded IDs represent missing data. For `InboxItemCreated`, CONTEXT.md notes `userId` can be absent (system action) — use `null` explicitly in the type instead of an empty branded string. Same for `propertyId`.

### [D3] MINOR `CreateInboxItemInput` in use case doesn't match CONTEXT.md signature

File: src/contexts/inbox/application/use-cases/create-inbox-item.ts:21-30
Quote: ```ts
export type CreateInboxItemInput = Readonly<{
organizationId: OrganizationId
propertyId: PropertyId
sourceType: SourceType
sourceId: ReviewId | FeedbackId
rating: number | null
sourceDate: Date
platform: string | null
snippet: string | null
}>

````
Rule:  D12 — CONTEXT.md lists: `organizationId, propertyId, sourceType, sourceId, rating?, snippet?`
Fix:   CONTEXT.md omits `sourceDate` and `platform` from the Input column. Update CONTEXT.md to include these fields, or note they're internally derived.

### [D3] MINOR `getFolderCounts` doesn't enforce property scoping for non-admin users
File: src/contexts/inbox/application/use-cases/get-folder-counts.ts:32-54
Quote: ```ts
async (input: GetInboxFolderCountsInput): Promise<InboxFolderCounts> => {
  if (!can(input.role, 'inbox.read')) {
    throw inboxError('forbidden', 'No inbox read permission')
  }
  const [newCount, readCount, escalated, addressed, archived] = await Promise.all([
    deps.repo.countByStatus(input.organizationId, 'new'),
````

Rule: D7 — Every DB query on tenant-owned table should be scoped to user-accessible properties for non-admin users.
Fix: If folder counts should reflect only accessible properties (sidebar behavior), pass `userId` and enforce property scoping via `staffPublicApi.getAccessiblePropertyIds`. If org-wide counts are intentional, document this in CONTEXT.md. `repo.countByStatus` currently takes only `orgId`.

---

## NIT

### [D4] NIT `publicApi` typed as `Record<string, never>` — dead export surface

File: src/contexts/inbox/build.ts:45
Quote: ```ts
publicApi: Record<string, never>

````
Rule:  D4 — Build function returns context API surface.
Fix:   If no public API is exposed yet, remove `publicApi` from the type. The current empty record is misleading — other contexts (e.g. staff) expose meaningful public APIs. Consider whether event types and domain types should be exposed here instead of only via `application/public-api.ts`.

### [D3] NIT `getInboxItemDetail` uses dynamic import type inside runtime code
File: src/contexts/inbox/application/use-cases/get-inbox-item-detail.ts:45-47
Quote: ```ts
detail.item.propertyId as ReturnType<
  typeof import('#/shared/domain/ids').propertyId
>,
````

Rule: Style — this pattern is used in 5 use case files.
Fix: Import `propertyId` at the top of the file and use `ReturnType<typeof propertyId>` directly. The inline import type syntax is harder to read and inconsistent with how other type imports work in the same files.
