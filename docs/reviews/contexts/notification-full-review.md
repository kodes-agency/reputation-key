# Notification Context — Full Review (Convergence Round 2)

**Date:** 2026-06-10
**Reviewer:** NotificationDeep (automated convergence pass)
**Scope:** `src/contexts/notification/` — all layers (domain, application, infrastructure, server)
**Dimensions:** D1, D2, D3, D4, D5, D7, D8, D11, D12, D15

---

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 2      |
| MAJOR     | 6      |
| MINOR     | 4      |
| NIT       | 3      |
| **Total** | **15** |

---

## BLOCKER Findings

### [D7] BLOCKER — `markSent`/`markFailed`/`markSkipped` on email queue lack orgId WHERE clause

```
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:112-151
Quote:
  markSent: async (id: string, sentAt: Date, updatedAt: Date): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({ status: 'sent', sentAt, updatedAt })
      .where(
        and(
          eq(notificationEmailQueue.id, id),
          inArray(notificationEmailQueue.status, ['pending', 'failed']),
        ),
      )
  },
```

Rule: D7 (tenancy) — all mutations must be scoped by `organizationId`
Fix: Add `eq(notificationEmailQueue.organizationId, orgId)` to WHERE for `markSent`, `markFailed`, and `markSkipped`. Update the port signatures to accept `orgId` and thread it from callers.

### [D15] BLOCKER — Non-null assertions on `.returning()` results can crash at runtime

```
File: src/contexts/notification/infrastructure/repositories/notification.repository.ts:49-51
Quote:
      .returning()

    return notificationFromRow(row[0]!)
```

Rule: D15 (errors) — `.returning()` on INSERT can return empty array (e.g. conflict without returning). Non-null assertion masks this as a runtime crash.
Fix: Replace `row[0]!` with a guard: `const r = row[0]; if (!r) throw new Error('...'); return notificationFromRow(r);`. Same fix needed in `notification-email.repository.ts:65` and `notification-preference.repository.ts:79`.

---

## MAJOR Findings

### [D7] MAJOR — `emailRepo.findById(id)` has no orgId filter

```
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:68-75
Quote:
  findById: async (id: string): Promise<NotificationEmail | null> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.id, id))
      .limit(1)
```

Rule: D7 (tenancy) — lookups should be tenant-scoped where possible. Cross-tenant email queue access.
Fix: Add `orgId` parameter to the port and filter by it, or document the intentional cross-tenant access (used by urgent-email job).

### [D5] MAJOR — `UserLookupPort.findAssignedManagers(propertyId)` has no orgId parameter

```
File: src/contexts/notification/application/ports/user-lookup.port.ts:12
Quote:
  findAssignedManagers(propertyId: string): Promise<readonly UserId[]>
```

Rule: D5 (ports) — defense-in-depth: property IDs may not be globally unique across orgs (especially in multi-tenant SaaS). The SQL JOIN on `staff_assignments` doesn't filter by org.
Fix: Add `orgId: OrganizationId` parameter and filter `WHERE sa.organization_id = ${orgId}` in the adapter.

### [D8] MAJOR — Server functions use `inbox.read` permission instead of notification-specific permission

```
File: src/contexts/notification/server/notifications.ts:24,55,99,133
Quote:
  if (!can(ctx.role, 'inbox.read')) {
```

Rule: D8 (server fns) — notification server functions should use their own permission (`notification.read`), not the inbox context's permission. Notification access is semantically different from inbox access.
Fix: Define a `notification.read` permission and use it in all four server functions.

### [D11] MAJOR — `createNotification` uses placeholder `'' as unknown as NotificationId`

```
File: src/contexts/notification/domain/constructors.ts:83
Quote:
    id: '' as unknown as NotificationId,
```

Rule: D11 (domain purity) — the domain constructor produces an entity with an invalid ID. The ID is replaced by the use case, but the domain layer should not produce invalid state. This pattern requires every caller to remember to overwrite the ID.
Fix: Accept `idGen` in the constructor input or return the entity without `id` (Omit<Notification, 'id'>) and let the use case construct the final object.

### [D3] MAJOR — No `updatePreference` or `markDismissed` use case exposed via public API

```
File: src/contexts/notification/build.ts:53-74
Quote:
  const publicApi = {
    insertNotification: useCases.insertNotification,
    findById: ...
    getUnreadCount: ...
    getNotifications: ...
    markRead: ...
    markAllRead: ...
  }
```

Rule: D3 (use cases) — The domain supports `dismissed` status but no server function or use case exposes dismissal. Similarly, `upsert` on preferences exists in the repo but no use case or server function exposes preference management.
Fix: Add `dismissNotification` use case and `updateNotificationPreference` use case + server function, or document as intentional MVP deferral in CONTEXT.md.

### [D4] MAJOR — `build.ts` `markRead` bypasses domain transition result

```
File: src/contexts/notification/build.ts:62-69
Quote:
    markRead: async (id: string, orgId: string) => {
      const n = await notificationRepo.findById(id, orgId)
      if (!n) return
      const now = input.clock()
      const result = markNotificationRead(n, () => now)
      if (result.isErr()) return
      await notificationRepo.markRead(id, orgId, now, now)
    },
```

Rule: D4 (build) — The `markRead` in the composition root directly calls the repo after the domain transition, but the domain transition returns a new `Notification` object with updated fields. The repo's `markRead` ignores the domain result and sets `readAt` and `updatedAt` from `input.clock()`. This works but violates the pattern where the domain object is the source of truth.
Fix: Use `result.value.readAt` and `result.value.updatedAt` from the domain transition result when calling `notificationRepo.markRead`.

---

## MINOR Findings

### [D1] MINOR — `InsertNotificationInput` duplicates `NotificationResourceType` instead of importing it

```
File: src/contexts/notification/application/use-cases/insert-notification.ts:26
Quote:
  resourceType: 'inbox_item' | 'reply' | 'goal'
```

Rule: D1 (boundaries) — The type is already defined as `NotificationResourceType` in domain/types.ts. Duplicating it creates drift risk.
Fix: Import and use `NotificationResourceType` from `../../domain/types`.

### [D2] MINOR — Event handler `on-inbox-note-added` self-notification filter compares branded `UserId` with `!==`

```
File: src/contexts/notification/infrastructure/event-handlers/on-inbox-note-added.ts:25
Quote:
    const filtered = recipients.filter((uid) => uid !== event.userId)
```

Rule: D2 (events) — Branded types (`UserId`) are nominally typed. The `!==` comparison works at runtime (both are strings), but if the brand ever becomes more than a type-level annotation, this would break. Worth a comment.
Fix: Add a comment explaining the string equality is intentional, or use `unbrand(uid) !== unbrand(event.userId)`.

### [D11] MINOR — `emailFromRow` uses `as` casts without runtime validation

```
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:28-29
Quote:
  status: row.status as EmailQueueStatus,
  priority: row.priority as NotificationPriority,
```

Rule: D11 (domain purity) — If the DB contains an unexpected status value, it silently leaks into the domain. Same pattern exists in `notification-row.mapper.ts` and `preferenceFromRow`.
Fix: Add a validation function or use a parse helper that throws on invalid values.

### [D12] MINOR — CONTEXT.md says "11 notification types" but could drift

```
File: src/contexts/notification/CONTEXT.md:30
Quote:
  ## Notification types (11)
```

Rule: D12 (doc accuracy) — The type count is hardcoded. If a type is added/removed, CONTEXT.md may not be updated. Same for the URGENT_TYPES count (3).
Fix: Keep the table but remove the hardcoded count, or add a comment that the count must match `NotificationType`.

---

## NIT Findings

### [D15] NIT — `insert-notification.ts` use case throws instead of returning Result

```
File: src/contexts/notification/application/use-cases/insert-notification.ts:55
Quote:
      throw new Error(result.error.message)
```

Rule: D15 (errors) — The domain returns `Result`, but the use case converts it to a thrown exception. This is inconsistent with the domain's "never throws" principle at the application layer. Acceptable since it's the use case boundary, but worth noting.
Fix: Consider returning `Result<Notification | null, NotificationError>` from the use case for consistency, or document the throw-as-boundary decision.

### [D5] NIT — `findPendingUrgent` queries across all orgs without explicit documentation

```
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:97-110
Quote:
  findPendingUrgent: async (): Promise<NotificationEmail[]> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.status, 'pending'),
          eq(notificationEmailQueue.priority, 'urgent'),
        ),
      )
```

Rule: D5 (ports) — The port comment says "across all orgs" but the implementation doesn't have a LIMIT. For large deployments, this could load millions of rows.
Fix: Add a LIMIT clause (e.g. 1000) and paginate, or document the intentional unbounded query.

### [D1] NIT — `resend-email.adapter.ts` uses module-level mutable singleton

```
File: src/contexts/notification/infrastructure/adapters/resend-email.adapter.ts:7-8
Quote:
  let _resend: Resend | undefined

  function getResend(): Resend {
```

Rule: D1 (boundaries) — Module-level mutable state makes testing harder and is inconsistent with the factory pattern used elsewhere.
Fix: Accept `Resend` instance as a parameter to `createResendEmailAdapter`, or use the factory pattern consistently.

---

## Clean Areas

- **Domain types**: Clean `Readonly<>` usage, branded IDs, proper `Result` returns.
- **Event handler coverage**: All 11 notification types have corresponding handlers, matching CONTEXT.md table.
- **Port structure**: Type-alias + `Readonly<{…}>` pattern followed consistently.
- **Schema**: Proper indexes for query patterns, idempotency keys, sparse preferences.
- **Server functions**: Proper tenant resolution, auth checks, zod validation.
- **Test coverage**: Domain constructors, use case, event handlers, and jobs all have test files.
