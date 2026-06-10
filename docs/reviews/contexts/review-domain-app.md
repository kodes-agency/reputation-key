# Review Context — Domain & Application Layer Review

**Date**: 2026-06-10
**Scope**: `src/contexts/review/domain/`, `src/contexts/review/application/`, `src/contexts/review/build.ts`
**Dimensions**: D2 (events), D3 (use cases), D4 (build function), D11 (domain purity), D15 (error handling), D12 (context doc accuracy)

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 1      |
| MAJOR     | 5      |
| MINOR     | 7      |
| NIT       | 3      |
| **Total** | **16** |

---

## Findings

### [D2] BLOCKER Event constructors silently default `userId` to empty string

File: src/contexts/review/domain/events.ts:109,138,168,199
Quote:

```ts
userId: args.userId ?? ('' as UserId),
```

Rule: D2 — Constructor validation: assertions for impossible states. Casting an empty string to `UserId` creates an impossible state (no user has empty-string ID). The type says `UserId` (non-optional, required), but the constructor accepts `userId?: UserId` and falls back to an invalid branded value. Either `userId` is required in the type (constructor should assert it), or the type should be `UserId | null`.
Fix: Make `userId` required in the type and the constructor args. For events where userId genuinely may be absent (e.g., `ReviewReplyPublished` from import), change the type to `userId: UserId | null` and default to `null` instead of `('' as UserId)`.

### [D2] MAJOR Event constructors accept optional `source` but type declares it required

File: src/contexts/review/domain/events.ts:102,131,161,192
Quote:

```ts
& { userId?: UserId; source?: 'web' | 'import' },
```

Rule: D2 — 4-layer consistency: definition → constructor → union → handler. The types `ReviewReplyPublished`, `ReviewReplySubmitted`, `ReviewReplyApproved`, `ReviewReplyRejected` all declare `source: 'web' | 'import'` as required, but the constructors accept `source?` and default to `'web'`. This mismatch means TypeScript won't catch missing `source` at call sites, yet the type claims it's always present. If source can be absent, change the type to `source?: 'web' | 'import'`. If it's required, don't make it optional in the constructor.
Fix: Either make `source` required in the constructor args (matching the type), or add `source` as optional in the type definition.

### [D12] MAJOR CONTEXT.md missing `review.reply.publish_failed` event

File: src/contexts/review/CONTEXT.md:35-43
Quote:

```
## Events produced
- review.created ...
- review.updated ...
- review.expired ...
- review.reply.published ...
- review.reply.submitted ...
- review.reply.approved ...
- review.reply.rejected ...
```

Rule: D12 — CONTEXT.md claims must match actual code. The code defines `ReviewReplyPublishFailed` (`review.reply.publish_failed`) in events.ts, exports it from public-api.ts, and it's used in `markReplyPublishFailed`. CONTEXT.md does not document this event.
Fix: Add `review.reply.publish_failed` — replyId, reviewId, propertyId, organizationId, authorId, occurredAt — to the Events produced section.

### [D12] MAJOR CONTEXT.md reply events missing `authorId` and `source` fields

File: src/contexts/review/CONTEXT.md:40-43
Quote:

```
- review.reply.published — replyId, reviewId, propertyId, organizationId, userId?, source, occurredAt.
- review.reply.submitted — replyId, reviewId, propertyId, organizationId, userId, occurredAt.
- review.reply.approved — replyId, reviewId, propertyId, organizationId, userId, occurredAt.
- review.reply.rejected — replyId, reviewId, propertyId, organizationId, userId, reason, occurredAt.
```

Rule: D12 — CONTEXT.md claims must match actual code. The actual event types have additional fields not documented:

- `ReviewReplyPublished` has `authorId` (not documented)
- `ReviewReplySubmitted` has `source` (not documented)
- `ReviewReplyApproved` has `authorId` and `source` (neither documented)
- `ReviewReplyRejected` has `authorId` and `source` (neither documented)
  Fix: Add the missing fields to each event's documentation in CONTEXT.md.

### [D12] MAJOR CONTEXT.md Public API section missing `ReviewReplyPublishFailed` type and `reviewReplyPublishFailed` constructor

File: src/contexts/review/CONTEXT.md:86-87
Quote:

```
- Event types: ReviewCreated, ReviewUpdated, ReviewReplyPublished, ReviewReplySubmitted, ReviewReplyApproved, ReviewReplyRejected, ReviewExpired, ReviewEvent
- Event constructors: reviewCreated, reviewUpdated, reviewReplyPublished, reviewReplySubmitted, reviewReplyApproved, reviewReplyRejected, reviewExpired
```

Rule: D12 — CONTEXT.md claims must match actual code. public-api.ts exports both `ReviewReplyPublishFailed` type and `reviewReplyPublishFailed` constructor. Neither is listed.
Fix: Add `ReviewReplyPublishFailed` to the Event types list and `reviewReplyPublishFailed` to the Event constructors list.

### [D3] MAJOR Use cases throw tagged errors instead of returning Result

File: src/contexts/review/application/use-cases/reply-operations.ts:26,61-62,79-80,136,188,247,306-307,344-345,391-392,448-449
Quote:

```ts
throw reviewError('unauthorized', 'Only managers and admins can manage replies')
```

Rule: D3 — Use cases return domain types, typed errors. Per `shared/domain/errors.ts` conventions: "No throw in domain; return Result instead. Throw tagged errors at the application boundary." The reply use cases consistently `throw` instead of returning `Result<T, ReviewError>`. While the shared error doc says "application boundary" may throw, D3 standard says use cases should return typed errors. Only `syncReviews` correctly returns `Result<SyncReviewsResult, ReviewError>`. The inconsistency means server functions must try/catch reply operations but check Result for sync.
Fix: Return `Result<Reply, ReviewError>` from reply use cases, matching the syncReviews pattern. Alternatively, document this as an accepted convention if throw-at-application-layer is the project norm.

### [D15] MAJOR Swallowed error in `markReplyPublishFailed`

File: src/contexts/review/application/use-cases/reply-operations.ts:422-424
Quote:

```ts
} catch {
  // Swallow — status update succeeded; event emission failure is non-critical
}
```

Rule: D15 — No bare catch, no swallowed errors, consistent error envelope. The bare `catch` block with no error binding silently discards event emission failures. At minimum, the error should be logged. Event emission failure after a state transition means downstream consumers won't process the failure, which is a data integrity concern.
Fix: Bind the error (`catch (err)`) and log it via `deps.logger.warn(...)`. The deps object doesn't currently include a logger — add one, or restructure to avoid the bare catch.

### [D2] MINOR Event constructors use `crypto.randomUUID()` directly instead of IdGenerator port

File: src/contexts/review/domain/events.ts:33,59,79,107,135,166,196,222
Quote:

```ts
eventId: crypto.randomUUID(),
```

Rule: D11 — Domain purity: Time via Clock port, UUID via IdGenerator. Events call `crypto.randomUUID()` directly for `eventId` generation rather than accepting it as a parameter or using an injected generator. This couples domain to Node.js `crypto` module.
Fix: Either accept `eventId` as a constructor parameter (like `_tag`), or document that `crypto.randomUUID()` is an acceptable runtime dependency for events (it's side-effect free and deterministic in behavior). The current approach is pragmatic but technically violates the IdGenerator port pattern.

### [D2] MINOR `ReviewReplyPublished` and `ReviewReplyApproved` events have `authorId` field not documented in CONTEXT.md glossary

File: src/contexts/review/domain/events.ts:93,152
Quote:

```ts
authorId: UserId
```

Rule: D2 — Envelope fields: eventId, occurredAt, correlationId. The `authorId` field appears on `ReviewReplyPublished`, `ReviewReplyApproved`, and `ReviewReplyRejected` events but is not an envelope field, not a CONTEXT.md glossary term, and not explained. It appears to be the ID of the person who originally wrote the reply (distinct from `userId` who performed the action), but this distinction is undocumented.
Fix: Document `authorId` in CONTEXT.md glossary or in each event's description, clarifying the distinction between `userId` (actor performing the action) and `authorId` (original reply author).

### [D11] MINOR Domain events import `node:assert/strict` — Node.js runtime dependency

File: src/contexts/review/domain/events.ts:4
Quote:

```ts
import assert from 'node:assert/strict'
```

Rule: D11 — Domain purity: No React, TanStack, better-auth, Drizzle, fetch, process.env, infrastructure/application/server/routes/components imports. While `node:assert/strict` is a lightweight stdlib import, it technically couples the domain layer to Node.js runtime. This is a minor concern since assert is side-effect free.
Fix: Acceptable for Node.js-only runtime. Could be replaced with manual `if (!condition) throw new Error(...)` if runtime independence is desired, but current usage is pragmatic.

### [D3] MINOR `draftReply` use case duplicates text validation already in `buildReply` constructor

File: src/contexts/review/application/use-cases/reply-operations.ts:60-68
Quote:

```ts
if (!input.text.trim()) {
  throw reviewError('invalid_reply', 'Reply text cannot be empty')
}
if (input.text.length > MAX_REPLY_LENGTH) {
  throw reviewError('invalid_reply', `Reply text exceeds ${MAX_REPLY_LENGTH} characters`)
}
```

Rule: D3 — Use case steps: Authorize → Load → Check rules → Build domain → Persist → Emit events → Return. The `draftReply` use case manually validates text (empty check, length check) instead of using `buildReply` constructor which already validates the same rules. Since CONTEXT.md notes syncReviews bypasses constructors for trusted data, but `draftReply` handles user input, it should route through the domain constructor to ensure single source of truth for validation.
Fix: Use `buildReply` (or `buildReply`'s validation) in `draftReply` instead of duplicating the validation logic. This ensures the constructor rules and use case rules can't drift apart.

### [D3] MINOR `draftReply` creates Reply objects directly without using `buildReply` constructor

File: src/contexts/review/application/use-cases/reply-operations.ts:84-114
Quote:

```ts
return deps.replyRepo.upsert(
  {
    id: deps.idGen(),
    reviewId: input.reviewId,
    ...
  },
  now,
)
```

Rule: D3 — Steps: Build domain → Persist. The `draftReply` use case constructs raw Reply objects via spread literals instead of calling `buildReply()`. This bypasses domain constructor validation and the domain layer's single source of truth for entity creation.
Fix: Call `buildReply(...)` and handle the Result. If `buildReply` returns `err`, throw the error. This is the "Build domain" step in the use case pattern.

### [D3] MINOR Use case return type aliases use `ReturnType<typeof fn>` instead of explicit type

File: src/contexts/review/application/use-cases/reply-operations.ts:39-45
Quote:

```ts
export type DraftReply = ReturnType<typeof draftReply>
export type SubmitReply = ReturnType<typeof submitReply>
```

Rule: D3 — Three exported types: {Name}Input, {Name}Deps, {Name}. The `ReplyDeps` type is exported, and input types are exported per convention. However, the use case function types (`DraftReply`, `SubmitReply`, etc.) use `ReturnType<typeof ...>` which is an implicit typing. If the function signature changes, the exported type silently changes too. This is not a D3 violation per se, but worth noting as it differs from a cleaner explicit type approach.
Fix: Acceptable as-is. The ReturnType pattern is common and type-safe.

### [D4] MINOR Build function exposes repository instances directly in API surface

File: src/contexts/review/build.ts:41-46
Quote:

```ts
repos: Readonly<{
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  queue: ReviewQueuePort
  replyQueue: ReplyQueuePort
}>
```

Rule: D4 — Build function returns the public API surface. The build function returns `repos` containing repository ports, which means any consumer of `ReviewContextApi` can bypass use cases and directly query repositories. This breaks the use-case-first architecture where application logic should flow through use cases.
Fix: Remove `repos` from the public API or restrict it to infrastructure consumers only. If repos are needed for cross-context infrastructure (e.g., jobs), document this as an intentional exception.

### [D4] MINOR Build function throws plain `Error` for missing jobQueue

File: src/contexts/reputation-key/src/contexts/review/build.ts:64
Quote:

```ts
if (!input.jobQueue) throw new Error('jobQueue required')
```

Rule: D15 — No plain Error objects. The build function throws a plain `Error` instead of a tagged error. While build-time errors are arguably infrastructure-level, the convention states "No plain Error objects. Ever."
Fix: Use a tagged error or at minimum an error with a `_tag` field. Since build is infrastructure-layer, this is low priority.

### [D15] NIT `reply-operations.ts` use case functions throw errors but return unwrapped domain types

File: src/contexts/review/application/use-cases/reply-operations.ts:57
Quote:

```ts
async (input: DraftReplyInput): Promise<Reply> => {
```

Rule: D15 — Consistent error envelope. All reply use cases return `Promise<Reply>` (or `Promise<void>`) while throwing `ReviewError` on failure. The return type doesn't communicate the possibility of failure to callers. `syncReviews` correctly returns `Result<SyncReviewsResult, ReviewError>`.
Fix: Align with `syncReviews` pattern by returning `Result<Reply, ReviewError>` for type-safe error handling at the application boundary.

### [D2] NIT CONTEXT.md `review.reply.published` event lists `userId?` (optional) but code type has `userId: UserId` (required)

File: src/contexts/review/CONTEXT.md:40
Quote:

```
review.reply.published — replyId, reviewId, propertyId, organizationId, userId?, source, occurredAt.
```

Rule: D12 — CONTEXT.md claims must match actual code. The documentation shows `userId?` as optional, but the actual `ReviewReplyPublished` type declares `userId: UserId` (required). This is inconsistent.
Fix: If userId is required in the type, document it without `?`. If it should be optional, change the type to `userId: UserId | null`.

### [D12] NIT CONTEXT.md Use cases section missing `markReplyPublished`, `markReplyPublishFailed`

File: src/contexts/review/CONTEXT.md:70-79
Quote:

```
## Use cases
- syncReviews
- draftReply
- submitReply
- approveReply
- rejectReply
- deleteReply
- getReply
- retryPublish
```

Rule: D12 — CONTEXT.md claims must match actual code. The `markReplyPublished` and `markReplyPublishFailed` use cases exist in `reply-operations.ts` and are exported, but are not listed in CONTEXT.md. They are infrastructure-facing (called by jobs) rather than server-function-facing, but should still be documented.
Fix: Add `markReplyPublished` and `markReplyPublishFailed` to the Use cases section with notes that they're infrastructure-facing (called by background jobs).
