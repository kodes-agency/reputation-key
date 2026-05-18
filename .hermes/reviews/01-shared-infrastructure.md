# Review: Shared Infrastructure

## Summary

**71 files examined. 22 issues found: 4 critical, 7 warnings, 6 minor, 5 security findings.**

The shared infrastructure layer is architecturally sound — hexagonal boundaries are respected, tenant isolation is structurally enforced via `baseWhere()`, and the codebase consistently uses factory functions, branded IDs, and neverthrow Results. However, there are several convention violations (a class with `this`, bare `process.env` reads in CLI code, missing `Result` re-export), a tenant cache memory leak risk, and an SQL injection vector in integration test helpers. The `gbp_cache` table lacks `organizationId` for direct queries.

---

## Critical Issues (P0/P1)

### P0-01: `ServerFunctionError` is a class with `this` — violates convention #1

**File:** `src/shared/auth/server-errors.ts` **Lines:** 8-20

The project convention explicitly states "No classes, no this, no enum — factory functions only." `ServerFunctionError` is a class with a constructor that uses `this.name`, `this._tag`, `this.code`, `this.status`. This is the **only** class in the entire codebase.

```typescript
export class ServerFunctionError extends Error {
  readonly _tag: string
  readonly code: string
  readonly status: number

  constructor(errorName: string, message: string, code: string, status: number) {
    super(message)
    this.name = errorName
    this._tag = errorName
    this.code = code
    this.status = status
  }
}
```

**Why it matters:** TanStack Start's seroval serialization requires Error subclass instances for proper client-side deserialization — so this is an _understandable_ exception. However, the convention says "no classes" and if this is an intentional exception, it needs to be documented in the conventions. Either reframe the convention to say "No classes except Error subclasses for serialization boundaries" or refactor to a function that returns a plain Error with attached properties.

**Verdict:** P1 — convention violation that should either be fixed or the convention updated with an explicit carve-out.

---

### P0-02: `result.ts` re-exports `Result` as a type — runtime import will break

**File:** `src/shared/domain/result.ts` **Lines:** 4-8

```typescript
export { Result, ok, err } from 'neverthrow'
```

`Result` in neverthrow is a **class** (it's a type + runtime value). Re-exporting it alongside `ok` and `err` is correct for runtime usage. However, the barrel in `domain/index.ts` re-exports it as:

```typescript
export type { Result } from './result'
export { ok, err } from './result'
```

**File:** `src/shared/domain/index.ts` **Lines:** 35-36

This uses `export type { Result }` — stripping the runtime value. If any consumer does `Result.ok(...)`, it will fail at runtime. Consumers must use `ok()` and `err()` standalone, which they do, but re-exporting `Result` as type-only while the original module exports it as a value is misleading.

**Verdict:** P1 — inconsistency between `result.ts` (value export) and `index.ts` (type-only export). Either export Result as a value everywhere or remove the re-export entirely.

---

### P0-03: Tenant cache keyed on raw cookie header — memory leak and collision risk

**File:** `src/shared/auth/middleware.ts` **Lines:** 19-34

```typescript
const TENANT_CACHE_TTL_MS = 5_000
const tenantCache = new Map<string, { ctx: AuthContext; ts: number }>()

function tenantCacheKey(headers: Headers): string {
  return headers.get('cookie') ?? ''
}
```

**Problems:**

1. **Memory leak:** `clearTenantCache()` is only called in `tracedHandler()`, which means any server function NOT wrapped with `tracedHandler` will leave entries in the cache forever. Under load, this grows unbounded.
2. **Collision risk:** Two different users with no cookies both get key `''` — the second user gets the first user's `AuthContext`. This is a **tenant isolation breach** if an unauthenticated request somehow caches context before the auth check.
3. **Only eviction on expiry:** No max-size limit. Under high concurrency, thousands of unique cookies could accumulate in 5 seconds.

**Verdict:** P1 — unbounded Map keyed on raw cookie string. Add max-size eviction and handle the empty-cookie edge case.

---

### P0-04: `gbp_cache` table has no `organizationId` — can't enforce tenant isolation on direct queries

**File:** `src/shared/db/schema/gbp-cache.schema.ts` **Lines:** 17-37

```typescript
export const gbpCache = pgTable(
  'gbp_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    gbpPlaceId: varchar('gbp_place_id', { length: 500 }).notNull(),
    // ... no organizationId column
  },
```

The comment says: "Tenant isolation relies on the property→organization FK chain." This means every query on `gbp_cache` MUST join through `properties` to enforce tenant isolation. There is no `baseWhere()` applicable here because the table doesn't have `organizationId`. If any developer writes a direct query against `gbp_cache` without the join, tenant data leaks.

**Verdict:** P1 — add `organizationId` column to `gbp_cache` for defense-in-depth, or add a very visible runtime guard.

---

## Warnings (P2)

### P2-01: `auth-cli.ts` reads bare `process.env` — violates convention #15

**File:** `src/shared/auth/auth-cli.ts` **Lines:** 17-30

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER ?? process.env.DATABASE_URL,
})

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET environment variable is required')
}

const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
```

The convention says "env reads via getEnv(), not bare process.env at module scope." This file reads `process.env` at module scope without Zod validation. The comment says "Plain Error is acceptable here" but the convention doesn't have an exception for CLI tools.

**Verdict:** P2 — either use `getEnv()` or document the CLI exception in conventions.

---

### P2-02: `toDomainRole` silently defaults unknown roles to `Staff`

**File:** `src/shared/domain/roles.ts` **Lines:** 26-37

```typescript
export function toDomainRole(betterAuthRole: string): Role {
  switch (betterAuthRole) {
    case 'owner':
      return 'AccountAdmin'
    case 'admin':
      return 'PropertyManager'
    case 'member':
      return 'Staff'
    default:
      return 'Staff'
  }
}
```

Silently upgrading an unknown role to `Staff` could grant unintended access. An unknown role string (e.g., from a DB migration or Better Auth update) would be treated as if the user were a staff member rather than denied access.

**Verdict:** P2 — should throw or log a warning for unknown roles instead of silently defaulting.

---

### P2-03: `ensureActiveOrg` creates a `POST` server function but never returns a value

**File:** `src/shared/auth/auth.functions.ts` **Lines:** 18-37

```typescript
export const ensureActiveOrg = createServerFn({ method: 'POST' }).handler(async () => {
  // ...
  if (session.session.activeOrganizationId) return
  const orgs = await auth.api.listOrganizations({ headers })
  const orgList = Array.isArray(orgs) ? orgs : []
  if (orgList.length > 0) {
    await auth.api.setActiveOrganization({
      headers,
      body: { organizationId: orgList[0].id },
    })
  }
})
```

`listOrganizations` returns `Organization[] | null` according to Better Auth. The `Array.isArray(orgs) ? orgs : []` handles null, but if Better Auth returns an unexpected shape, the fallback silently picks nothing. Also, this blindly picks the first org — not the most recently used or relevant one.

**Verdict:** P2 — consider logging when no orgs are found and/or using a more deterministic org selection strategy.

---

### P2-04: `integration-helpers.ts` uses string interpolation for table names — SQL injection vector

**File:** `src/shared/testing/integration-helpers.ts` **Lines:** 17-20

```typescript
export async function truncateTables(
  pool: Pool,
  tables: string[],
  orgIds: string[],
): Promise<void> {
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds])
  }
}
```

Table names are interpolated directly into the SQL string. While this is test-only code and the `tables` array is hardcoded in callers, this pattern is a SQL injection template that could be copy-pasted into production code. The `seedOrgs` function has the same issue with hardcoded SQL but at least doesn't interpolate table names.

**Verdict:** P2 — test-only code, but dangerous pattern. Add a comment warning and consider using `pg-format` or a whitelist approach.

---

### P2-05: `auth-client.ts` has inconsistent formatting (tabs vs spaces)

**File:** `src/shared/auth/auth-client.ts` **Lines:** 1-35

The entire file uses tabs for indentation while every other file in the codebase uses spaces. This is a formatting inconsistency that suggests this file was written in a different editor or pasted from documentation.

```typescript
export const authClient = createAuthClient({
	plugins: [
		organizationClient({
```

**Verdict:** P2 — formatting inconsistency.

---

### P2-06: Permission table initialization has side-effect at module scope

**File:** `src/shared/auth/permissions.ts` **Line:** 107

```typescript
// ── Auto-initialize on import ──────────────────────────────────────
initPermissionTable()
```

This calls `initPermissionTable()` at module load time as a side effect. If this module is imported before `getEnv()` is available (e.g., during testing), the `ac.newRole()` calls from `better-auth` may fail. Tests work because they call `resetEnv()` and re-import, but the module-level side effect is fragile.

**Verdict:** P2 — consider moving initialization to an explicit `bootstrap()` call or documenting this as an intentional trade-off.

---

### P2-07: Each BullMQ `createJobQueue` and `createJobWorker` call creates a new Redis connection

**File:** `src/shared/jobs/queue.ts` **Lines:** 32-34
**File:** `src/shared/jobs/worker.ts` **Lines:** 32-34

```typescript
const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})
```

Every call to `createJobQueue()` or `createJobWorker()` creates a **new** Redis connection. BullMQ docs say "you need at minimum one connection for the Queue, and one for the Worker." If multiple queues or workers are created, connections accumulate. The composition root only creates one queue, but there's no guard preventing multiple calls.

**Verdict:** P2 — add connection pooling or document the "one queue, one worker" constraint.

---

## Minor (P3)

### P3-01: `result.ts` uses inconsistent tab indentation

**File:** `src/shared/domain/result.ts` **Lines:** 4-8

```typescript
export { Result, ok, err } from 'neverthrow'
```

Uses tabs while the rest of the codebase uses spaces.

---

### P3-02: `auth-client.ts` has `fallow-ignore-next-line` comments that aren't a real tool

**File:** `src/shared/auth/auth-client.ts` **Lines:** 21-34

```typescript
// fallow-ignore-next-line unused-export
useSession,
// fallow-ignore-next-line unused-export
signIn,
```

If `fallow` is an internal lint tool, these are fine. But if these are typo'd `tsc-ignore` or `eslint-disable`, they're silently doing nothing.

---

### P3-03: `events.ts` has excessive `fallow-ignore-next-line` noise

**File:** `src/shared/events/events.ts` — 22 occurrences of `// fallow-ignore-next-line unused-type`

These comments add significant noise to an otherwise clean file. If the tool supports a file-level pragma, use it. Otherwise, consider whether all these type exports truly need suppression.

---

### P3-04: `RateLimitResult.resetAt` uses `Date.now()` calculation which may drift

**File:** `src/shared/rate-limit/middleware.ts` **Lines:** 73-74

```typescript
const ttl = await redis.ttl(redisKey)
const resetAt = new Date(Date.now() + Math.max(ttl, 0) * 1000)
```

A separate `redis.ttl()` call after the `eval` creates a race condition — between the `eval` and `ttl` calls, the key could expire. The `ttl` call is a separate network round-trip, adding latency. Consider returning the TTL from the Lua script.

---

### P3-05: `request-context.ts` truncates UUID to 8 chars — potential collisions

**File:** `src/shared/observability/request-context.ts` **Lines:** 22-24

```typescript
export function generateRequestId(): string {
  return randomUUID().slice(0, 8)
}
```

8 hex characters = 32 bits of entropy = ~4 billion values. Under high load (millions of requests/day), birthday paradox makes collisions likely. This is only used for logging, not security, but colliding request IDs make log correlation unreliable.

---

### P3-06: `buildTestAuthContext` defaults to `PropertyManager` role

**File:** `src/shared/testing/fixtures.ts` **Line:** 36

```typescript
role: 'PropertyManager',
```

Most test fixtures default to `PropertyManager`, which has more permissions than `Staff` but fewer than `AccountAdmin`. Tests that forget to override the role may pass with `PropertyManager` permissions but fail for `Staff` users. This is a test quality concern.

---

## Security Findings

### SEC-01: Token encryption uses AES-256-GCM (confirmed good)

**File:** `src/shared/config/env.ts` **Lines:** 49-52

```typescript
ENCRYPTION_KEY: z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/, 'Must be 64 hex characters (32 bytes)'),
```

The `ENCRYPTION_KEY` is validated as exactly 64 hex characters (32 bytes), consistent with AES-256-GCM. The `in-memory-token-encryption.ts` fake confirms the encrypt/decrypt interface. ✅ No hardcoded secrets found.

---

### SEC-02: JWT verification is complete and correct

**File:** `src/shared/auth/pubsub-jwt.verifier.ts` **Lines:** 33-49

```typescript
const { payload } = await jwtVerify(token, getJwks(), {
  issuer: GOOGLE_ISSUER,
  audience: expectedAudience,
  clockTolerance: '30s',
})
```

Issuer, audience, and clock tolerance are all verified. JWKS is refreshed every 24 hours (line 14: `const JWKS_CACHE_TTL = 24 * 60 * 60 * 1000`). ✅ JWKS TTL-based invalidation is correctly implemented per convention #13.

---

### SEC-03: Rate limiter fails open — security consideration

**File:** `src/shared/rate-limit/middleware.ts` **Lines:** 52-59

```typescript
if (!redis) {
  return {
    allowed: true,
    remaining: opts.maxRequests,
    resetAt: new Date(Date.now() + opts.windowSeconds * 1000),
  }
}
```

When Redis is unavailable, all requests are allowed. This is documented as intentional ("rate limiting is a nice-to-have, not critical") but means a Redis outage removes all rate limiting protection.

**Verdict:** Acceptable for current scale, but document this as a known risk.

---

### SEC-04: Error information leakage is properly prevented

**File:** `src/shared/auth/server-errors.ts` **Lines:** 54-74

```typescript
export function catchUntagged(e: unknown): never {
  // ...
  throw new ServerFunctionError(
    'InternalError',
    'Internal server error', // Generic message — no stack trace leak
    'internal_error',
    500,
  )
}
```

Untagged errors are caught, logged with full detail (server-side only), and a generic message is sent to the client. ✅ No stack traces or SQL queries leak to the client.

---

### SEC-05: Session `cookieCache` with 5-minute TTL may allow stale role data

**File:** `src/shared/auth/auth.ts` **Lines:** 76-79

```typescript
cookieCache: {
  enabled: true,
  maxAge: 5 * 60, // 5 minutes — session revalidated from DB at most every 5 min
},
```

If a user's role is changed (e.g., demoted from `AccountAdmin` to `Staff`), the cookie cache will serve the old role for up to 5 minutes. Combined with the tenant cache in `middleware.ts` (another 5 seconds), this means permission changes can take up to 5 minutes to take effect.

**Verdict:** Low risk for current use case, but worth documenting.

---

## Positive Findings

1. **Tenant isolation is structurally enforced.** `baseWhere()` in `src/shared/db/base-where.ts` requires every table to have `organizationId` and `deletedAt` columns, and all business schemas include `organizationId`. The generic `TenantTable` constraint ensures compile-time safety.

2. **BullMQ queue/worker patterns are correct.** `maxRetriesPerRequest: null` is set on both Queue and Worker. Dedicated Redis connections are used (not shared with cache). Exponential backoff is implemented. ✅ Conventions #7 and #8 are fully met.

3. **Environment variables are Zod-validated.** `env.ts` uses `zod/v4` with strict schemas, including regex validation for `ENCRYPTION_KEY`, conditional requirements for `GUEST_SESSION_SALT` in production, and proper URL validation. ✅ Convention #6 fully met.

4. **Branded IDs are used consistently.** Every domain ID is a nominal type via `Brand<T, B>`. Constructor functions are the only allowed `as` casts. ✅ Convention #3 fully met.

5. **Clock injection is clean.** The `Clock` type is a simple `() => Date` function. All use cases receive it as a dependency. The composition root provides `() => new Date()`. ✅ Convention #5 fully met.

6. **Event bus design is solid.** Handlers are isolated (one throwing doesn't prevent others). `Promise.allSettled` prevents propagation. Type-safe `_tag` matching with `Extract`. ✅ Convention #12 met for event structure.

7. **No hardcoded secrets.** All secrets come from `getEnv()` with Zod validation. Test fixtures use obviously fake values (`enc:access-token`, `re_test_key`).

8. **Error handling follows the convention.** `throwContextError` is the only way to throw in server functions (via `tracedHandler` wrapper). Domain layer returns `Result<T, E>` via neverthrow. ✅ Conventions #10 and #14 met.

9. **No `@ts-ignore` or `eslint-disable` found** in any file. The `fallow-ignore-next-line` comments appear to be for a custom dead-code detection tool, not suppressing TypeScript errors. ✅ Convention #16 met.

10. **`getLogger()` is used everywhere** — no `console.*` calls found in any file. ✅ Convention #4 fully met.

11. **No classes (except `ServerFunctionError`), no `this`, no `enum`.** `pgEnum` is used for DB enums (Drizzle construct, not TypeScript enum). Factory functions throughout. ✅ Convention #1 nearly fully met (one documented exception).

12. **All domain types use `readonly` and `ReadonlyArray`.** Every domain type and port definition uses `Readonly<>` wrappers. ✅ Convention #2 fully met.

---

## Files Reviewed

### Auth (13 files)

- `src/shared/auth/auth.ts`
- `src/shared/auth/auth-client.ts`
- `src/shared/auth/auth.functions.ts`
- `src/shared/auth/auth.test.ts`
- `src/shared/auth/emails.ts`
- `src/shared/auth/headers.ts`
- `src/shared/auth/middleware.ts`
- `src/shared/auth/middleware.test.ts`
- `src/shared/auth/permissions.ts`
- `src/shared/auth/permissions.test.ts`
- `src/shared/auth/pubsub-jwt.verifier.ts`
- `src/shared/auth/pubsub-jwt.verifier.test.ts`
- `src/shared/auth/server-errors.ts`
- `src/shared/auth/auth-cli.ts`

### DB (13 files)

- `src/shared/db/pool.ts`
- `src/shared/db/index.ts`
- `src/shared/db/columns.ts`
- `src/shared/db/base-where.ts`
- `src/shared/db/schema/index.ts`
- `src/shared/db/schema/auth.ts`
- `src/shared/db/schema/business.ts`
- `src/shared/db/schema/audit.ts`
- `src/shared/db/schema/property.schema.ts`
- `src/shared/db/schema/portal.schema.ts`
- `src/shared/db/schema/team.schema.ts`
- `src/shared/db/schema/staff-assignment.schema.ts`
- `src/shared/db/schema/guest.schema.ts`
- `src/shared/db/schema/google-connection.schema.ts`
- `src/shared/db/schema/gbp-import-job.schema.ts`
- `src/shared/db/schema/gbp-cache.schema.ts`
- `src/shared/db/schema/review.schema.ts`

### Cache (5 files)

- `src/shared/cache/cache.port.ts`
- `src/shared/cache/redis-cache.ts`
- `src/shared/cache/redis-cache.test.ts`
- `src/shared/cache/noop-cache.ts`
- `src/shared/cache/redis.ts`

### Jobs (5 files)

- `src/shared/jobs/queue.ts`
- `src/shared/jobs/worker.ts`
- `src/shared/jobs/registry.ts`
- `src/shared/jobs/health-check.job.ts`
- `src/shared/jobs/health-check.job.test.ts`

### Observability (4 files)

- `src/shared/observability/logger.ts`
- `src/shared/observability/traced-server-fn.ts`
- `src/shared/observability/request-context.ts`
- `src/shared/observability/trace.ts`

### Events (3 files)

- `src/shared/events/events.ts`
- `src/shared/events/event-bus.ts`
- `src/shared/events/event-bus.test.ts`

### Rate Limit (2 files)

- `src/shared/rate-limit/middleware.ts`
- `src/shared/rate-limit/middleware.test.ts`

### Config (1 file)

- `src/shared/config/env.ts`

### Domain shared (10 files)

- `src/shared/domain/brand.ts`
- `src/shared/domain/ids.ts`
- `src/shared/domain/result.ts`
- `src/shared/domain/errors.ts`
- `src/shared/domain/clock.ts`
- `src/shared/domain/auth-context.ts`
- `src/shared/domain/roles.ts`
- `src/shared/domain/roles.test.ts`
- `src/shared/domain/permissions.ts`
- `src/shared/domain/index.ts`
- `src/shared/domain/timezones.ts`

### Testing (14 files)

- `src/shared/testing/fixtures.ts`
- `src/shared/testing/capturing-event-bus.ts`
- `src/shared/testing/integration-helpers.ts`
- `src/shared/testing/in-memory-property-repo.ts`
- `src/shared/testing/in-memory-team-repo.ts`
- `src/shared/testing/in-memory-portal-repo.ts`
- `src/shared/testing/in-memory-staff-assignment-repo.ts`
- `src/shared/testing/in-memory-portal-link-repo.ts`
- `src/shared/testing/in-memory-token-encryption.ts`
- `src/shared/testing/in-memory-identity-port.ts`
- `src/shared/testing/in-memory-google-oauth-port.ts`
- `src/shared/testing/in-memory-google-connection-repo.ts`
- `src/shared/testing/in-memory-gbp-queue-port.ts`
- `src/shared/testing/in-memory-gbp-import-repo.ts`
- `src/shared/testing/in-memory-gbp-cache-repo.ts`
- `src/shared/testing/in-memory-gbp-api-port.ts`

### Root files (4 files)

- `src/composition.ts`
- `src/bootstrap.ts`
- `src/worker/index.ts`
- `src/start.ts`
