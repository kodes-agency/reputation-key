# Convergence Round 3 — Final Edge-Case Pass

**Date:** 2026-06-10
**Reviewer:** ConvergenceFinal
**Scope:** 10 highest-risk files from previous rounds, focused on unreachable paths, silent data loss, concurrency, and type unsoundness.

## Summary

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 1     |
| MAJOR     | 4     |
| MINOR     | 3     |
| NIT       | 0     |
| **Total** | **8** |

---

## Findings

### 1. BLOCKER: Dual goal repository instance — event handlers and public API use different repo

The composition root creates `goalRepoEarly` via `_createGoalRepo(db)` at line 282, then passes it to `_cancelGoalFn`. But `buildGoalContext` internally creates a _second_ `goalRepo` via `createGoalRepository(input.db)` at line 56 of goal/build.ts. The `cancelGoalFn` closure holds the early repo, while `registerGoalEventHandlers` (called inside `buildGoalContext`) receives the newly created repo. These are two separate repository objects backed by the same `db` — functionally identical today (stateless factory), but if any repository gains in-memory state (caching, prepared statements, connection pooling), the two instances will silently diverge.

````
[ARCH] BLOCKER Composition root creates two goal repository instances — cancelGoalFn and event handlers hold different repo objects
  File: src/composition.ts:282-283
  Quote: ```
  const goalRepoEarly = _createGoalRepo(db)
  const goalCancelFn = _cancelGoalFn({ goalRepo: goalRepoEarly, clock })
````

Rule: Single-responsibility — a context should own exactly one instance of its repository.
If buildGoalContext creates its own repo internally, cancelGoalFn should receive it,
not an externally-created duplicate.
Fix: Pass `goalRepoEarly` into `buildGoalContext` as a dependency (like portal/staff do),
so `buildGoalContext` does not call `createGoalRepository` internally. Alternatively,
have `buildGoalContext` accept a `cancelGoalFn` and expose its own `goalRepo` in the
return value so the composition root can wire cancelGoal from the same instance.

```

---

### 2. MAJOR: Module-level logger call in goal repository — import-time side effect

```

const log = getLogger().child({ component: 'goal-repo' })

```

This runs at module import time, before the logger may be initialized. If any test or consumer imports this module before logger setup, `getLogger()` returns a default/noop logger — which works — but it means the `.child()` call happens once at import time and never updates if the logger is reconfigured later. Other repositories use `trace()` without a module-level logger.

```

[ARCH] MAJOR Goal repository creates module-level logger — import-time side effect, never reconfigures
File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:23
Quote: ```
const log = getLogger().child({ component: 'goal-repo' })

```
Rule:  Infrastructure should defer resource acquisition. Other repos (portal, notification)
       use `trace()` without module-level logger allocation.
Fix:   Move logger creation into each method body, or use `trace()` exclusively like other
       repositories. If logging outside trace is needed, create a lazy getter:
       `const getLog = () => getLogger().child({ component: 'goal-repo' })`.
```

---

### 3. MAJOR: `findPublicPortalBySlug` throws plain Error with ad-hoc `_tag` — unhandled in callers

When a portal is found but inactive, line 223-225 throws `Object.assign(new Error('Portal is inactive'), { _tag: 'portal_inactive' as const })`. This is a raw throw in a repository method — the error shape is not a domain error from `portalError()`. Callers expecting `Result<T>` or typed errors will not catch this correctly. The error also has no `organizationId` or `portalId` for debugging.

````
[DOMAIN] MAJOR findPublicPortalBySlug throws ad-hoc Error instead of domain error — callers cannot type-safely handle
  File: src/contexts/portal/infrastructure/repositories/portal.repository.ts:222-226
  Quote: ```
  if (!portal.isActive) {
    throw Object.assign(new Error('Portal is inactive'), {
      _tag: 'portal_inactive' as const,
    })
  }
````

Rule: Domain errors should use the context's error constructor (portalError).
Ad-hoc throws bypass the Result pattern and error boundaries.
Fix: Use `throw portalError('inactive', 'Portal is inactive')` or return
`null` and let the caller decide. The public portal endpoint should
handle inactive portals at the server/route level.

```

---

### 4. MAJOR: `resolvePortalContext` skips tenant filter — returns orgId for any portal without ownership check

```

resolvePortalContext: async (portalIdParam) => {
const rows = await db
.select(...)
.from(portals)
.where(eq(portals.id, unbrand(portalIdParam))) // no organizationId filter!
.limit(1)
...
}

```

Every other repository method filters by `organizationId` (via `baseWhere` or explicit `eq`). This method resolves a portal by ID alone and returns the `organizationId` — it's the *authority* for tenant context resolution. While it's called from public (unauthenticated) click-through routes, this means any portal ID leak exposes the owning org's ID and property ID. The method name suggests it's by design (resolving context for a given portal), but the returned data should be audited for what consumers do with it.

```

[SECURITY] MAJOR resolvePortalContext has no tenant filter — returns org+property IDs for any portal UUID
File: src/contexts/portal/infrastructure/repositories/portal.repository.ts:173-191
Quote: ```
.where(eq(portals.id, unbrand(portalIdParam)))

```
Rule:  Defense-in-depth — even public-facing queries should minimize data exposure.
       If this is intentional (public click-through), the return type should be constrained
       to only expose what the public route needs.
Fix:   Document that this is intentionally tenant-agnostic (it resolves the tenant from a
       portal ID for public routes). Consider returning a narrower type that excludes
       `propertyId` if the caller only needs `organizationId`. Add a code comment explaining
       why no tenant filter is applied here.
```

---

### 5. MAJOR: `_authenticated.tsx` loader silently swallows errors — empty arrays on failure

The `loader` at line 123-133 runs `Promise.all([listUserOrganizations(), listProperties()])` with no try/catch. If either fails, TanStack Router's error boundary handles it. However, the `beforeLoad` (which runs first) catches `no_active_org` errors gracefully and returns a default state — but if `beforeLoad` succeeds and `loader` then fails, the user sees a generic error page instead of a degraded-but-functional UI with empty org/property lists.

````
[UX] MAJOR _authenticated.tsx loader fails ungracefully — no fallback to empty state on org/property fetch failure
  File: src/routes/_authenticated.tsx:123-133
  Quote: ```
  loader: async () => {
    const [orgsResult, propsResult] = await Promise.all([
      listUserOrganizations(),
      listProperties(),
    ])
    return {
      organizations: orgsResult.organizations,
      properties: propsResult.properties,
    }
  },
````

Rule: Graceful degradation — authenticated layout should be usable even if org/property
list fetch fails (e.g., network blip). beforeLoad handles missing org gracefully;
loader should match that pattern.
Fix: Wrap in try/catch, return empty arrays on failure, log the error. The sidebar
renders correctly with empty arrays — the user can still navigate to settings
or refresh to retry.

```

---

### 6. MINOR: `crypto.randomUUID()` in domain events — global `crypto` without explicit import

Identity domain events use `crypto.randomUUID()` 6 times without importing `crypto`. This relies on Node.js global `crypto` (available since Node 19) and browser `crypto.randomUUID()` (available in secure contexts). In domain layer code, this is an I/O boundary concern — ID generation should be injected, as portal/build.ts does with `randomUUID` from `'crypto'`.

```

[DOMAIN] MINOR Identity events use global crypto.randomUUID() — not injected, domain layer should not depend on platform APIs
File: src/contexts/identity/domain/events.ts:31,55,77,98,120,147
Quote: ```
eventId: crypto.randomUUID(),

```
Rule:  Domain layer should receive dependencies, not import global platform APIs.
       Portal/build.ts correctly imports from 'crypto' and injects via idGen.
Fix:   Accept an `eventIdGen?: () => string` parameter in each constructor, defaulting
       to `crypto.randomUUID()`. This allows testing with deterministic IDs and aligns
       with the port/adapter pattern used elsewhere.
```

---

### 7. MINOR: Notification email `onConflictDoUpdate` target is only `notificationId` — race on duplicate inserts

The email queue insert uses `.onConflictDoUpdate({ target: [notificationEmailQueue.notificationId] })`. If two events produce the same `notificationId` concurrently (e.g., duplicate event delivery), the upsert updates only `priority` and `updatedAt` — discarding the second event's data. This is likely intentional (dedup), but the `status` field is not reset on conflict: if the first insert was already processed to `sent`, a duplicate delivery won't re-queue it.

````
[DATA] MINOR Notification email upsert dedup does not reset status — duplicate event delivery won't re-queue sent emails
  File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:56-61
  Quote: ```
  .onConflictDoUpdate({
    target: [notificationEmailQueue.notificationId],
    set: {
      priority: email.priority,
      updatedAt: email.updatedAt,
    },
  })
````

Rule: Dedup logic should be explicit about which fields are merged vs. preserved.
If status='sent', a duplicate event should be a no-op (not re-sent), which is
the correct behavior — but this should be documented.
Fix: Add a comment explaining the dedup behavior: "If a notification email already
exists (e.g., duplicate event delivery), only update priority. Do not reset
status — sent emails are not re-queued." If re-queuing is desired for failed
sends, add `status: email.status` to the set clause.

```

---

### 8. MINOR: Goal `listInstancesBatch` non-null assertion on `parentGoalId`

```

const parentId = goal.parentGoalId!

```

This asserts `parentGoalId` is non-null, but the method is specifically for looking up instances (which should always have a parent). If a data corruption bug creates a goal instance without `parentGoalId`, this will silently map it to key `undefined` in the Map, corrupting the batch result.

```

[DATA] MINOR listInstancesBatch non-null assertion on parentGoalId — silent corruption on null
File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:500
Quote: ```
const parentId = goal.parentGoalId!

```
Rule:  Non-null assertions should be validated. If parentGoalId is null, the goal is not
       an instance and should be filtered out, not silently mapped.
Fix:   Add a guard: `if (!goal.parentGoalId) continue` or `if (!goal.parentGoalId) { log.warn(...); continue }`.
       This prevents Map corruption on edge-case data.
```

---

## Files Reviewed (10/10)

| #   | File                                                                   | Status                                                                             |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `src/contexts/portal/build.ts`                                         | D4 shape violation (known from R2), no new edge cases                              |
| 2   | `src/contexts/goal/build.ts`                                           | D4 shape violation (known from R2), no new edge cases                              |
| 3   | `src/contexts/goal/infrastructure/repositories/goal.repository.ts`     | Module-level logger, non-null assertion, throw new Error pattern (findings #2, #8) |
| 4   | `src/contexts/portal/infrastructure/repositories/portal.repository.ts` | Ad-hoc throw, tenant-less query (findings #3, #4)                                  |
| 5   | `src/contexts/inbox/domain/rules.ts`                                   | Clean — canAssign uses hasRole correctly                                           |
| 6   | `src/contexts/notification/infrastructure/repositories/` (4 files)     | Non-null assertions on returning(), email dedup gap (finding #7)                   |
| 7   | `src/contexts/identity/domain/events.ts`                               | Global crypto in domain (finding #6)                                               |
| 8   | `src/composition.ts`                                                   | Dual goal repo instance (finding #1)                                               |
| 9   | `src/shared/domain/permissions.ts`                                     | Clean — module-level `_lookup` is set at startup, `can()` throws if uninitialized  |
| 10  | `src/routes/_authenticated.tsx`                                        | Loader error handling gap (finding #5)                                             |
