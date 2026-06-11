# Phase 3: Domain Purity + Event Standards

**Findings covered:** #12-#20, #82-#89, #103-#107, #127-#130, #174-#185
**Estimated effort:** 4-5 developer-days
**Parallelism:** Stream A and B run in parallel. C depends on A.

---

## Stream A: Extract crypto.randomUUID() from Domain Events [L]

**Findings:** #12-#17, #82, #83, #174, #176, #180, #182, #184

**Pattern:** All domain event constructors call `crypto.randomUUID()` to generate `eventId`. This couples domain to Node.js crypto and makes events non-deterministic in tests.

**Fix:** Change all event constructors to accept `eventId` as a required parameter. Generate the ID at the call site (use-case or build.ts), where `idGen` is injected.

### A1. Update shared event constructor pattern [S]

Create a convention in `docs/standards.md` (if not already there):

- Event constructors take `{ eventId, occurredAt, correlationId, ...domainFields }`
- `eventId` is always provided by caller
- `occurredAt` is always provided by caller
- `correlationId` is optional

### A2. Fix each context's events.ts [M per context, ~L total]

For each of these 10 files, remove `import { randomUUID } from 'node:crypto'` and make `eventId` a required constructor parameter:

| File                                               | Finding        |
| -------------------------------------------------- | -------------- |
| `src/contexts/identity/domain/events.ts`           | #14, #15       |
| `src/contexts/staff/domain/events.ts`              | #13            |
| `src/contexts/team/domain/events.ts`               | #12            |
| `src/contexts/guest/domain/events.ts`              | #16, #17       |
| `src/contexts/portal/domain/events.ts`             | #20 (envelope) |
| `src/contexts/review/domain/events.ts`             | #18, #174      |
| `src/contexts/goal/domain/events.ts`               | #19 (envelope) |
| `src/contexts/metric/domain/events.ts`             | #180           |
| `src/contexts/notification/domain/constructors.ts` | #82, #176      |
| `src/contexts/inbox/domain/events.ts`              | #184, #185     |

For each constructor, change:

```typescript
// BEFORE
export const inboxItemCreated = (fields: { ... }): InboxItemCreated => ({
  _tag: 'inbox.item.created',
  eventId: crypto.randomUUID(),
  ...
})

// AFTER
export const inboxItemCreated = (fields: { eventId: string; ... }): InboxItemCreated => ({
  _tag: 'inbox.item.created',
  eventId: fields.eventId,
  ...
})
```

### A3. Update all call sites [M]

For each event constructor call (in use cases, build.ts, tests), pass `deps.idGen()` as `eventId`.

### A4. Remove `node:assert/strict` from domain events [S per context]

Replace `assert(condition)` with `if (!condition) throw new DomainError(...)` or simply validate and throw the context's domain error.

| File                                     | Finding |
| ---------------------------------------- | ------- |
| `src/contexts/identity/domain/events.ts` | #15     |
| `src/contexts/team/domain/events.ts`     | #12     |
| `src/contexts/guest/domain/events.ts`    | #17     |
| `src/contexts/review/domain/events.ts`   | #174    |

---

## Stream B: Event Envelope Fields [M]

**Findings:** #19, #20, #103, #130

### B1. Add eventId/correlationId to goal and portal events [S]

**Files:**

- `src/contexts/goal/domain/events.ts` — `GoalProgressUpdated` is missing `eventId` and `correlationId`
- `src/contexts/portal/domain/events.ts` — All 12 event types missing `eventId` and `correlationId`

**Fix:** Add `eventId: string` and `correlationId?: string` to every event type's shape. Update constructors to accept and pass these through.

### B2. Remove empty-string default for userId in review events [S]

**Finding:** #18

**File:** `src/contexts/review/domain/events.ts`

**Fix:** Make `userId` a required parameter (not `'' as UserId`). If `userId` is genuinely optional for some events (e.g., system-triggered), use `userId: UserId | null` with an explicit null.

### B3. Add constructor validation to portal/goal events [S]

**Finding:** #130

**File:** `src/contexts/portal/domain/events.ts`

**Fix:** Add runtime validation for required fields (non-empty strings, valid enums) in each event constructor. Fail early with descriptive domain error.

---

## Stream C: Use Case Domain Purity [M]

**Findings:** #84-#89, #83, #127, #175, #177-#179

### C1. Remove StoragePort import from identity use cases [S]

**Finding:** #86

**File:** `src/contexts/identity/application/use-cases/request-avatar-upload.ts`

**Fix:** Define a local `StoragePort` interface in `identity/application/ports/`. The portal implementation satisfies it — Duck typing via port interface avoids cross-context import.

### C2. Remove Headers from identity use case deps [M]

**Findings:** #87, #88

**Files:**

- `src/contexts/identity/application/use-cases/update-organization.ts`
- `src/contexts/identity/application/use-cases/register-user-and-org.ts`

**Fix:** Extract `headersFromRequest()` into the server layer. Pass only the resolved values (e.g., `origin: string`, `baseUrl: string`) as plain strings in the deps, not the raw `Headers` object.

### C3. Fix guest recordScan bypassing domain constructor [S]

**Finding:** #83

**File:** `src/contexts/guest/application/use-cases/record-scan.ts`

**Fix:** Call the domain `createScanEvent()` constructor instead of building the event object inline.

### C4. Fix metric recordMetric bypassing domain constructor [S]

**Finding:** #127

**File:** `src/contexts/metric/application/use-cases/record-metric.ts`

**Fix:** Call `createMetricReading()` constructor for validation before passing to repo.

### C5. Fix activity sentinel empty-string IDs [S]

**Findings:** #175, #176, #177

**Files:**

- `src/contexts/activity/domain/constructors.ts`
- `src/contexts/activity/application/use-cases/insert-activity-log.ts`

**Fix:** Make `id` a required parameter in constructors. Use `deps.idGen()` at call site. Remove `'' as unknown as ActivityLogId` pattern. Fix `'system' as unknown as UserId` — use a proper system user ID constant.

### C6. Remove neverthrow import from metric constructors [S]

**Finding:** #180

**File:** `src/contexts/metric/domain/constructors.ts`

**Fix:** Constructors should return domain types directly. Validation failures should throw domain errors. Remove `ok`/`err` imports.

### C7. Goal GoalConstructionError consolidation [S]

**Finding:** #179

**File:** `src/contexts/goal/domain/constructors.ts`

**Fix:** Merge `GoalConstructionError` into `GoalError` with an appropriate error code (e.g., `GOAL_CONSTRUCTION_FAILED`).

---

## Stream D: Fix event emission via raw object literals [S]

**Findings:** #107, #104, #105, #106

### D1. Goal event emission via constructors [S]

**Finding:** #107

**File:** `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts`

**Fix:** Replace raw object literals `{ _tag: 'goal.progressUpdated', ... }` with proper constructor calls `goalProgressUpdated({ ... })`.

### D2. Identity invitation events — emit or remove [S]

**Findings:** #104, #105

**Files:**

- `src/contexts/identity/domain/events.ts`
- `src/contexts/identity/application/public-api.ts`

**Decision needed:** Either:

- (a) Wire `identityInvitationAccepted`/`Rejected` into the appropriate server functions and re-export from public-api
- (b) Remove the constructors if invitations don't produce domain events

Recommend (a) — these events should exist for audit trail.

### D3. Goal event constructor validation [S]

**Finding:** #106

**File:** `src/contexts/goal/domain/events.ts`

**Fix:** Add runtime validation to each constructor for required fields (goalId non-empty, organizationId non-empty, etc.).

---

## Verification

After all changes:

```bash
# Type safety
pnpm typecheck

# Lint (boundary rules, restricted imports)
pnpm lint

# Domain purity: verify no crypto/assert in domain layers
grep -rn 'crypto.randomUUID\|node:assert' src/contexts/*/domain/

# Event envelope: verify all events have eventId
grep -rn 'eventId' src/contexts/*/domain/events.ts

# Tests
pnpm test
```
