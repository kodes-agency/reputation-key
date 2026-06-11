# Type Safety Sweep

**Date:** 2026-06-10
**Scope:** `src/` (excluding `node_modules`, `.test.` files, `routeTree.gen.ts`)
**Reviewer:** automated sweep

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 4      |
| MAJOR     | 14     |
| MINOR     | 10     |
| NIT       | 4      |
| **Total** | **32** |

---

## 1. `as unknown as` Casts

### TS-001 [BLOCKER] Sentinel `'' as unknown as NotificationId` in domain constructors

File: src/contexts/notification/domain/constructors.ts:83
Quote: `id: '' as unknown as NotificationId,`
Rule: brand.ts — "as casts except for branded ID parsing are forbidden"; standards.md §6 — domain layer forbids unsafe casts
Fix: Make `id` an `Omit` field in the constructor input and have the use-case layer supply `deps.idGen()` at construction time (same pattern used elsewhere). The sentinel-then-overwrite pattern defeats the purpose of branded types.

### TS-002 [BLOCKER] Sentinel `'' as unknown as NotificationEmailId` in domain constructor

File: src/contexts/notification/domain/constructors-email.ts:28
Quote: `id: '' as unknown as NotificationEmailId,`
Rule: Same as TS-001
Fix: Same as TS-001 — omit `id` from constructor input, supply from use case.

### TS-003 [BLOCKER] Sentinel `'' as unknown as NotificationPreferenceId` in domain constructor

File: src/contexts/notification/domain/constructors-preference.ts:37
Quote: `id: '' as unknown as NotificationPreferenceId,`
Rule: Same as TS-001
Fix: Same as TS-001

### TS-004 [BLOCKER] Sentinel `'' as unknown as ActivityLogId` in domain constructor

File: src/contexts/activity/domain/constructors.ts:92
Quote: `id: '' as unknown as ActivityLogId,`
Rule: Same as TS-001. Comment says "overwritten by use case layer" — this is the exact anti-pattern.
Fix: Same as TS-001 — omit `id`, supply from `deps.idGen()`.

### TS-005 [MAJOR] `'system' as unknown as UserId` — non-UserId branded as UserId

File: src/contexts/activity/application/use-cases/insert-activity-log.ts:75
Quote: `actorId: userId || ('system' as unknown as UserId),`
Rule: brand.ts — branded types exist to prevent accidental substitution; a literal string branded as UserId defeats the guarantee
Fix: Change `actorId` type to `UserId | null` and handle the `null` case (system actor) downstream. Do not brand a sentinel string.

### TS-006 [MAJOR] `deps.idGen() as unknown as GoalProgressId` — idGen should return branded type

File: src/contexts/goal/application/use-cases/create-goal.ts:137,210
Quote: `id: deps.idGen() as unknown as GoalProgressId,`
Rule: ids.ts defines branded constructors for this purpose; `idGen` should return `GoalProgressId` directly
Fix: Type the `idGen` dep as `() => GoalProgressId` so the cast is unnecessary.

### TS-007 [MINOR] `portalIds as unknown as string[]` — Drizzle inArray with branded array

File: src/contexts/dashboard/infrastructure/adapters/metric-stats.adapter.ts:97
Quote: `inArray(metricReadings.portalId, portalIds as unknown as string[]),`
Rule: ids.ts provides `unbrandAll()` for exactly this purpose
Fix: Replace with `inArray(metricReadings.portalId, unbrandAll(portalIds))`.

### TS-008 [MINOR] `result.rows as unknown as ReadonlyArray<{...}>` — raw SQL result shape

File: src/contexts/portal/infrastructure/repositories/portal.repository.ts:163
Quote: `const rows = result.rows as unknown as ReadonlyArray<{ portal_slug: string; property_slug: string }>`
Rule: standards.md §6 — infrastructure layer casts are tolerable when documented, but `as unknown as` is the nuclear option
Fix: Use a runtime validation function (zod schema or manual assertion) that returns a typed result. If keeping the cast, narrow to `as` (not `as unknown as`) by defining an intermediate type.

### TS-009 [MINOR] `connection as unknown as import('bullmq').ConnectionOptions` — Redis/BullMQ type mismatch

File: src/shared/jobs/worker.ts:37
Quote: `connection: connection as unknown as import('bullmq').ConnectionOptions,`
Rule: BullMQ and ioredis type incompatibility is a known ecosystem issue
Fix: Create a shared helper `asConnectionOptions(redis: Redis): ConnectionOptions` that encapsulates this single cast in one place.

### TS-010 [MINOR] Same BullMQ cast duplicated in queue.ts

File: src/shared/jobs/queue.ts:37
Quote: `connection: connection as unknown as import('bullmq').ConnectionOptions,`
Rule: Same as TS-009 — duplication means the workaround is not centralized
Fix: Extract shared helper (see TS-009).

---

## 2. Non-null Assertions (`!`) in Non-test Code

### TS-011 [MAJOR] `filters.propertyIds!.includes()` — non-null assertion on optional filter

File: src/shared/testing/in-memory-inbox-repo.ts:28
Quote: `filtered = filtered.filter((i) => filters.propertyIds!.includes(i.propertyId))`
Rule: Testing code is exempt from production rules, but this is in shared testing infrastructure. The `!` hides a potential null dereference.
Fix: Add an early return: `if (!filters.propertyIds) return filtered;` then filter without `!`.

---

## 3. Untyped / Bare `catch` Blocks

### TS-012 [MAJOR] 160+ `catch (e)` blocks with untyped error variable across all server functions

Files: src/contexts/_/server/_.ts (portal, inbox, identity, property, notification, activity, integration, dashboard, team, review, guest, staff, goal)
Rule: standards.md §6 — swallowed errors should at minimum be typed as `unknown` and narrowed
Fix: Use `catch (e: unknown)` everywhere. The codebase already uses this pattern in a few places (e.g., `catch (err)` in jobs). Standardize on `unknown`.

### TS-013 [MAJOR] 20+ bare `catch {}` blocks that silently swallow errors

Files: src/contexts/inbox/infrastructure/adapters/redis-new-counter.ts (6 occurrences), src/contexts/portal/domain/rules.ts (2), src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts (1), src/contexts/notification/infrastructure/jobs/digest-notification.job.ts (1), src/contexts/activity/application/use-cases/insert-activity-log.ts (1), src/contexts/activity/infrastructure/adapters/db-\*.adapter.ts (2), src/contexts/review/application/use-cases/reply-operations.ts (1)
Quote (representative):

```
} catch {
  // Non-critical
}
```

Rule: Even if the operation is non-critical, the catch should bind the error for logging: `catch (_e) { /* non-critical */ }`
Fix: At minimum, bind as `catch (_e)` so the intent is explicit. For infrastructure adapters (redis-new-counter), add logger.warn. For domain rules.ts catching URL parse, the pattern is acceptable but should bind the variable.

---

## 4. `string` Type Where Branded IDs Should Be Used

### TS-014 [MAJOR] Public API types use `string` for organizationId/propertyId

File: src/contexts/portal/application/public-api.ts:49,50
Quote:

```
organizationId: string
propertyId: string
```

Rule: ids.ts defines `OrganizationId` and `PropertyId` branded types; public-api.ts is the cross-context boundary and should enforce them
Fix: Use `OrganizationId` and `PropertyId` branded types. Callers unbrand at the infrastructure boundary.

### TS-015 [MAJOR] Use case inputs accept bare `string` for entity IDs

Files: src/contexts/portal/application/use-cases/\*.ts (12 occurrences of `portalId: string`, `propertyId: string`, etc.)
Quote (representative):

```
portalId: string
propertyId?: string
```

Rule: standards.md §2 — use case inputs should use domain types including branded IDs
Fix: Use the branded types from ids.ts (`PortalId`, `PropertyId`, etc.). Server functions that parse from HTTP params should use the id constructors (e.g., `portalId(param)`) before calling the use case.

### TS-016 [MAJOR] Repository port uses `string` for tenant IDs

File: src/contexts/portal/application/ports/portal.repository.ts:33,34,48,52
Quote:

```
organizationId: string
propertyId: string
```

Rule: Repository ports are part of the application layer and should use branded types
Fix: Use `OrganizationId` and `PropertyId`. Implementation already imports them.

### TS-017 [MAJOR] Identity build.ts and ports use bare `string` for userId/organizationId

Files: src/contexts/identity/build.ts:21,22,37; src/contexts/identity/application/ports/identity.port.ts:12,82
Quote:

```
userId: string
organizationId: string
```

Rule: Same as TS-014 — identity is the auth boundary, should type-narrow early
Fix: Use `UserId` and `OrganizationId`.

### TS-018 [MINOR] Job data payloads use bare `string` for IDs

Files: src/contexts/portal/infrastructure/jobs/process-image.job.ts:16,17; src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts:31,32
Quote:

```
portalId: string
organizationId: string
```

Rule: Job payloads are serialized so `string` is tolerable, but the shape should document that these will be branded on deserialization
Fix: Acceptable for BullMQ job data (JSON-serialized). Add a comment `// serialized — branded at consumer`. Alternatively, use a typed `JobData<T>` wrapper.

---

## 5. Switch Statements Without Exhaustive `never` Checks

### TS-019 [MAJOR] `toDomainRole` has no exhaustive `never` check

File: src/shared/domain/roles.ts:30-39
Quote:

```
switch (betterAuthRole) {
  case 'owner': ...
  case 'admin': ...
  case 'member': ...
  default:
    throw new Error(`Unknown better-auth role: ${betterAuthRole}`)
}
```

Rule: The param is `string`, not a union, so TS can't enforce exhaustiveness. But `toBetterAuthRole` (same file) correctly uses `const _exhaustive: never = role` pattern.
Fix: Widen the param to `BetterAuthRole | string` and add `const _exhaustive: never = betterAuthRole` in default, or at minimum type the param as `BetterAuthRole` for known callers.

### TS-020 [MAJOR] `statusBadgeVariant`, `statusLabel`, `scopeLabel`, `aggregationLabel` switches missing exhaustive default

File: src/contexts/goal/ui/helpers.ts:162-227
Quote:

```
switch (status) {
  case 'active': return 'default'
  case 'completed': return 'secondary'
  case 'cancelled': return 'destructive'
  case 'expired': return 'outline'
}
```

Rule: TS enforces return-type completeness here (all cases return), but adding a `default: { const _: never = status }` future-proofs against new enum values
Fix: Add `default: { const _exhaustive: never = status; throw new Error() }` to each switch, matching the pattern in `role-utils.ts`.

### TS-021 [MAJOR] `computeCalendarPeriod`, `computeNextPeriodStart`, `computePeriodEnd` switches missing exhaustive default

Files: src/contexts/goal/application/use-cases/create-goal.ts:234; src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts:180,198
Quote:

```
switch (frequency) {
  case 'weekly': ...
  case 'monthly': ...
  case 'quarterly': ...
}
```

Rule: The domain constructors (goal/domain/constructors.ts:160) correctly use `assertNever`. These runtime switches should follow suit.
Fix: Add `default: { assertNever('frequency', frequency) }` to each switch.

### TS-022 [MAJOR] `progressQueryToMetricReadingsQuery` and `computeValue` switches missing exhaustive default

Files: src/contexts/goal/application/use-cases/create-goal.ts:295,316; src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts:173,194
Quote:

```
switch (pq.timeFilter.tag) {
  case 'bounded': ...
  case 'sliding_window': ...
  case 'none': ...
}
```

Rule: Domain code (progress-strategy.ts:128,162) uses `assertNever`. The duplicate copies in jobs/use-cases don't.
Fix: Import and use `assertNever` in the default branch of each switch.

### TS-023 [MINOR] `getNotificationUrl` switch uses `default: return '#'` instead of exhaustive check

File: src/components/features/notification/notification-utils.ts:26-35
Quote:

```
switch (resourceType) {
  case 'inbox_item': ...
  case 'reply': ...
  case 'goal': ...
  default: return '#'
}
```

Rule: `NotificationResourceType` is a union; new values should cause compile errors
Fix: Replace default with exhaustive check: add all cases, then `default: { const _: never = resourceType; return '#' }`.

### TS-024 [MINOR] `folderToStatus` switch uses `default: return undefined` instead of exhaustive check

File: src/components/inbox/inbox-search-schema.ts:24-33
Quote:

```
switch (folder) {
  case 'escalated': return 'escalated'
  case 'addressed': return 'addressed'
  case 'archived': return 'archived'
  default: return undefined
}
```

Rule: The param is `string | undefined` so TS can't enforce exhaustiveness; but the valid set is known
Fix: Acceptable as-is since the input is unvalidated. Could tighten param type to union for compile-time safety.

### TS-025 [MINOR] `formatProgressLabel` switch has `default` that catches `sum`/`count`

File: src/contexts/goal/ui/helpers.ts:34-43
Quote:

```
case 'sum':
case 'count':
default:
  return `${cur} / ${tgt}`
```

Rule: The `default` makes the switch non-exhaustive — new AggregationFunction values silently fall through
Fix: Handle all four cases explicitly, add `default: { const _: never = aggregation; ... }`.

### TS-026 [NIT] `progressBarColorClass` uses `default` as a valid case for `gray`

File: src/contexts/goal/ui/helpers.ts:232-241
Quote:

```
case 'gray':
default:
  return 'bg-gray-300'
```

Rule: Mixing a valid case with the default hides non-exhaustiveness
Fix: Separate `case 'gray': return 'bg-gray-300'` and add exhaustive default for compile-time safety.

---

## 6. Exported Functions Without Explicit Return Types

### TS-027 [MINOR] ~140 exported functions lack explicit return type annotations

Files: Widespread across src/components/, src/contexts/\*/server/, src/shared/
Representative examples:

- `src/shared/auth/server-errors.ts:27` — `export function throwContextError(...){`
- `src/shared/auth/auth.ts:43` — `export function createAuth() {`
- `src/contexts/goal/domain/progress-strategy.ts:46` — `export function buildProgressQuery(...){`
- `src/components/inbox/inbox-status-actions.tsx:7` — `export function getStatusActions(...){`
  Rule: TypeScript best practice — exported functions should have explicit return types for public API stability and to prevent accidental type drift
  Fix: Add return type annotations to all exported functions. Prioritize domain layer (constructors, rules, use cases) and public-api surfaces. React components are lower priority since TS infers JSX.Element correctly.

### TS-028 [NIT] Many exported React components lack return type annotations

Files: src/components/\*_/_.tsx (80+ components)
Rule: React components benefit less from explicit return types since TS infers JSX correctly, but it improves documentation
Fix: Low priority. Add `: JSX.Element` or `: React.ReactElement` when touching these files.

---

## 7. Additional `as` Casts (Non-`unknown`)

### TS-029 [MINOR] Pervasive `id as string` pattern to strip brands for Drizzle queries

Files: src/contexts/inbox/infrastructure/repositories/inbox.repository.ts (10+), src/contexts/goal/infrastructure/repositories/goal.repository.ts (8+), src/contexts/activity/infrastructure/activity-repository.drizzle.ts (6+), src/contexts/staff/infrastructure/repositories/staff-assignment.repository.ts (8+)
Quote (representative):

```
eq(activityLog.organizationId, input.organizationId as string),
```

Rule: ids.ts provides `unbrand()` for exactly this purpose
Fix: Replace `id as string` with `unbrand(id)`. This centralizes the brand-stripping logic and makes it auditable.

### TS-030 [NIT] `value as EntityType` without runtime validation in mapper

File: src/contexts/portal/infrastructure/mappers/portal.mapper.ts:19
Quote: `return value as EntityType`
Rule: Infrastructure mappers should validate at the boundary, not just cast
Fix: Add a runtime check: `if (!['team', 'staff', 'property'].includes(value)) throw ...`

### TS-031 [NIT] `'new' as InboxStatus` cast in domain constructor

File: src/contexts/inbox/domain/constructors.ts:68
Quote: `status: 'new' as InboxStatus,`
Rule: If `'new'` is a valid `InboxStatus`, the cast is unnecessary if the type is properly defined
Fix: Verify the type includes `'new'` — if so, remove the cast.

### TS-032 [MINOR] `propertyIds as readonly string[]` and `as [string, ...string[]]` for Drizzle inArray

Files: src/contexts/property/infrastructure/repositories/property.repository.ts:160,191; src/contexts/goal/infrastructure/repositories/goal.repository.ts:156
Quote: `inArray(properties.id, propertyIds as readonly string[])`
Rule: Same as TS-029 — use `unbrandAll()` instead
Fix: Replace with `unbrandAll(propertyIds)`.
