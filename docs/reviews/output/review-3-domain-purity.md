# Review #3: Domain Layer Purity

**Date:** 2026-05-23
**Reviewer:** Automated code review (domain purity audit)
**Scope:** `src/contexts/*/domain/` across all 12 bounded contexts

---

## BLOCKER Findings

### [BLOCKER-1] `throw new Error()` in domain code — goal/progress-strategy.ts

```
[BLOCKER] Domain code throws raw Error instead of returning typed Result
  File: src/contexts/goal/domain/progress-strategy.ts:70
  Quote:
    throw new Error('buildProgressQueryForInstance only applies to recurring goals')
  File: src/contexts/goal/domain/progress-strategy.ts:115
  Quote:
    throw new Error(
      'Cannot build progress query for recurring template without instance period. ' +
        'Use buildProgressQueryForInstance() with explicit dates.',
    )
  Rule: Domain never throws — returns Result<T, E>. throw new Error("...") for business rules is forbidden.
  Fix: Return `err(goalConstructionError({ tag: '...' }))` with a typed error variant for both cases. Add a `ProgressQueryError` discriminated union (already declared but unused here).
```

### [BLOCKER-2] Node.js `crypto` import in domain layer — staff/referral-code.ts

```
[BLOCKER] Direct import from Node.js crypto module in domain layer
  File: src/contexts/staff/domain/referral-code.ts:1
  Quote:
    import { randomBytes } from 'crypto'
    ...
    export const generateReferralCode = (
      fullName: string,
      randomBytesFn: RandomBytesFn = randomBytes,
    ): string => {
  Rule: Random/UUID generated inline. Must come through an injected IdGenerator. No infrastructure imports in domain.
  Fix: Remove the default parameter value (`= randomBytes`). The function signature already accepts `randomBytesFn` as a parameter — require callers to always pass the dependency explicitly. The import should move to the application or infrastructure layer.
```

### [BLOCKER-3] No create/rehydrate distinction for any entity

```
[BLOCKER] All entity constructors (buildReview, buildProperty, buildPortal, etc.) serve as both
  creation and rehydration paths with no distinction.
  File: src/contexts/*/domain/constructors.ts (all contexts)
  Quote: (pattern repeated in all constructors)
    export const buildReview = (args: BuildReviewArgs) => { ... }  // no rehydrate equivalent
  Rule: "Entities constructed with new SomeEntity({...}) from outside the domain. Must have a named
        factory / create / rehydrate distinction."
  Fix: Add a `rehydrate<Entity>(...): <Entity>` function per entity type that bypasses validation
       (for reconstructing from DB rows). Rename `build*` to `create*` where appropriate. The
       rehydrate function should accept the full type shape directly.
```

---

## MAJOR Findings

### [MAJOR-1] Anemic StaffAssignment — constructor enforces no invariants

```
[MAJOR] buildStaffAssignment applies zero validation — every invariant lives in the use case
  File: src/contexts/staff/domain/constructors.ts:29-44
  Quote:
    export const buildStaffAssignment = (
      input: BuildStaffAssignmentInput,
    ): Result<StaffAssignment, StaffError> => {
      return ok({
        ... // directly wraps input with no checks
      })
    }
  Rule: Anemic entities — data bags with no behavior, where invariants live in services or use cases instead.
  Fix: The self-assignment guard (`validateNotSelfAssignment` in rules.ts) and any other invariants
       should be called inside `buildStaffAssignment`. The constructor is the enforcement point.
```

### [MAJOR-2] Anemic MetricReading — no constructor at all

```
[MAJOR] MetricReading is a bare type with no constructor, no validation, no invariants
  File: src/contexts/metric/domain/types.ts:18-27
  Quote:
    export type MetricReading = Readonly<{
      id: MetricReadingId
      organizationId: OrganizationId
      ...
      value: number
      recordedAt: Date
    }>
  Rule: Anemic entities — data bags with no behavior.
  Fix: Add a `createMetricReading` constructor in a constructors.ts file that at minimum validates
       `value >= 0` and that required IDs are present. MetricRecording is a write-once entity but
       still needs construction-time invariant enforcement.
```

### [MAJOR-3] Anemic GbpCacheEntry — no constructor

```
[MAJOR] GbpCacheEntry is a bare type with no constructor
  File: src/contexts/integration/domain/types.ts:36-47
  Quote:
    export type GbpCacheEntry = Readonly<{
      id: GbpCacheEntryId
      ...
      expiresAt: Date
    }>
  Rule: Anemic entities — data bags with no behavior.
  Fix: Add a constructor that validates `expiresAt > fetchedAt` and required fields.
       Alternatively, if GbpCacheEntry is purely infrastructure-internal, consider moving the
       type to the application/ports layer.
```

### [MAJOR-4] No entity equality implementation

```
[MAJOR] No context defines equality semantics for its entities
  File: src/contexts/*/domain/types.ts (all contexts)
  Rule: "Inconsistent equality: two entity instances representing the same identity must compare equal."
  Fix: Add a `sameIdentityAs(a, b)` function or an `equals` function per entity type in each
       context's domain/rules.ts or types.ts. For functional style: `export const sameReviewIdentity
       = (a: Review, b: Review) => a.id === b.id`.
```

### [MAJOR-5] StaffAssignment constructor returns Result but never fails

```
[MAJOR] buildStaffAssignment returns Result<StaffAssignment, StaffError> but always succeeds,
  making the Result wrapper misleading
  File: src/contexts/staff/domain/constructors.ts:31
  Quote:
    ): Result<StaffAssignment, StaffError> => {
      return ok({
  Rule: Anemic entities / misleading API contract.
  Fix: Either add validation that can actually fail (see MAJOR-1) or simplify the return type
       to `StaffAssignment` if no validation is needed.
```

### [MAJOR-6] Portal constructor takes raw `string` for entityId, brands internally

```
[MAJOR] buildPortal accepts raw `entityId?: string` and brand-casts it internally
  File: src/contexts/portal/domain/constructors.ts:62-68
  Quote:
    entityId: input.entityId
      ? (input.entityType === 'team'
          ? teamId(input.entityId)
          : input.entityType === 'staff'
            ? userId(input.entityId)
            : propertyId(input.entityId))
      : input.propertyId,
  Rule: Primitive obsession on identity — IDs passed as raw string instead of branded types.
  Fix: Change `BuildPortalInput.entityId` to `PropertyId | TeamId | UserId` (union of branded
       types). Let the application layer do the brand casting before calling the constructor.
```

---

## MINOR Findings

### [MINOR-1] Domain types re-exported from types.ts instead of index.ts

```
[MINOR] Branded ID types re-exported from domain/types.ts in 5 contexts
  File: src/contexts/staff/domain/types.ts:29   — export type { StaffAssignmentId }
  File: src/contexts/team/domain/types.ts:22    — export type { TeamId }
  File: src/contexts/integration/domain/types.ts:81 — export type { PropertyId }, { GoogleConnectionId }
  File: src/contexts/property/domain/types.ts:23 — export type { PropertyId }
  File: src/contexts/portal/domain/types.ts:69 — export type { PortalId }
  Rule: "Domain types re-exported from outside domain/index.ts."
  Fix: Create a domain/index.ts barrel file that re-exports all public domain types, and remove
       re-exports from types.ts. No domain/index.ts currently exists for any context.
```

### [MINOR-2] Review constructors missing Readonly<> on input types

```
[MINOR] BuildReviewArgs and BuildReplyArgs use bare `{...}` instead of `Readonly<{...}>`
  File: src/contexts/review/domain/constructors.ts:20
  Quote: type BuildReviewArgs = {
  File: src/contexts/review/domain/constructors.ts:67
  Quote: type BuildReplyArgs = {
  Rule: "readonly on all domain fields." — per CONTEXT.md functional style guide.
  Fix: Wrap with `Readonly<{...}>` to match all other contexts' constructor input types.
```

### [MINOR-3] External IDs stored as raw strings (guest context)

```
[MINOR] sessionId and ipHash are raw strings in guest domain types
  File: src/contexts/guest/domain/types.ts:19-20
  Quote:
    sessionId: string
    ipHash: string
  Rule: Mild primitive obsession — these are not domain identity IDs but opaque external identifiers.
  Fix: Consider branding as `SessionId` and `IpHash` for type safety, or document that raw strings
       are intentional for external opaque identifiers.
```

### [MINOR-4] External IDs stored as raw strings (integration context)

```
[MINOR] googleAccountId and googleEmail are raw strings in integration domain types
  File: src/contexts/integration/domain/types.ts:21-22
  Quote:
    googleAccountId: string
    googleEmail: string
  Rule: Mild primitive obsession — external Google identifiers not branded.
  Fix: Consider branding as `GoogleAccountId` for compile-time safety against accidental swaps.
```

### [MINOR-5] Potential validation duplication — portal/rules.ts vs shared/domain/slug.ts

```
[MINOR] Portal, Property, and Identity contexts each wrap sharedValidateSlug with their own
  error factory, creating a thin wrapper layer
  File: src/contexts/portal/domain/rules.ts:19-20
  File: src/contexts/property/domain/rules.ts:22-23
  File: src/contexts/identity/domain/rules.ts:13-34 (has its own full implementation)
  Quote:
    export const validateSlug = (slug: string): Result<string, PortalError> =>
      sharedValidateSlug(slug, (msg) => portalError('invalid_slug', msg))
  Rule: "Validation duplicated between a value object's constructor and a use case."
  Fix: Acceptable pattern — each context maps the shared validation to its own error type.
       Identity context has its own full slug validation (lines 13-34) that duplicates
       shared/domain/slug.ts logic. Consider delegating to shared.
```

---

## NIT (Style preferences)

### [NIT-1] Integration error type has extra `recoverable` field not in other contexts

```
[NIT] IntegrationError includes `recoverable: boolean` field — no other context error type has this
  File: src/contexts/integration/domain/errors.ts:23
  Quote:
    recoverable: boolean
  Fix: Minor inconsistency. If recoverable is needed, consider adding it to a shared error base type.
```

### [NIT-2] GbpLocation is a value object with no validation or constructor

```
[NIT] GbpLocation type exists in domain/types.ts but is a pure data shape from external API
  File: src/contexts/integration/domain/types.ts:70-78
  Quote:
    export type GbpLocation = Readonly<{ ... }>
  Fix: If this is an API response shape, consider moving it to application/ports or
       infrastructure/adapters instead of domain.
```

### [NIT-3] SentimentLabel typed as `string | null` instead of closed union

```
[NIT] SentimentLabel left open as `string | null` with TODO comment
  File: src/contexts/review/domain/types.ts:23
  Quote:
    export type SentimentLabel = string | null
  Fix: Already documented with rationale. Track as tech debt for when NLP provider stabilizes.
```

---

## Entity Inventory per Context

### Dashboard

| Entity                                                                                                                             | Invariants Enforced                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| DashboardData, KPIs, KPIValue, RatingBucket, RatingTrendPoint, ReviewVolumePoint, ReplyPerformance, EngagementFunnel, RecentReview | **None** — read-only aggregation types, no domain rules (by design) |
| DashboardReplyStatus                                                                                                               | `toDashboardReplyStatus` validates against known values             |

### Goal

| Entity        | Invariants Enforced                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal          | ✅ Name non-empty, targetValue > 0, metricKey valid for scope, aggregation valid for metric, goal-type-specific period/window/recurrence constraints |
| GoalProgress  | No constructor — bare type                                                                                                                           |
| ProgressQuery | Built via `buildProgressQuery` / `buildProgressQueryForInstance` — time filter derived from goal type                                                |

### Guest

| Entity    | Invariants Enforced                                 |
| --------- | --------------------------------------------------- |
| ScanEvent | No constructor — bare type                          |
| Rating    | ✅ value 1-5 integer, source in {qr, nfc, direct}   |
| Feedback  | ✅ comment non-empty, ≤1000 chars, source validated |

### Identity

| Entity                                                  | Invariants Enforced                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| _(no entity types — thin context wrapping better-auth)_ | N/A                                                              |
| Rules: validateSlug                                     | ✅ 2-63 chars, lowercase alphanumeric + hyphens                  |
| Rules: validateOrganizationName                         | ✅ 2-100 chars                                                   |
| Rules: canInviteWithRole                                | ✅ PM can only invite Staff; Admin can invite any                |
| Rules: canChangeRole                                    | ✅ Cannot change equal/higher role; cannot assign role above own |

### Inbox

| Entity           | Invariants Enforced                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| InboxItem        | Minimal — `createInboxItem` constructs with defaults but no field validation beyond clock                                                      |
| InboxNote        | ✅ text non-empty after trim                                                                                                                   |
| Transition rules | ✅ State machine: new→{read,archived,escalated}, read→{addressed,escalated}, escalated→{addressed,archived}, addressed→{archived}, archived→{} |
| Assignment rules | ✅ Only PM+ can assign                                                                                                                         |

### Integration

| Entity           | Invariants Enforced                                             |
| ---------------- | --------------------------------------------------------------- |
| GoogleConnection | ✅ Valid email format, valid visibility {private, organization} |
| GbpImportJob     | No validation — bare `ok()` wrapper                             |
| GbpCacheEntry    | No constructor — bare type                                      |
| GbpLocation      | No constructor — external value object                          |
| GbpApiError      | Tagged error with status code                                   |

### Metric

| Entity        | Invariants Enforced                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| MetricReading | No constructor — bare type                                                                           |
| MetricKey     | Closed union: portal.scan, portal.rating, portal.feedback, portal.review_link_click, property.review |

### Portal

| Entity             | Invariants Enforced                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Portal             | ✅ Name 1-100 chars, slug format, description ≤500 chars, theme hex colors, threshold 1-4 |
| PortalLinkCategory | ✅ Title 1-100 chars                                                                      |
| PortalLink         | ✅ Label 1-100 chars, valid URL                                                           |

### Property

| Entity   | Invariants Enforced                                   |
| -------- | ----------------------------------------------------- |
| Property | ✅ Name 1-100 chars, slug format, valid IANA timezone |

### Review

| Entity            | Invariants Enforced                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Review            | ✅ Rating 1-5, expiresAt calculated from 30-day retention window                                                            |
| Reply             | ✅ Text non-empty, ≤4096 chars                                                                                              |
| Reply transitions | ✅ draft→pending_approval→{approved,rejected}, approved→{published,publish_failed}, rejected→draft, publish_failed→approved |

### Staff

| Entity                   | Invariants Enforced                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| StaffAssignment          | **No validation in constructor** — self-assignment guard exists in rules.ts but not called |
| Referral code generation | Injected random bytes, slug derivation from name                                           |

### Team

| Entity | Invariants Enforced |
| ------ | ------------------- |
| Team   | ✅ Name 1-100 chars |

---

## Glossary Invariants NOT Enforced in Code

From CONTEXT.md glossary:

| Glossary Concept                                                                                  | Enforced?        | Notes                                                                                    |
| ------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| **AccountAdmin** created when org is created                                                      | ❌ Not in domain | Identity is a thin context wrapping better-auth; org creation logic lives in application |
| **PropertyManager** cannot delete resources                                                       | ❌ Not in domain | Deletion authorization in shared/domain/permissions.ts, not in entity invariant          |
| **Staff** read-only access, cannot view/manage replies                                            | ❌ Not in domain | Permission rules in `can()` — not an entity invariant                                    |
| **Reply lifecycle** draft→pending_approval→approved→published (or publish_failed)                 | ✅ Enforced      | review/domain/rules.ts transition map                                                    |
| **Inbox status transitions** per ADR 0004                                                         | ✅ Enforced      | inbox/domain/rules.ts transition map                                                     |
| **Staff Assignment** links member to specific property                                            | ✅ Structurally  | StaffAssignment type enforces the link, but no invariant prevents invalid assignments    |
| **Only PM+ can manage replies; Staff cannot view or manage**                                      | ❌ Not in domain | Authorization check in shared/domain/permissions.ts                                      |
| **30-day review retention window**                                                                | ✅ Enforced      | review/domain/rules.ts calculateExpiresAt                                                |
| **Rating is 1-5 stars**                                                                           | ✅ Enforced      | guest/domain/rules.ts validateRating                                                     |
| **Feedback max 1000 chars**                                                                       | ✅ Enforced      | guest/domain/rules.ts validateFeedback                                                   |
| **Portal smart routing threshold 1-4**                                                            | ✅ Enforced      | portal/domain/rules.ts validateSmartRoutingThreshold                                     |
| **Organization slug** 2-63 chars, alphanumeric+hyphens                                            | ✅ Enforced      | identity/domain/rules.ts validateSlug                                                    |
| **GBP Notification** subscribed per account on first import, unsubscribed on last removal         | ❌ Not in domain | Infrastructure/event handler concern                                                     |
| **Inbox Addressed** = reply published or manually marked (review) / internally handled (feedback) | ⚠️ Partially     | Transition exists but no distinction between review-addressed vs feedback-addressed      |

---

## Summary Statistics

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 3      |
| MAJOR     | 6      |
| MINOR     | 5      |
| NIT       | 3      |
| **Total** | **17** |

### Overall Assessment

The domain layer is well-structured with consistent patterns: functional style, `Readonly<>` types, branded IDs from shared/domain/ids, tagged error unions, Result-based error handling, and proper separation of types/errors/rules/constructors/events per context.

**Key strengths:**

- Zero framework imports in domain (no React, TanStack, Drizzle, etc.)
- No `async` in domain code
- No `new Date()` or `Date.now()` for current time — time arrives as parameters
- Consistent tagged error pattern across all contexts
- Good state machine enforcement in inbox and review contexts
- Clock injection in inbox constructors via `clock: () => Date`

**Key concerns:**

- The `throw new Error()` calls in goal/domain/progress-strategy.ts (BLOCKER-1) violate the core "domain never throws" rule
- The `crypto` import in staff/domain/referral-code.ts (BLOCKER-2) creates a hard Node.js dependency
- No create/rehydrate distinction anywhere (BLOCKER-3) — all entity construction is creation-only
- StaffAssignment and MetricReading are anemic — no construction-time invariant enforcement
- No entity equality semantics defined in any context
