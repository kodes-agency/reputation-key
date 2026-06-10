# Activity Context — Domain & Application Layer Review

**Reviewer:** automated deep review
**Date:** 2026-06-10
**Scope:** `src/contexts/activity/domain/`, `src/contexts/activity/application/`, `src/contexts/activity/build.ts`
**Dimensions:** D2, D3, D4, D11, D12, D15

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 4     |
| MINOR    | 5     |
| NIT      | 3     |

---

## Findings

### [D3] MAJOR Silent swallow of domain construction errors in use case

File: src/contexts/activity/application/use-cases/insert-activity-log.ts:85-91
Quote: ```ts
if (result.isErr()) {
deps.logger.warn(
{ error: result.error, input },
'Failed to construct activity log entry',
)
return
}

````
  Rule:  D3 — use cases should surface domain errors, not silently swallow them; D15 — no silent failure paths
  Fix:   Either throw a typed error so the BullMQ worker can retry/dead-letter, or return a `Result<void, ActivityError>` to the caller. Silently returning `void` on a domain validation failure means invalid input is silently dropped with no retry path and no operational visibility beyond a warn log.

### [D15] MAJOR Bare `catch` with silent discard of user lookup errors
  File: src/contexts/activity/application/use-cases/insert-activity-log.ts:67-69
  Quote: ```ts
      } catch {
        // Use system defaults
      }
````

Rule: D15 — no bare catch, no swallowed errors
Fix: Log the lookup failure at minimum: `catch (error) { deps.logger.warn({ error, userId }, 'User lookup failed, falling back to system defaults') }`. If user resolution is critical for audit integrity, consider making this a retryable error instead.

### [D11] MINOR Unsafe cast of `'system'` string to `UserId` branded type

File: src/contexts/activity/application/use-cases/insert-activity-log.ts:75
Quote: ```ts
actorId: userId || ('system' as unknown as UserId),

````
  Rule:  D11 — domain entities use branded IDs; use-case layer should not bypass branding with `as unknown as`
  Fix:   Either create a proper `systemUserId()` constant in `shared/domain/ids` that produces a valid branded `UserId`, or change `ActivityLog.actorId` to `UserId | 'system'` in the domain type. The current `as unknown as` breaks the branded-ID guarantee.

### [D3] MINOR Use case does not return domain types — returns `Promise<void>`
  File: src/contexts/activity/application/use-cases/insert-activity-log.ts:39
  Quote: ```ts
  async (input: InsertActivityLogInput): Promise<void> => {
````

Rule: D3 — use cases return domain types or typed errors
Fix: Return `Promise<Result<ActivityLogId, ActivityError>>` (or at minimum `Promise<void | ActivityError>`). For a subscriber use case, returning the persisted ID or a typed error is more useful than void. This is a lower priority since CONTEXT.md documents it as returning void.

### [D3] MINOR Use case missing `source` field from `activityFields` destructuring

File: src/contexts/activity/application/use-cases/insert-activity-log.ts:40-41
Quote: ```ts
const { userId, propertyId, ...activityFields } = input
const { action, resourceType, resourceId, organizationId, payload } = activityFields

````
  Rule:  D3 — correctness of field passing
  Fix:   `source` is included in `activityFields` via the rest spread and correctly passed to `createActivityLog` via `...activityFields` on line 80. However, the explicit destructuring on line 41 creates a misleading impression that `source` is not extracted. The second destructuring is unused — `activityFields` is only spread into the constructor. Consider removing line 41 and using `activityFields` directly, or destructuring only the fields needed for `findDuplicate` (action, resourceType, resourceId, organizationId, payload) without the extra `activityFields` variable.

### [D11] MINOR Sentinel empty string ID bypasses domain invariant
  File: src/contexts/activity/domain/constructors.ts:92
  Quote: ```ts
    id: '' as unknown as ActivityLogId,
````

Rule: D11 — domain entities should have branded IDs; no `as unknown as` casts
Fix: The comment explains the pattern is shared across the codebase. If this is an accepted convention, it should be documented in the architecture guide. Ideally, the constructor should accept the ID as a parameter (or the ID should be optional in the domain type) so the use case provides it at construction time rather than mutating after construction on line 94 of the use case.

### [D4] MAJOR Build function imports `activityLogId` from shared but use-case caller passes raw `crypto.randomUUID()`

File: src/contexts/activity/build.ts:54
Quote: ```ts
idGen: () => activityLogId(crypto.randomUUID()),

````
  Rule:  D4 — build function assembles the dependency graph correctly
  Fix:   This is acceptable — `activityLogId` wraps the raw UUID into the branded type. However, `crypto.randomUUID()` is called directly here rather than using a shared `idGenerator` port. This means the build function has an implicit dependency on the `crypto` global. Consider extracting to a shared `idGen` utility that can be injected for testability, consistent with the `clock` port pattern already used.

### [D12] MAJOR CONTEXT.md claims `ActivityLog` has no update operations but domain type includes mutable `id` overwrite pattern
  File: src/contexts/activity/CONTEXT.md:31
  Quote: ```Activity records are **immutable** — no `updated_at` column, no update operations.```
  Rule:  D12 — CONTEXT.md claims must match code
  Fix:   The immutability claim is about DB operations (no UPDATE), which is correct — the repository has no update method. However, the domain constructor creates a sentinel ID that is then mutated (`entryWithId = { ...result.value, id: deps.idGen() }`) in the use case. While this is a spread (not in-place mutation), it contradicts the spirit of immutability documented. The CONTEXT.md should note this pattern or the constructor should accept the ID upfront.

### [D12] MINOR CONTEXT.md lists `member` as ResourceType but no event handlers consume member events
  File: src/contexts/activity/CONTEXT.md:31 (Glossary — ResourceType)
  Quote: ```| **ResourceType** | The kind of entity an action affects: `inbox_item`, `review`, `reply`, `note`, `property`, `member`. |```
  Rule:  D12 — CONTEXT.md accuracy
  Fix:   `member` is listed as a ResourceType in both the glossary and the `types.ts` union, but no event handlers or consumed events produce activity logs with `resourceType: 'member'`. If this is reserved for future use, note it. If not, consider whether it should be in the type union.

### [D2] NIT No events dimension applicable — context is correctly documented as non-emitting
  File: src/contexts/activity/CONTEXT.md:39
  Quote: ```None. Activity is a pure subscriber context — it only consumes events, never emits them.```
  Rule:  D2 — event standards
  Fix:   No issue. This is correctly implemented — no event definitions, constructors, or unions exist in the domain layer. D2 is not applicable for this context.

### [D15] NIT `activityError` factory allows unstructured `code` strings
  File: src/contexts/activity/domain/errors.ts:10-14
  Quote: ```ts
  export const activityError = (
    code: string,
    message: string,
````

Rule: D15 — consistent error envelope; domain errors should use discriminated union codes
Fix: Consider making `code` a union type literal (`'invalid_action' | 'invalid_resource_type' | 'invalid_source'`) to prevent ad-hoc string codes. The constructor already uses specific string literals, but the type allows any string.

### [D4] NIT Build function has `queue` as optional (`Queue | undefined`) with guard clause

File: src/contexts/activity/build.ts:20
Quote: ```ts
queue: Queue | undefined

````
  Rule:  D4 — build function should document why queue is optional
  Fix:   The guard on line 40 (`if (input.queue)`) is fine for test scenarios, but the type should ideally use a discriminated union or the reason for optionality should be documented in a comment. Currently it's unclear when queue would be undefined — presumably for test/seed scenarios.

### [D12] NIT CONTEXT.md claims ports directory exists with `activity-repository.port.ts` and `user-lookup.port.ts`
  File: src/contexts/activity/CONTEXT.md:93
  Quote: ```ports/           → activity-repository.port.ts, user-lookup.port.ts```
  Rule:  D12 — CONTEXT.md accuracy
  Fix:   The actual ports directory also contains `inbox-item-lookup.port.ts`, which is not listed in CONTEXT.md. Update the architecture layers section to include this file.

### [D11] MINOR Domain constructor validates action/resourceType/source but not required string fields
  File: src/contexts/activity/domain/constructors.ts:56-106
  Quote: ```ts
  export const createActivityLog = (
    input: CreateActivityLogInput,
    clock: () => Date,
  ): Result<ActivityLog, ActivityError> => {
    if (!ALLOWED_ACTIONS.has(input.action)) { ... }
    if (!ALLOWED_RESOURCE_TYPES.has(input.resourceType)) { ... }
    if (!ALLOWED_SOURCES.has(input.source)) { ... }
    return ok({ ... })
  }
````

Rule: D2/D11 — constructor validation should assert impossible states; `resourceId` and `actorName` could be empty strings
Fix: Add validation for non-empty `resourceId` and `actorName` at minimum. An activity log with `resourceId: ''` or `actorName: ''` is an impossible state that should be caught at construction.

### [D3] MAJOR Use case spreads `activityFields` into constructor but also passes `propertyId` separately

File: src/contexts/activity/application/use-cases/insert-activity-log.ts:73-83
Quote: ```ts
const result = createActivityLog(
{
actorId: userId || ('system' as unknown as UserId),
actorName,
actorAvatarUrl,
actorRole,
propertyId,
...activityFields,
},
deps.clock,
)

```
  Rule:  D3 — use case correctness
  Fix:   `activityFields` already contains `propertyId` (from the rest spread on line 40: `const { userId, propertyId, ...activityFields } = input` — wait, `propertyId` is destructured out, so `activityFields` does NOT contain it). Then `propertyId` is passed explicitly. But `userId` is also destructured out and NOT in `activityFields`. This is correct — but fragile. The spread `...activityFields` contains `action, resourceType, resourceId, organizationId, payload, source` and the explicit fields cover `actorId, actorName, actorAvatarUrl, actorRole, propertyId`. This is technically correct but relies on the reader understanding the rest-spread exclusion. A comment or explicit field assembly would improve clarity.
```
