# Auth Session Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate redundant database queries on every page load by enabling better-auth's built-in cookie cache and adding a short-lived TTL cache to `resolveTenantContext`.

**Architecture:** Two-layer caching. Layer 1: better-auth `cookieCache` makes `getSession()` read from a signed cookie (~1ms) instead of hitting the DB (~800ms). Layer 2: a TTL-based in-memory cache in `resolveTenantContext` deduplicates the remaining `getActiveMember()` DB call across parallel server functions in the same page load. No callers change — the caching is transparent.

**Tech Stack:** better-auth `cookieCache`, better-auth `organization` plugin, Map-based TTL cache

**Root cause recap:** On dashboard load, `auth.api.getSession()` is called ~10 times across 5 server functions. Each call hits the DB at ~800ms. `resolveTenantContext` is called 5+ times, each making 2 DB queries. Total: ~8s of auth overhead for data that changes at most once per session.

---

## File Structure

| File                                           | Action | Responsibility                                        |
| ---------------------------------------------- | ------ | ----------------------------------------------------- |
| `src/shared/auth/auth.ts`                      | Modify | Enable `cookieCache` in better-auth config            |
| `src/shared/auth/middleware.ts`                | Modify | Add TTL cache to `resolveTenantContext`, clear helper |
| `src/shared/auth/middleware.test.ts`           | Modify | Add cache hit/miss tests, TTL expiry test             |
| `src/shared/observability/traced-server-fn.ts` | Modify | Call `clearTenantCache()` at end of each server fn    |

No other files change. All 47 callers of `resolveTenantContext` across identity, property, portal, team, and staff modules benefit transparently.

---

### Task 1: Enable better-auth cookieCache

**Files:**

- Modify: `src/shared/auth/auth.ts:73-76`

**Why:** This is the single biggest win. Makes `auth.api.getSession()` read from a signed cookie instead of querying the database. Goes from ~800ms to <5ms per call.

- [ ] **Step 1: Add cookieCache config to auth.ts**

In `src/shared/auth/auth.ts`, change the `session` config block (lines 73-76) from:

```typescript
    session: {
      expiresIn: SESSION_EXPIRY_SECONDS, // 30 days
      updateAge: SESSION_UPDATE_AGE_SECONDS, // Rolling update every 24 hours
    },
```

to:

```typescript
    session: {
      expiresIn: SESSION_EXPIRY_SECONDS, // 30 days
      updateAge: SESSION_UPDATE_AGE_SECONDS, // Rolling update every 24 hours
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes — session revalidated from DB at most every 5 min
      },
    },
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `pnpm vitest run src/shared/auth/`
Expected: All existing tests pass. cookieCache only affects runtime DB behavior, not the auth module's exports or types.

- [ ] **Step 3: Commit**

```bash
git add src/shared/auth/auth.ts
git commit -m "perf: enable better-auth cookieCache for session reads

getSession() now reads from a signed cookie (~1ms) instead of
querying the database (~800ms) on every call. Session data is
revalidated from DB at most every 5 minutes."
```

---

### Task 2: Add TTL cache to resolveTenantContext

**Files:**

- Modify: `src/shared/auth/middleware.ts`
- Modify: `src/shared/auth/middleware.test.ts`

**Why:** Even with cookieCache, `getActiveMember()` still hits the DB (~800ms). Within a single page load, 4-5 server functions call `resolveTenantContext` with identical cookies. A short-lived cache deduplicates these calls. The cache is keyed by the raw cookie header, so different users/sessions get different cache entries.

- [ ] **Step 1: Write the failing test for cache hit**

In `src/shared/auth/middleware.test.ts`, add a new `describe` block after the existing `resolveTenantContext` tests:

```typescript
describe('resolveTenantContext cache', () => {
  it('returns cached result on second call with same cookies', async () => {
    // Arrange
    const headers = makeHeaders({ cookie: 'session=abc123' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'admin' })

    // Act — first call
    const ctx1 = await resolveTenantContext(headers)
    // Act — second call with identical cookies
    const headers2 = makeHeaders({ cookie: 'session=abc123' })
    const ctx2 = await resolveTenantContext(headers2)

    // Assert — both return same result
    expect(ctx1).toEqual(ctx2)
    // getActiveMember only called once — second call used cache
    expect(mockGetActiveMember).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache after TTL expires', async () => {
    // Arrange
    vi.useFakeTimers()
    const headers = makeHeaders({ cookie: 'session=xyz' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-2', activeOrganizationId: 'org-2' },
      user: { id: 'u2' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    // Act — first call
    await resolveTenantContext(headers)
    // Advance past TTL
    vi.advanceTimersByTime(6_000)
    // Act — second call should miss cache
    await resolveTenantContext(headers)

    // Assert — getActiveMember called twice
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('does not cache across different cookies', async () => {
    // Arrange
    const headers1 = makeHeaders({ cookie: 'session=aaa' })
    const headers2 = makeHeaders({ cookie: 'session=bbb' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    // Act
    await resolveTenantContext(headers1)
    await resolveTenantContext(headers2)

    // Assert — both calls hit DB
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/shared/auth/middleware.test.ts`
Expected: FAIL — `getActiveMember` is called twice (no caching yet).

- [ ] **Step 3: Implement the TTL cache in middleware.ts**

At the top of `src/shared/auth/middleware.ts` (after the imports, before the tagged errors section), add:

```typescript
// ── Request-scoped tenant cache ───────────────────────────────
// Within a single page load, multiple server functions call resolveTenantContext
// with identical cookies. This cache deduplicates the getActiveMember() DB call.
// Keyed by raw cookie header — different users/sessions get different entries.

const TENANT_CACHE_TTL_MS = 5_000 // 5 seconds — covers a single page load
const tenantCache = new Map<string, { ctx: AuthContext; ts: number }>()

function tenantCacheKey(headers: Headers): string {
  return headers.get('cookie') ?? ''
}

/** Clear the tenant cache. Called at the end of each server function via tracedHandler. */
export function clearTenantCache(): void {
  // Evict expired entries
  const now = Date.now()
  for (const [key, entry] of tenantCache) {
    if (now - entry.ts >= TENANT_CACHE_TTL_MS) {
      tenantCache.delete(key)
    }
  }
}
```

Then modify `resolveTenantContext` (lines 76-99) to use the cache:

```typescript
export async function resolveTenantContext(headers: Headers): Promise<AuthContext> {
  // Check cache first
  const key = tenantCacheKey(headers)
  const cached = tenantCache.get(key)
  if (cached && Date.now() - cached.ts < TENANT_CACHE_TTL_MS) {
    return cached.ctx
  }

  const session = await getSessionFromHeaders(headers)
  if (!session) {
    throwAuthError('unauthorized', 'Valid session required')
  }

  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    throwAuthError('no_active_org', 'No active organization selected')
  }

  // Find the member record for this user in the active org
  const auth = getAuth()
  const member = await auth.api.getActiveMember({ headers })
  if (!member) {
    throwAuthError('forbidden', 'Not a member of the active organization')
  }

  const ctx: AuthContext = {
    userId: userId(session.user.id),
    organizationId: organizationId(activeOrgId),
    role: toDomainRole(member.role),
  }

  tenantCache.set(key, { ctx, ts: Date.now() })
  return ctx
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/shared/auth/middleware.test.ts`
Expected: All tests PASS — including the new cache hit, TTL expiry, and different-cookies tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/auth/middleware.ts src/shared/auth/middleware.test.ts
git commit -m "perf: add TTL cache to resolveTenantContext

Deduplicates getActiveMember() DB calls across parallel server
functions in the same page load. Cache keyed by cookie header
with 5s TTL — covers a single request burst, expires immediately
after."
```

---

### Task 3: Wire clearTenantCache into tracedHandler

**Files:**

- Modify: `src/shared/observability/traced-server-fn.ts`

**Why:** The tenant cache entries expire via TTL, but we also need to proactively evict stale entries. Calling `clearTenantCache()` at the end of each server function ensures expired entries are cleaned up regularly without waiting for the next call.

- [ ] **Step 1: Add clearTenantCache call to tracedHandler**

In `src/shared/observability/traced-server-fn.ts`, add the import at the top:

```typescript
import { clearTenantCache } from '#/shared/auth/middleware'
```

Then modify the handler's try/catch to call `clearTenantCache()` after the span ends. Change the try block from:

```typescript
return runWithContext(requestId, async () => {
  try {
    const result = await fn(ctx)
    span.end()
    return result
  } catch (e) {
    span.end(e)
    // Already a ServerFunctionError (tagged by domain catch block) — just re-throw
    if (e instanceof ServerFunctionError) {
      throw e
    }
    // Untagged error — log full detail and wrap as generic 500
    catchUntagged(e)
  }
}) as Promise<TOutput>
```

to:

```typescript
return runWithContext(requestId, async () => {
  try {
    const result = await fn(ctx)
    span.end()
    clearTenantCache()
    return result
  } catch (e) {
    span.end(e)
    clearTenantCache()
    // Already a ServerFunctionError (tagged by domain catch block) — just re-throw
    if (e instanceof ServerFunctionError) {
      throw e
    }
    // Untagged error — log full detail and wrap as generic 500
    catchUntagged(e)
  }
}) as Promise<TOutput>
```

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run src/shared/observability/ src/shared/auth/`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/observability/traced-server-fn.ts
git commit -m "perf: evict expired tenant cache entries after each server fn

Calls clearTenantCache() at the end of every tracedHandler invocation
to proactively clean up stale entries instead of waiting for the next
resolveTenantContext call."
```

---

### Task 4: Measure the improvement

**Files:** None (manual verification)

**Why:** Confirm the fix works with real logs. Compare before and after.

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

- [ ] **Step 2: Load the dashboard page and check server logs**

Expected improvements:

- `identity.getActiveOrganization` should drop from ~1780ms to ~800ms (only 1 DB call instead of 3)
- `property.listProperties` should drop from ~1924ms to ~200-400ms (auth overhead near-zero thanks to cache)
- `property.getProperty` (if still called) should drop similarly
- Subsequent calls to `resolveTenantContext` within the same page load should show 0ms auth overhead (cache hit)
- Inner spans (`property.list`, `property.findById`) remain at ~137-151ms (DB queries, unchanged)

- [ ] **Step 3: Commit the plan**

(No code changes in this task — verification only.)

---

## Out of Scope (for this plan)

These are real issues but separate from the session caching fix:

1. **`getProperty` mystery** — Something calls `property.getProperty` on dashboard load even though the dashboard only uses `listProperties`. Needs separate investigation (possibly TanStack Router route matching or a component preload).

2. **`beforeLoad` → `loader` waterfall** — TanStack Router forces `beforeLoad` to complete before `loader` starts. The fix would be merging some data fetching into `beforeLoad` or using parallel route loading. This is a routing architecture change, not an auth fix.

3. **`customSession` plugin** — Could enrich the session with org/role data to eliminate `getActiveMember()` entirely. But the docs note that customSession fields are NOT cached by cookieCache, so the callback still runs per-call. Worth investigating after the cookieCache + TTL cache fix is measured.
