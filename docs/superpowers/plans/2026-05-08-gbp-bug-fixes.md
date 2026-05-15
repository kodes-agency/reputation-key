# GBP Integration Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 production bugs in the GBP integration context — URL encoding (#2-3), status granularity (#4), null guard (#5), silent auth failure (#6), swallowed error context (#7), and fragile query filter (#8).

**Architecture:** Each bug is isolated to specific files with no cross-dependencies. Tasks are ordered by severity: URL encoding first (blocks all GBP API calls), then data integrity, then resilience. Each task produces a self-contained commit.

**Tech Stack:** TypeScript, Drizzle ORM, TanStack Start, BullMQ, Google Business Profile API v1

---

## File Structure

| File                                                                                   | Action              | Responsibility                                                         |
| -------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`                  | Modify              | Remove `encodeURIComponent` from resource path construction            |
| `src/contexts/integration/domain/types.ts`                                             | Modify              | Add `completed_with_failures` to `GbpImportJobStatus` union            |
| `src/shared/jobs/handlers/import-property.ts`                                          | Modify              | Fix status logic to distinguish failures from skips                    |
| `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`             | Modify              | Guard `data.scope` against null/undefined                              |
| `src/routes/api/auth/google/callback.ts`                                               | Modify              | Distinguish session expiry from connection failures                    |
| `src/contexts/integration/application/use-cases/list-gbp-locations.ts`                 | Modify              | Only retry wildcard on recoverable errors, propagate token/auth errors |
| `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts` | Modify              | Replace `and(..., undefined)` with explicit conditional query          |
| `src/shared/db/schema/gbp-import-job.schema.ts`                                        | Read-only reference | Verify schema supports new status value                                |

---

### Task 1: Fix URL encoding in GBP API adapter (#2-3)

**Severity:** CRITICAL — all GBP API calls broken in production

The adapter uses `encodeURIComponent` on resource names that already contain path separators (`accounts/123456/locations/789`). This encodes the slashes as `%2F`, producing broken URLs.

**Files:**

- Modify: `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`

- [ ] **Step 1: Fix `listLocations` URL construction (line 53)**

Current:

```typescript
const url = `${GBP_API_BASE}/accounts/${encodeURIComponent(accountName)}/locations?${params.toString()}`
```

Replace with:

```typescript
const url = `${GBP_API_BASE}/accounts/${accountName}/locations?${params.toString()}`
```

Rationale: `accountName` is extracted via `name.split('/')[1]` in `mapGbpAccount` — it's a simple numeric ID like `123456`. No encoding needed. If it contained slashes, encoding would break the path structure.

- [ ] **Step 2: Fix `getLocation` URL construction (line 78)**

Current:

```typescript
const url = `${GBP_API_BASE}/${encodeURIComponent(locationName)}`
```

Replace with:

```typescript
const url = `${GBP_API_BASE}/${locationName}`
```

Rationale: `locationName` is a full resource path like `accounts/123456/locations/789`. Encoding it converts slashes to `%2F`, breaking the URL entirely. The value comes from the GBP API itself and is already a valid path.

- [ ] **Step 3: Fix `batchGetReviews` URL construction (line 99)**

Current:

```typescript
const url = `${GBP_API_BASE}/accounts/${encodeURIComponent(accountName)}/locations:batchGetReviews`
```

Replace with:

```typescript
const url = `${GBP_API_BASE}/accounts/${accountName}/locations:batchGetReviews`
```

Rationale: Same as `listLocations` — `accountName` is a numeric ID, encoding is unnecessary and would break if it ever contained slashes.

- [ ] **Step 4: Verify build**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts
git commit -m "fix(gbp): remove encodeURIComponent from resource path segments

encodeURIComponent on resource names like accounts/123456/locations/789
encodes slashes as %2F, breaking all GBP API calls. Resource names from
the GBP API are already valid URL path segments and must not be encoded."
```

---

### Task 2: Add null guard for OAuth scope (#5)

**Severity:** HIGH — unhandled TypeError when Google omits `scope` in token response

**Files:**

- Modify: `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`

- [ ] **Step 1: Guard `data.scope` in `exchangeCode` (line 50)**

Current:

```typescript
const scopes = (data.scope as string).split(' ')
```

Replace with:

```typescript
const scopes =
  typeof data.scope === 'string' && data.scope.length > 0 ? data.scope.split(' ') : []
```

Rationale: Google can omit the `scope` field from token responses when the granted scopes match the requested scopes. The `as string` cast masks the `undefined` case, causing `TypeError: Cannot read properties of undefined (reading 'split')`.

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts
git commit -m "fix(oauth): guard data.scope against undefined in token response

Google omits the scope field when granted scopes match requested scopes.
The unchecked cast to string caused a TypeError crash during OAuth callback."
```

---

### Task 3: Add `completed_with_failures` status (#4)

**Severity:** HIGH — conflates real failures with duplicate skips, masking data integrity issues

**Files:**

- Modify: `src/contexts/integration/domain/types.ts`
- Modify: `src/shared/jobs/handlers/import-property.ts`

- [ ] **Step 1: Add new status to domain type**

In `src/contexts/integration/domain/types.ts`, change the `GbpImportJobStatus` union (line 46-51):

Current:

```typescript
export type GbpImportJobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'completed_with_skips'
```

Replace with:

```typescript
export type GbpImportJobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'completed_with_skips'
  | 'completed_with_failures'
```

- [ ] **Step 2: Fix status determination logic in import handler**

In `src/shared/jobs/handlers/import-property.ts`, replace the `finalStatus` logic (lines 182-192):

Current:

```typescript
const finalStatus = !jobRow
  ? 'failed'
  : jobRow.totalCount === 0
    ? 'failed'
    : jobRow.failedCount >= jobRow.totalCount
      ? 'failed'
      : jobRow.importedCount === 0 && jobRow.skippedCount === jobRow.totalCount
        ? 'completed_with_skips'
        : jobRow.skippedCount > 0 || jobRow.failedCount > 0
          ? 'completed_with_skips'
          : 'completed'
```

Replace with:

```typescript
const finalStatus = !jobRow
  ? 'failed'
  : jobRow.totalCount === 0
    ? 'failed'
    : jobRow.failedCount >= jobRow.totalCount
      ? 'failed'
      : jobRow.failedCount > 0
        ? 'completed_with_failures'
        : jobRow.skippedCount > 0
          ? 'completed_with_skips'
          : 'completed'
```

Logic breakdown:

1. No row or zero total → `failed`
2. All items failed → `failed`
3. Some failures (even with successful imports) → `completed_with_failures` (NEW)
4. Only skips, no failures → `completed_with_skips`
5. Everything imported → `completed`

- [ ] **Step 3: Verify the schema supports the new value**

Run: `grep -n 'status' src/shared/db/schema/gbp-import-job.schema.ts`

The `status` column should be a `varchar` or `text` — not an enum constrained to specific values. If it's a `varchar`/`text`, the new status string works with no migration needed.

- [ ] **Step 4: Verify build**

Run: `pnpm tsc --noEmit`
Expected: No type errors (the exhaustive match in `integrationErrorStatus` and any `ts-pattern` matches on status may need updating — check for compile errors referencing `GbpImportJobStatus`)

- [ ] **Step 5: Update any UI or server-side status consumers**

Search for consumers of `completed_with_skips` that may need to handle the new status:

Run: `grep -rn 'completed_with_skips\|GbpImportJobStatus' src/ --include='*.ts' --include='*.tsx'`

For each result:

- Frontend status display: add a case for `completed_with_failures` (likely shows a warning/different color than skips)
- The frontend component in `src/routes/_authenticated/properties/import.tsx` or similar — add handling for `completed_with_failures` alongside `completed_with_skips`

- [ ] **Step 6: Commit**

```bash
git add src/contexts/integration/domain/types.ts src/shared/jobs/handlers/import-property.ts
git commit -m "fix(import): distinguish failures from skips in import job status

Add completed_with_failures status for jobs where some locations failed
but others succeeded. Previously both failures and skips produced
completed_with_skips, masking real import errors."
```

---

### Task 4: Distinguish session expiry in OAuth callback (#6)

**Severity:** MEDIUM — silent auth failures make debugging harder

The OAuth callback's catch block redirects all errors to `?error=connection_failed`, losing the distinction between "session expired mid-OAuth" and actual connection failures.

**Files:**

- Modify: `src/routes/api/auth/google/callback.ts`

- [ ] **Step 1: Add specific handling for session expiry in catch block (lines 157-166)**

Current:

```typescript
        } catch (e) {
          const logger = getLogger()
          logger.error({ err: e }, 'Google OAuth connection failed')
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${env.BETTER_AUTH_URL}/properties/import?error=connection_failed`,
            },
          })
        }
```

Replace with:

```typescript
        } catch (e) {
          const logger = getLogger()
          logger.error({ err: e }, 'Google OAuth connection failed')

          const isSessionError =
            e instanceof Error &&
            '_tag' in e &&
            (e as { _tag: string })._tag === 'AuthError' &&
            'code' in e &&
            ((e as { code: string }).code === 'session_expired' ||
              (e as { code: string }).code === 'unauthorized')

          const errorParam = isSessionError ? 'session_expired' : 'connection_failed'

          return new Response(null, {
            status: 302,
            headers: {
              Location: `${env.BETTER_AUTH_URL}/properties/import?error=${errorParam}`,
            },
          })
        }
```

Rationale: When `resolveTenantContext` throws an `AuthError` with code `session_expired` or `unauthorized`, the user needs a different message ("Your session expired, please log in again") vs a generic connection failure. The frontend already handles `error=session_expired` differently from `error=connection_failed`.

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/auth/google/callback.ts
git commit -m "fix(oauth): distinguish session expiry from connection failures

The OAuth callback was redirecting all errors to connection_failed,
including session_expired. This made it impossible to diagnose expired
sessions vs real Google connection issues."
```

---

### Task 5: Stop swallowing errors in list-gbp-locations (#7)

**Severity:** MEDIUM — retrying wildcard on invalid-token errors loses the real failure reason

The catch block retries with wildcard (`-`) on ALL errors, including auth errors where the wildcard will also fail.

**Files:**

- Modify: `src/contexts/integration/application/use-cases/list-gbp-locations.ts`

- [ ] **Step 1: Replace blanket catch with selective retry (lines 71-89)**

Current:

```typescript
// 5. Try to list locations from available GBP accounts, fall back to wildcard
let locations: ReadonlyArray<GbpLocation>

try {
  // Try to get accounts first - this handles setups with named accounts
  const accounts = await deps.gbpApi.listAccounts(accessToken)

  if (accounts.length > 0) {
    // Use the first available account (most users have one main account)
    const firstAccount = accounts[0]
    locations = await deps.gbpApi.listLocations(accessToken, firstAccount.accountName)
  } else {
    // Fall back to wildcard if no accounts found
    locations = await deps.gbpApi.listLocations(accessToken, '-')
  }
} catch {
  // Fall back to wildcard on any error (e.g., permissions, API changes)
  locations = await deps.gbpApi.listLocations(accessToken, '-')
}
```

Replace with:

```typescript
// 5. Try to list locations from available GBP accounts, fall back to wildcard
//    Only retry on permission/account-scope errors — propagate auth and rate-limit errors.
const isRetryableError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return true
  const msg = err.message.toLowerCase()
  // Token/auth errors — do NOT retry
  if (msg.includes('401') || msg.includes('403')) return false
  // Rate limiting — do NOT retry
  if (msg.includes('429')) return false
  // Permission/account-scope errors — retry with wildcard
  return true
}

let locations: ReadonlyArray<GbpLocation>

try {
  const accounts = await deps.gbpApi.listAccounts(accessToken)

  if (accounts.length > 0) {
    const firstAccount = accounts[0]
    locations = await deps.gbpApi.listLocations(accessToken, firstAccount.accountName)
  } else {
    locations = await deps.gbpApi.listLocations(accessToken, '-')
  }
} catch (err) {
  if (!isRetryableError(err)) throw err

  const logger = getLogger()
  logger.warn({ err }, 'GBP account-scoped listing failed, retrying with wildcard')

  locations = await deps.gbpApi.listLocations(accessToken, '-')
}
```

Note: Add `import { getLogger } from '#/shared/observability/logger'` to the imports at the top of the file if not already present.

Rationale: 401 (invalid token), 403 (forbidden), and 429 (rate limited) errors will also fail on the wildcard retry. Propagating them immediately preserves the original error context and avoids a wasted API call.

- [ ] **Step 2: Add the logger import**

Check if `getLogger` is already imported in the file. If not, add to the import section:

```typescript
import { getLogger } from '#/shared/observability/logger'
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/contexts/integration/application/use-cases/list-gbp-locations.ts
git commit -m "fix(gbp): only retry wildcard on recoverable errors

The blanket catch-and-retry masked auth errors (401/403) and rate limits
(429). Now only retries on permission/account-scope errors where the
wildcard fallback has a chance of succeeding."
```

---

### Task 6: Fix fragile Drizzle query filter (#8)

**Severity:** LOW — works today but relies on implicit Drizzle behavior

Passing `undefined` into `and()` works but is not a documented contract. If Drizzle changes this behavior, the admin view breaks silently.

**Files:**

- Modify: `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts`

- [ ] **Step 1: Replace `and(..., undefined)` with conditional query (lines 48-68)**

Current:

```typescript
  listByOrganization: async (orgId, userId, role) => {
    return trace('googleConnection.listByOrganization', async () => {
      const isAdminOrOwner = hasRole(role, 'AccountAdmin')

      const visibilityFilter = isAdminOrOwner
        ? // Admins/owners see ALL connections (both organization and private)
          undefined // No visibility filter needed for admins
        : // Non-admins see organization connections + only their own private connections
          or(
            eq(googleConnections.visibility, 'organization'),
            eq(googleConnections.connectedBy, userId),
          )

      const rows = await db
        .select()
        .from(googleConnections)
        .where(
          and(eq(googleConnections.organizationId, orgId), visibilityFilter),
        )
      return rows.map(googleConnectionFromRow)
    })
  },
```

Replace with:

```typescript
  listByOrganization: async (orgId, userId, role) => {
    return trace('googleConnection.listByOrganization', async () => {
      const isAdminOrOwner = hasRole(role, 'AccountAdmin')

      const whereClause = isAdminOrOwner
        ? eq(googleConnections.organizationId, orgId)
        : and(
            eq(googleConnections.organizationId, orgId),
            or(
              eq(googleConnections.visibility, 'organization'),
              eq(googleConnections.connectedBy, userId),
            ),
          )

      const rows = await db
        .select()
        .from(googleConnections)
        .where(whereClause)
      return rows.map(googleConnectionFromRow)
    })
  },
```

Rationale: `eq()` returns a valid SQL condition by itself — no need to wrap it in `and()` with `undefined`. For non-admins, `and()` receives two valid conditions. No implicit `undefined` handling required.

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/contexts/integration/infrastructure/repositories/google-connection.repository.ts
git commit -m "fix(query): remove implicit undefined from Drizzle and() filter

Passing undefined into and() works but is an implicit contract with
Drizzle. Use conditional query construction instead — admins get a simple
eq() filter, non-admins get and(eq(), or(...))."
```

---

## Self-Review

### 1. Spec Coverage

| Bug                        | Task   | Covered?                                |
| -------------------------- | ------ | --------------------------------------- |
| #2-3 URL encoding          | Task 1 | Yes — all three URL constructions fixed |
| #5 Null guard              | Task 2 | Yes — scope guard added                 |
| #4 Status granularity      | Task 3 | Yes — new status + logic fix            |
| #6 Silent auth failure     | Task 4 | Yes — session expiry detection          |
| #7 Swallowed error context | Task 5 | Yes — selective retry                   |
| #8 Fragile query filter    | Task 6 | Yes — conditional query                 |

### 2. Placeholder Scan

No TBD, TODO, or placeholder patterns found. Every step contains exact code and commands.

### 3. Type Consistency

- `GbpImportJobStatus` union extended in `types.ts` (Task 3, Step 1) — the new value `completed_with_failures` is used in `import-property.ts` (Task 3, Step 2). All existing exhaustive checks on this union will surface as compile errors and must be updated in Step 5.
- `isRetryableError` in Task 5 is a local function — no cross-file type dependencies.
- `AuthError` tag check in Task 4 uses the `_tag` and `code` fields already defined in `middleware.ts`.

### 4. Schema Compatibility Note

The `gbp-import-job.schema.ts` status column must be a `varchar`/`text` type (not a DB-level enum) for the new `completed_with_failures` value to work without a migration. Verify in Task 3, Step 3.
