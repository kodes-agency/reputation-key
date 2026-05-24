# Review #16 — Per-Context Deep Dive

**Date:** 2026-05-23
**Scope:** Review, Inbox, Integration, Goal contexts
**Reviewer:** AI Agent (GLM-5.1)
**Status:** Complete

---

## Review Context

### [BLOCKER] `progress-strategy.ts` in Goal uses `throw` in domain layer (cross-file, noted here for context overlap)

> _(Filed under Goal — see Goal section)_

### [MAJOR] `ReviewCreated` event carries undocumented `staffId` field

File: src/contexts/review/domain/events.ts:23
Quote:

```
staffId: StaffId | null
```

Rule: Domain types and events must be documented. CONTEXT.md glossary does not mention `staffId` on `ReviewCreated`.
Fix: Either document the purpose of `staffId` in the Review CONTEXT.md, or remove it. The sync use case always passes `null` (sync-reviews.ts:144), so the field appears unused.

### [MINOR] `buildReply` uses inline string union instead of `ReplySource` type alias

File: src/contexts/review/domain/constructors.ts:72
Quote:

```
source: 'google_sync' | 'internal'
```

Rule: DRY — use existing type aliases.
Fix: Replace with `source: ReplySource` (already imported via types).

### [NIT] Review public-api re-exports `GoogleReview` type but it's an internal transfer shape

File: src/contexts/review/application/public-api.ts:6
Quote:

```
export type { GoogleReview, StarRating } from '../domain/types'
```

Rule: Public API should expose only what external consumers need. `GoogleReview` is a raw Google API transfer type used only by the sync adapter.
Fix: Consider removing `GoogleReview` from public-api if no external consumer needs it.

---

## Inbox Context

### [MAJOR] Status transitions contradict ADR 0004 — `read` cannot transition to `archived`

File: src/contexts/inbox/domain/rules.ts:12-17
Quote:

```
const VALID_TRANSITIONS: Readonly<Record<InboxStatus, readonly InboxStatus[]>> = {
  new: ['read', 'archived', 'escalated'],
  read: ['addressed', 'escalated'],
  escalated: ['addressed', 'archived'],
  addressed: ['archived'],
  archived: [],
}
```

Rule: ADR 0004 Decision #2 states "Any state can escalate or archive."
Fix: Either add `'archived'` to the `read` transitions array, or update ADR 0004 to reflect the more restrictive graph. If `archived` is intentionally excluded from `read`, document the rationale.

### [MAJOR] `getUnreadCountFn` server function skips permission check

File: src/contexts/inbox/server/inbox.ts:224-244
Quote:

```
export const getUnreadCountFn = createServerFn({ method: 'GET' })
  .inputValidator(getUnreadCountDto)
  .handler(
    tracedHandler(
      async ({ data: _data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.getUnreadCount({
            organizationId: ctx.organizationId,
          })
```

Rule: Every authenticated server function must check permissions. All other inbox server functions check `can(ctx.role, 'inbox.read')` or `can(ctx.role, 'inbox.update')`.
Fix: Add `if (!can(ctx.role, 'inbox.read')) { throwContextError(...) }` after resolving tenant context.

### [MINOR] `on-reply-published` handler bypasses domain transition validation

File: src/contexts/inbox/infrastructure/event-handlers/on-reply-published.ts:31-37
Quote:

```
await deps.repo.updateStatus(
  inboxItem.id,
  inboxItem.organizationId,
  'addressed',
  { addressedAt: event.occurredAt },
  event.occurredAt,
)
```

Rule: Domain rule `validateTransition` should be used for all status changes. This handler writes `addressed` directly without calling `validateTransition`.
Fix: Call `validateTransition(inboxItem.status, 'addressed')` before `updateStatus`, or document that event-driven auto-transitions intentionally bypass validation (with rationale).

### [NIT] ADR 0004 mentions "Un-archive goes to `read`" but `archived: []` blocks all transitions

File: docs/adr/0004-inbox-bounded-context.md (Decision #2)
Quote:

```
"new → read → addressed → archived", with "escalated" sidetrack
```

Rule: ADR should match implementation. `archived: []` means no un-archive is possible.
Fix: Remove "Un-archive goes to read" from any documentation, or add the transition if needed.

---

## Integration Context

### [MAJOR] `IntegrationError` deviates from standard error shape — has extra `recoverable` field

File: src/contexts/integration/domain/errors.ts:19-25
Quote:

```
export type IntegrationError = Readonly<{
  _tag: 'IntegrationError'
  code: IntegrationErrorCode
  message: string
  recoverable: boolean
  context?: Readonly<Record<string, unknown>>
}>
```

Rule: Per `src/contexts/CONTEXT.md`, error shape is `{ _tag, code, message, context? }`. The `recoverable` field is non-standard and will break `ts-pattern .exhaustive()` matching at server boundaries if other error types don't have it.
Fix: Remove `recoverable` field. Encode recoverability in the error code itself (e.g., prefix recoverable codes or use a discriminated union), or move it to the `context` bag.

### [MAJOR] `integrationError` factory doesn't use shared `createErrorFactory`

File: src/contexts/integration/domain/errors.ts:27-38
Quote:

```
export const integrationError = (
  code: IntegrationErrorCode,
  message: string,
  recoverable = false,
  context?: Readonly<Record<string, unknown>>,
): IntegrationError => ({
  _tag: 'IntegrationError',
  code,
  message,
  recoverable,
  ...(context ? { context } : {}),
})
```

Rule: All other contexts (Review, Inbox, Goal, Staff) use `createErrorFactory` from `#/shared/domain/errors`. Integration hand-rolls its factory.
Fix: Use `createErrorFactory` and remove `recoverable` from the shape.

### [MINOR] `buildGoogleConnection` constructor doesn't validate non-empty encrypted tokens

File: src/contexts/integration/domain/constructors.ts:28-53
Quote:

```
export const buildGoogleConnection = (args: BuildConnectionArgs) => {
  if (!isValidEmail(args.googleEmail)) { ... }
  if (!isValidVisibility(args.visibility)) { ... }
  return ok<GoogleConnection>({ ... })
}
```

Rule: Constructors must validate all invariants. Empty `encryptedAccessToken` or `encryptedRefreshToken` would silently pass through.
Fix: Add validation: `if (!args.encryptedAccessToken) return err(integrationError('encryption_error', 'Access token must not be empty'))` (and same for refresh token).

### [MINOR] Pub/Sub subscribe/unsubscribe lifecycle not implemented as a first-class concern

File: docs/adr/0003-review-bounded-context.md (Decisions 3-4)
Quote:

```
Pub/Sub push + manual sync only. No periodic polling.
Derived subscription state — No tracking table. Query properties table.
```

Rule: ADR 0003 specifies Pub/Sub subscription management. The `build.ts` and use-case index show no dedicated subscribe/unsubscribe use cases.
Fix: This appears to be intentionally deferred (derived state from properties table). Add a comment in the integration CONTEXT.md or a tracking issue confirming this is by design and when explicit subscribe/unsubscribe will be built.

### [NIT] Integration build.ts directly imports Drizzle ORM operators (`eq`, `and`) for cross-context queries

File: src/contexts/integration/build.ts:37
Quote:

```
// eslint-disable-next-line no-restricted-imports -- wiring layer implements cross-context ports with shared schema
import { and, eq } from 'drizzle-orm'
```

Rule: The eslint disable comment acknowledges this breaks a rule. Acceptable in the wiring layer, but document the pattern.
Fix: Consider moving these cross-context port implementations to `src/composition.ts` alongside other cross-cutting wiring, keeping `build.ts` focused on same-context wiring.

---

## Goal Context (Newest)

### [BLOCKER] `progress-strategy.ts` uses `throw` in domain layer

File: src/contexts/goal/domain/progress-strategy.ts:70
Quote:

```
throw new Error('buildProgressQueryForInstance only applies to recurring goals')
```

And at line 115-118:

```
throw new Error(
  'Cannot build progress query for recurring template without instance period. ' +
    'Use buildProgressQueryForInstance() with explicit dates.',
)
```

Rule: Domain layer forbids `throw`, `async`, I/O, framework imports, mutation. Per `src/contexts/CONTEXT.md`: `domain/` forbidden list includes `throw`.
Fix: Return `Result<ProgressQuery, ProgressQueryError>` instead of throwing. The `ProgressQueryError` type is already defined but unused by `buildProgressQuery`.

### [BLOCKER] `create-goal.ts` imports directly from metric context's application layer, bypassing public-api

File: src/contexts/goal/application/use-cases/create-goal.ts:9
Quote:

```
import type {
  MetricReadingsQuery,
  MetricReadingsAggregate,
} from '../../../metric/application/ports/metric.repository'
```

Rule: "Cross-context: import from `application/public-api.ts` only. Never from `domain/`, `infrastructure/`, `server/`, or non-public-api `application/`."
Fix: Export `MetricReadingsQuery` and `MetricReadingsAggregate` from `metric/application/public-api.ts`, then import from there.

### [MAJOR] Missing CONTEXT.md — Goal is the only context without one

File: src/contexts/goal/ (no CONTEXT.md found)
Quote:

```
$ find src/contexts/goal -name "CONTEXT.md" → 0 results
```

Rule: All bounded contexts must have a CONTEXT.md per `src/contexts/CONTEXT.md` convention. Every other context (review, inbox, integration, etc.) has one.
Fix: Create `src/contexts/goal/CONTEXT.md` with glossary, relationships, invariants, and flagged ambiguities. This is critical for the newest context.

### [MAJOR] Non-standard `ui/` folder in context — outside the four-layer architecture

File: src/contexts/goal/ui/helpers.ts
Quote:

```
import type { Goal, GoalStatus } from '#/contexts/goal/domain/types'
```

Rule: Per `src/contexts/CONTEXT.md`, contexts have exactly four layers: `domain/`, `application/`, `infrastructure/`, `server/`. The `ui/` layer is non-standard.
Fix: Move `ui/helpers.ts` to `src/components/` or `src/shared/` (it's pure presentation logic, no domain rules). Alternatively, if keeping UI helpers in-context is a pattern, document it in the root CONTEXT.md.

### [MAJOR] `deriveEntityScope()` function lives in `types.ts` — types files should be data-only

File: src/contexts/goal/domain/types.ts:84-93
Quote:

```
export function deriveEntityScope(goal: {
  portalId: PortalId | null
  teamId: TeamId | null
  staffId: StaffId | null
}): EntityScope {
  if (goal.staffId) return 'staff'
  if (goal.teamId) return 'team'
  if (goal.portalId) return 'portal'
  return 'property'
}
```

Rule: Domain `types.ts` should contain type definitions only. Business logic belongs in `rules.ts` or `constructors.ts`.
Fix: Move `deriveEntityScope` to `rules.ts` and re-export from there.

### [MINOR] Goal repository port `insert` signature omits fields that constructor generates

File: src/contexts/goal/application/ports/goal.repository.ts:34
Quote:

```
insert(goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Goal>
```

Rule: The `buildGoal` constructor already produces a full `Goal` (with `id`, `createdAt`, `updatedAt`). The port says the repo will generate these. This creates semantic ambiguity about who owns identity generation.
Fix: Align the port signature with how it's actually called. Either: (a) change to `insert(goal: Goal): Promise<Goal>` since the constructor already generates all fields, or (b) remove `id`/`createdAt`/`updatedAt` from the constructor and let the repo handle them.

### [MINOR] `staff-goals.ts` is an incomplete stub with voided dependencies

File: src/contexts/goal/server/staff-goals.ts:24-29
Quote:

```
// Stub: resolve user's staff assignments, then query goals for each.
// For Phase 15C, return empty — will be wired when data flow is ready.
void ctx
void getContainer
return { goals: [] as GoalWithProgress[] }
```

Rule: Stubs should be clearly tracked. This returns hardcoded empty data in a production server function.
Fix: Add a tracking issue reference in the comment. Consider throwing a "not implemented" error instead of silently returning empty data, so the frontend can distinguish "no goals" from "feature not ready."

### [MINOR] `updateGoal` use case uses untyped `Record<string, unknown>` for updates

File: src/contexts/goal/application/use-cases/update-goal.ts:51-53
Quote:

```
const updates: Record<string, unknown> = {
  updatedAt: now,
}
```

Rule: Type safety — use typed update payloads, not `Record<string, unknown>`.
Fix: Define a `GoalUpdate` type for the update payload.

---

## Health Report

### Review Context — 🟢 Healthy

| Area                         | Status | Notes                                                                                        |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Domain entities + invariants | ✅     | Review and Reply separate; ReplySource distinguishes google_sync/internal; lifecycle correct |
| Use cases + ports + tests    | ✅     | Full reply lifecycle; sync with mirror; tests for domain rules                               |
| Server functions             | ✅     | Proper tracedHandler pattern; error mapping; DTO validation                                  |
| Cross-context interactions   | ✅     | Events emitted correctly; GoogleReviewApiPort facade                                         |
| ADR compliance               | ✅     | ADR 0003 decisions all implemented                                                           |
| **Risk**                     | Low    | `staffId` field on ReviewCreated is unused/unexplained                                       |

### Inbox Context — 🟡 Fair

| Area                         | Status | Notes                                                     |
| ---------------------------- | ------ | --------------------------------------------------------- |
| Domain entities + invariants | ⚠️     | Transitions slightly more restrictive than ADR 0004       |
| Use cases + ports + tests    | ✅     | 10 use cases, all with tests                              |
| Server functions             | ⚠️     | getUnreadCountFn missing permission check                 |
| Cross-context interactions   | ✅     | Event handlers for review/feedback/reply events           |
| ADR compliance               | ⚠️     | ADR 0004 "any state can archive" not fully honored        |
| **Risk**                     | Medium | Permission gap on unread count; transition graph mismatch |

### Integration Context — 🟡 Fair

| Area                         | Status     | Notes                                                               |
| ---------------------------- | ---------- | ------------------------------------------------------------------- |
| Domain entities + invariants | ✅         | GoogleConnection, GbpCacheEntry, GbpImportJob well-typed            |
| Use cases + ports + tests    | ✅         | 9 use cases, all with tests; token encryption correct               |
| Server functions             | ✅         | Proper OAuth flow; HMAC state signing                               |
| Cross-context interactions   | ✅         | GoogleReviewApiPort, PropertyEventPort                              |
| ADR compliance               | ✅         | Pub/Sub push verified; derived subscription state                   |
| **Risk**                     | Low-Medium | Error shape inconsistency; token constructor doesn't validate empty |

### Goal Context — 🔴 Needs Attention

| Area                         | Status | Notes                                                             |
| ---------------------------- | ------ | ----------------------------------------------------------------- |
| Domain entities + invariants | ⚠️     | `throw` in domain; logic in types.ts                              |
| Use cases + ports + tests    | ⚠️     | Cross-context import bypasses public-api; untyped update payload  |
| Server functions             | ✅     | Proper pattern; stub staff-goals returns empty                    |
| Cross-context interactions   | ⚠️     | Direct import from metric/ports; events emitted but no CONTEXT.md |
| ADR compliance               | N/A    | No ADR for Goal context yet                                       |
| **Risk**                     | High   | Newest context with most issues; missing documentation            |

---

## Top 3 Risks

1. **Goal domain purity violations (`throw` in domain, logic in types.ts)** — These break the architecture's most fundamental invariant. If not fixed, they set a precedent for other contexts to follow. The domain layer must remain pure for testability and reasoning.

2. **Inbox permission gap on `getUnreadCountFn`** — A Staff user can query the unread count without `inbox.read` permission. While this may seem harmless (it's a count, not item data), it leaks organizational information and breaks the consistent permission pattern.

3. **Goal cross-context import bypasses public-api** — `create-goal.ts` imports from `metric/application/ports/metric.repository` directly. This breaks the cross-context boundary rule and couples Goal to Metric's internal structure. If Metric refactors its ports, Goal breaks silently.
