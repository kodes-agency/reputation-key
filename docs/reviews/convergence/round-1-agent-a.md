# Convergence Pass — Agent A: Edge Cases, Unchecked Returns, Unsafe Casts

**Scope:** notification context, shared modules, worker, composition/bootstrap/router/start
**Date:** 2026-06-10

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 3      |
| MAJOR     | 11     |
| MINOR     | 7      |
| NIT       | 3      |
| **Total** | **24** |

---

## BLOCKER

[BLOCKER] Non-null assertion on `returning()` result — crash if DB upsert returns empty
File: src/contexts/notification/infrastructure/repositories/notification.repository.ts:51
Quote: ```
return notificationFromRow(row[0]!)

````
Rule:  Domain constructors — "Domain Returns Result<T, DomainError>. Never throws."
       PostgreSQL `INSERT ... ON CONFLICT ... RETURNING` should always return a row, but a
       constraint violation or schema mismatch could return an empty array, causing an
       unhandled TypeError at runtime.
Fix:   Guard with `if (!row[0]) throw new Error('insert returned no row')` or return
       `Result<Notification, NotificationError>`.

[BLOCKER] Non-null assertion on `returning()` result — crash if DB upsert returns empty
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:65
Quote: ```
  return emailFromRow(row[0]!)
````

Rule: Same as above. The `insert` with `onConflictDoUpdate().returning()` is assumed
to always produce a row.
Fix: Guard `row[0]` before accessing. Throw a tagged error or return Result.

[BLOCKER] Non-null assertion on `returning()` result — crash if DB upsert returns empty
File: src/contexts/notification/infrastructure/repositories/notification-preference.repository.ts:79
Quote: ```
return preferenceFromRow(row[0]!)

````
Rule:  Same as above.
Fix:   Guard `row[0]` before accessing. Throw a tagged error or return Result.

---

## MAJOR

[MAJOR] Non-null assertion on `count(*)` aggregate result — crash on empty table
File: src/contexts/notification/infrastructure/repositories/notification.repository.ts:132
Quote: ```
  return rows[0]!.count
````

Rule: `count(*)` on an empty table returns `[{count: 0}]`, so this is safe in practice,
but the non-null assertion bypasses TypeScript's null protection. If the query
shape changes (e.g., a WHERE clause filters to nothing in a grouped query), this
becomes a runtime crash.
Fix: Use `rows[0]?.count ?? 0` or assert with a descriptive error.

[MAJOR] Non-null assertion on `Map.get()` — unchecked map entry
File: src/contexts/notification/infrastructure/jobs/digest-notification.job.ts:75
Quote: ```
byUser.get(uid)!.push(entry)

````
Rule:  Defensive programming — `Map.get()` returns `undefined` if key not found. The
       `has()` check above should guarantee it exists, but a `!` assertion hides a
       potential logic error if the code is refactored.
Fix:   Use `const list = byUser.get(uid); if (list) list.push(entry)` or
       `byUser.get(uid)?.push(entry)`.

[MAJOR] Unsafe `as` cast on DB row types — no runtime validation
File: src/contexts/notification/infrastructure/repositories/notification-row.mapper.ts:28-31
Quote: ```
  type: row.type as NotificationType,
  priority: row.priority as NotificationPriority,
  status: row.status as NotificationStatus,
  resourceType: row.resourceType as NotificationResourceType,
````

Rule: Per conventions: "as casts except for branded ID parsing are forbidden." These
are NOT branded ID casts — they assert string literal types from DB varchar columns.
A schema migration or manual DB edit that introduces an invalid value will silently
corrupt domain types.
Fix: Validate with a runtime check against the ALLOWED\_\* sets before casting, or
parse with a Zod schema at the repository boundary.

[MAJOR] Unsafe `as` casts on email queue row — no runtime validation
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:28-29
Quote: ```
status: row.status as EmailQueueStatus,
priority: row.priority as NotificationPriority,

````
Rule:  Same as above — string literal type assertions without runtime guards.
Fix:   Validate at repository boundary.

[MAJOR] Unsafe `as` cast on preference type column — no runtime validation
File: src/contexts/notification/infrastructure/repositories/notification-preference.repository.ts:22
Quote: ```
  type: row.type as NotificationType,
````

Rule: Same — string literal assertion on DB column.
Fix: Validate at repository boundary.

[MAJOR] Unsafe `as` casts on raw SQL query results — untyped `Record<string, unknown>`
File: src/contexts/notification/infrastructure/adapters/db-user-lookup.adapter.ts:20-21,37-38,47-48,56-57
Quote: ```
result.rows as Record<string, unknown>[]
r.user_id as string
row?.email as string
row?.name as string

````
Rule:  Raw SQL results are untyped. The `as Record<string, unknown>[]` and `as string`
       casts skip all validation. If the query returns unexpected column names (e.g.,
       after a schema migration), these silently produce `undefined` values cast to
       branded types.
Fix:   Add runtime checks (e.g., `typeof r.user_id === 'string'`) or use Zod to
       parse the row shape.

[MAJOR] Unsafe `as` casts in urgent-email job — bypassing branded types
File: src/contexts/notification/infrastructure/jobs/urgent-email.job.ts:46-47,66
Quote: ```
  notificationId(entry.notificationId as string),
  entry.organizationId as Parameters<typeof notifRepo.findById>[1],
  entry.userId as Parameters<typeof userLookup.getEmail>[0],
````

Rule: These casts are redundant — `entry.notificationId` is already `NotificationId`
(branded string). Casting branded → string → back to branded is a code smell.
The `as Parameters<...>` casts bypass TypeScript's structural checks on the port.
Fix: Use `unbrand()` for DB layer, pass branded types directly to ports
(which accept them structurally).

[MAJOR] Unsafe `as` casts in digest-notification job — bypassing branded types
File: src/contexts/notification/infrastructure/jobs/digest-notification.job.ts:73,81,89,113,126
Quote: ```
entry.userId as string
uid as Parameters<typeof userLookup.getEmail>[0]
notificationId(entry.notificationId as string)
notificationEmailId(entry.id as string)
notificationEmailId(entry.id as string)

````
Rule:  Same as urgent-email job — branded IDs cast to string and back, plus
       `as Parameters<...>` bypassing port type signatures.
Fix:   Use `unbrand()` or rely on structural typing — don't double-cast.

[MAJOR] `createNotification` assigns `'' as unknown as NotificationId` — invalid ID
File: src/contexts/notification/domain/constructors.ts:83
Quote: ```
  id: '' as unknown as NotificationId,
````

Rule: The constructor produces a notification with an empty-string ID that is never
valid. Callers must overwrite `.id` after construction (line 78 of
insert-notification.ts: `{ ...result.value, id: deps.idGen() }`). This is a
latent bug: any code path that uses the constructor output directly (without
reassigning `id`) will persist a row with an empty primary key.
Fix: Either make `id` a required parameter of `CreateNotificationInput`, or return
a type that excludes `id` and require the caller to provide it.

[MAJOR] `createNotificationEmail` and `createNotificationPreference` also assign empty IDs
File: src/contexts/notification/domain/constructors-email.ts:28
Quote: ```
id: '' as unknown as NotificationEmailId,

````
File: src/contexts/notification/domain/constructors-preference.ts:37
Quote: ```
  id: '' as unknown as NotificationPreferenceId,
````

Rule: Same empty-ID pattern as `createNotification`.
Fix: Accept `id` as a constructor parameter instead of relying on post-hoc overwrite.

[MAJOR] Side effect at import time — `initPermissionTable()` called unconditionally
File: src/shared/auth/permissions.ts:133
Quote: ```
initPermissionTable()

````
Rule:  Module-level side effects make testing harder and import order fragile. The
       comment justifies it, but it violates the "no side effects at import time" principle.
       If `shared/domain/roles` changes after import (e.g., in tests), the permission
       table will be stale.
Fix:   Call `initPermissionTable()` explicitly from `bootstrap()` or `createContainer()`.
       The comment's argument ("every importer would need to remember to call it") is
       better solved by a single call site.

---

## MINOR

[MINOR] `insertNotification` use case throws plain Error on domain validation failure
File: src/contexts/notification/application/use-cases/insert-notification.ts:55
Quote: ```
  throw new Error(result.error.message)
````

Rule: Per conventions: "No plain Error objects. Ever." and "Throw tagged errors at the
application boundary." The use case creates a `NotificationError` via `notificationError()`
but then throws a plain `Error` with just the message string, losing the `_tag`, `code`,
and `details` fields.
Fix: Throw a tagged error: `throw { ...result.error }` or use a `taggedThrow` helper.

[MINOR] `findPendingByOrg` ignores tenant isolation — queries by org only, no user scope
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:78-95
Quote: ```
findPendingByOrg: async (orgId: string, priority: string) => { ... }

````
Rule:  Not a layer violation per se (it IS org-scoped), but the `priority` param is
       `string` instead of `NotificationPriority`, allowing invalid values.
Fix:   Type `priority` as `NotificationPriority`.

[MINOR] `findById` on email repo has no org scope — potential tenant leak
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:68-76
Quote: ```
  findById: async (id: string): Promise<NotificationEmail | null> => {
    const rows = await db.select().from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.id, id)).limit(1)
  ```
Rule:  Every repository query should filter by `organization_id` per architecture.
       This `findById` is only scoped by `id`, meaning any caller could read emails
       from another organization if they know the ID. The port type also omits `orgId`.
Fix:   Add `orgId` parameter and filter by `organizationId`.

[MINOR] Duplicate `escapeHtml` function — one in shared/email, one in shared/auth/emails
File: src/shared/auth/emails.ts:11-18
File: src/shared/email/template.ts:7-14
Quote: ```
  export function escapeHtml(raw: string): string { ... }
````

Rule: DRY — two identical `escapeHtml` implementations exist.
Fix: Import from `#/shared/email` in `shared/auth/emails.ts` and remove the duplicate.

[MINOR] Duplicate `emailShell` function — one in shared/email, one in shared/auth/emails
File: src/shared/auth/emails.ts:87-115
File: src/shared/email/template.ts:17-45
Rule: Same DRY issue — two nearly identical `emailShell` implementations.
Fix: Import from `#/shared/email` in `shared/auth/emails.ts` and remove the duplicate.

[MINOR] `parseInt` without radix on `toLocaleString` hour output
File: src/contexts/notification/infrastructure/jobs/digest-notification.job.ts:36
Quote: ```
return parseInt(s, 10)

````
Rule:  The `s` value from `toLocaleString('en-US', { hour: 'numeric', hour12: false })`
       can return `"24"` for midnight in some locales (ICU-dependent), not `"0"`. This
       means the digest will never fire for orgs at midnight UTC offset.
Fix:   Normalize: `const h = parseInt(s, 10); return h === 24 ? 0 : h;`

[MINOR] `byUser.get(uid)!.push(entry)` — `uid` extracted via `as string` from branded type
File: src/contexts/notification/infrastructure/jobs/digest-notification.job.ts:73
Quote: ```
  const uid = entry.userId as string
````

Rule: `entry.userId` is `UserId` (branded string). The `as string` cast is unnecessary
for Map key usage — branded strings are valid Map keys. The cast discards type info.
Fix: Use `entry.userId` directly as the Map key (branded string works as Map key).

---

## NIT

[NIT] Duplicate `maskEmail` function — one in shared/auth/emails, one in notification resend adapter
File: src/shared/auth/emails.ts:50-53
File: src/contexts/notification/infrastructure/adapters/resend-email.adapter.ts:17-21
Quote: ```
function maskEmail(email: string): string { ... }

````
Rule:  DRY — two `maskEmail` implementations with slightly different masking logic.
Fix:   Extract to `shared/email` or `shared/observability/pii` and reuse.

[NIT] `connection as unknown as import('bullmq').ConnectionOptions` — double cast
File: src/shared/jobs/worker.ts:37
File: src/shared/jobs/queue.ts:37
Quote: ```
  connection: connection as unknown as import('bullmq').ConnectionOptions,
````

Rule: Required by BullMQ's type mismatch with ioredis, but could be extracted to a
shared helper to reduce duplication.
Fix: Extract `asBullConnection(redis: Redis): import('bullmq').ConnectionOptions` helper.

[NIT] `shared/auth/error-status.ts` is a re-export shim — deprecated file
File: src/shared/auth/error-status.ts:1-3
Quote: ```
// This file is deprecated. Import from '#/shared/http/status' instead.

```
Rule:  Dead import path — consumers should use the canonical location.
Fix:   Migrate any remaining imports and delete the shim.
```
