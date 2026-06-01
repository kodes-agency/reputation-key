# Tenant Separation & Security Audit

**Project:** reputation-key/tashkent
**Date:** 2025-06-01
**Scope:** Full codebase — 12 bounded contexts, shared infrastructure, worker, routes
**Methodology:** Automated agent audit reading ~120+ source files across repositories, server functions, event handlers, jobs, adapters, schemas, auth middleware, and external boundaries

---

## Executive Summary

**Tenant Separation: PASS with minor gaps** — The codebase implements multi-tenant isolation correctly and consistently. `organization_id` filtering is applied via `baseWhere()` helper, direct `eq(table.organizationId, orgId)`, or capability-token patterns (UUIDs for public flows). No cross-tenant data leakage vectors were identified.

**Security: PASS with recommendations** — Authentication, authorization, cryptography, and external boundary handling are all solid. The main gaps are defense-in-depth items (rate limiting scope, error detail exposure, schema hardening) rather than exploitable vulnerabilities.

---

## Part 1: Tenant Separation Audit

### Architecture Review

The multi-tenant model uses `organization_id` as the tenant boundary. Every authenticated request resolves `organizationId` from the Better Auth session via `resolveTenantContext(headers)`, which:

1. Calls `getSessionFromHeaders(headers)` → Better Auth session
2. Extracts `activeOrganizationId` from session
3. Calls `getActiveMember()` to verify membership and get role
4. Returns `AuthContext { userId, organizationId, role }`

This context is then threaded through every use case and repository call.

### 1.1 Repository Layer — Organization Filtering

**Pattern:** Two mechanisms enforce tenant isolation at the DB level:

1. **`baseWhere(table, orgId)`** — Returns `[eq(table.organizationId, orgId), isNull(table.deletedAt)]`. Used by property, portal, portal-group, portal-link, team repositories.

2. **Manual `eq(table.organizationId, orgId)`** — Used by review, reply, inbox, inbox-note, google-connection, metric, guest-interaction, dashboard, staff-assignment, gbp-cache, gbp-import repositories.

**Verification Results:**

| Repository                      | Org Filtering           | Notes                                                                               |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| property.repository.ts          | ✅ `baseWhere` + manual | `findByGbpPlaceId`/`findBySlug` intentionally unscoped (public/system queries)      |
| portal.repository.ts            | ✅ `baseWhere`          | `resolvePortalContext` unscoped (UUID capability token)                             |
| portal-group.repository.ts      | ✅ `baseWhere`          | ⚠️ **update()** filters by ID only (see TS-001)                                     |
| portal-link.repository.ts       | ✅ manual               | All queries org-scoped                                                              |
| link-resolver.repository.ts     | ✅ by design            | Public API — UUID as capability token, documented                                   |
| review.repository.ts            | ✅ manual               | `findAllExpiringBefore`/`findAllExpiredBefore` intentionally unscoped (system jobs) |
| reply.repository.ts             | ✅ manual               | All queries dual-filtered (id + orgId)                                              |
| inbox.repository.ts             | ✅ manual               | All 8+ query methods include `eq(inboxItems.organizationId, orgId)`                 |
| inbox-note.repository.ts        | ✅ manual               | `findByInboxItemId` dual-filters; `create` relies on use-case verification          |
| google-connection.repository.ts | ✅ manual               | All queries org-scoped, visibility-aware                                            |
| metric.repository.ts            | ✅ manual               | All queries include org filter                                                      |
| goal.repository.ts              | ✅ manual               | All queries org-scoped; `upsertProgress` verifies org ownership via FK chain        |
| dashboard.repository.ts         | ✅ manual               | Delegates to adapters, all org-scoped                                               |
| guest-interaction.repository.ts | ✅ manual               | All queries org-scoped                                                              |
| team.repository.ts              | ✅ `baseWhere`          | All queries org-scoped                                                              |
| staff-assignment.repository.ts  | ✅ manual               | All queries org-scoped                                                              |
| gbp-cache.repository.ts         | ✅ manual               | All queries org-scoped                                                              |
| gbp-import.repository.ts        | ✅ manual               | All queries org-scoped                                                              |
| property-import.repository.ts   | ✅ manual               | All queries org-scoped                                                              |

### 1.2 Server Functions — Tenant Resolution

Every authenticated server function calls `resolveTenantContext(headers)` or `requireAuth(headers)`. The guest/public server functions (`src/contexts/guest/server/public.ts`) correctly resolve org context via `resolvePortalContext()` (portal UUID → org mapping) rather than from session.

**All 18 server function files verified.** Zero authenticated endpoints missing tenant resolution.

### 1.3 Event Handlers

13 event handlers audited across inbox, metric, review, and goal contexts. All extract `organizationId` from event payloads and pass it through to repository/use case calls. No cross-tenant event processing possible.

### 1.4 Background Jobs

9 BullMQ job handlers audited:

- **Per-org jobs** (sync reviews, publish reply, import property, process image): Receive `organizationId` from job payload
- **System-wide jobs** (purge expired, refresh expiring, spawn recurring, reconcile progress, refresh materialized view): Iterate across all orgs, process each entity within its own org scope. This is the correct pattern for maintenance operations.

### 1.5 Cross-Context Communication

All 12 `public-api.ts` files verified. Every method either:

- Requires `OrganizationId` as a parameter, OR
- Uses capability tokens (UUID-based portal/link IDs), OR
- Is a registration/setup flow creating new context

No cross-context data access bypasses org filtering.

### 1.6 Schema Completeness

| Table                  | Has `organization_id` | Assessment                                               |
| ---------------------- | --------------------- | -------------------------------------------------------- |
| properties             | ✅                    |                                                          |
| portals                | ✅                    |                                                          |
| portal_link_categories | ✅                    |                                                          |
| portal_links           | ✅                    |                                                          |
| portal_groups          | ✅                    |                                                          |
| scan_events            | ✅                    |                                                          |
| ratings                | ✅                    |                                                          |
| feedback               | ✅                    |                                                          |
| reviews                | ✅                    |                                                          |
| replies                | ✅                    |                                                          |
| metric_definitions     | ❌                    | **By design** — global reference data                    |
| metric_readings        | ✅                    |                                                          |
| inbox_items            | ✅                    |                                                          |
| inbox_notes            | ✅                    |                                                          |
| goals                  | ✅                    |                                                          |
| goal_progress          | ❌                    | **FK-chain scoped** via `goalId → goals.organization_id` |
| teams                  | ✅                    |                                                          |
| staff_assignments      | ✅                    |                                                          |
| google_connections     | ✅                    |                                                          |
| gbp_cache              | ✅                    |                                                          |
| gbp_import_jobs        | ✅                    |                                                          |
| audit_logs             | ✅                    |                                                          |

### 1.7 External Boundaries

**Google OAuth (callback route):**

- HMAC-SHA256 signed state parameter with 10-minute freshness
- `timingSafeEqual` comparison prevents timing attacks
- State parsed before auth resolution; `resolveTenantContext()` called to associate connection with correct org
- ✅ **Secure**

**GBP Pub/Sub webhook:**

- JWT Bearer token verified against Google's JWKS via `jose`
- Audience validation against configurable `GBP_PUBSUB_AUDIENCE`
- `locationId` extracted from payload → property lookup (which carries org context)
- ✅ **Secure**

**S3 storage:**

- Keys constructed as `portals/${portal.organizationId}/${portal.id}/hero/${uuid}`
- ✅ **Org-scoped by design**

### Tenant Separation Findings

---

### [TS-001] MINOR: Portal Group UPDATE lacks organization_id filter

**File:** `src/contexts/portal/infrastructure/repositories/portal-group.repository.ts:77-82`
**Category:** missing-org-filter
**Tag:** [code-fix]

**Evidence:**

```ts
update: async (group) => {
  return trace('portalGroup.update', async () => {
    const result = await db
      .update(portalGroups)
      .set({ name: group.name, updatedAt: group.updatedAt })
      .where(eq(portalGroups.id, unbrand(group.id)))  // ← NO org filter
      .returning()
```

Compare with `delete` which correctly uses:

```ts
delete: async (orgId, id) => {
  await db
    .delete(portalGroups)
    .where(and(...baseWhere(portalGroups, orgId), eq(portalGroups.id, unbrand(id))))
```

**Impact:** The `update` method accepts only a `group` domain object (which carries `organizationId`) but the WHERE clause doesn't verify the org. If a caller passed a group with an ID belonging to another org, the update would succeed. Currently mitigated because the use case layer resolves the org and constructs the group object internally — but defense-in-depth says the repo should also filter.

**Fix:** Change signature to `update: async (orgId, group)` and add `...baseWhere(portalGroups, orgId)` to the WHERE clause, matching the `delete` pattern.

---

### [TS-002] INFO: goal_progress lacks direct organization_id

**File:** `src/shared/db/schema/goal.schema.ts:58-72`
**Category:** schema-gap
**Tag:** [code-fix] (defense-in-depth)

**Evidence:** The `goal_progress` table has only a `goalId` FK. Org scoping requires `JOIN goals ON goal_progress.goal_id = goals.id WHERE goals.organization_id = $1`.

**Impact:** The `goal.repository.ts` compensates by always JOINing through goals or verifying ownership via `upsertProgress`'s explicit check:

```ts
const [row] = await db
  .select({ organizationId: goals.organizationId })
  .from(goals)
  .where(eq(goals.id, goalId))
  .limit(1)
if (!row || row.organizationId !== organizationId) {
  throw new Error(`upsertProgress: goal ${goalId} not found or tenant mismatch`)
}
```

This is safe as long as every code path goes through the repository. A future developer writing a direct query against `goal_progress` could miss the org filter.

**Fix:** Add a denormalized `organization_id` column to `goal_progress` for defense-in-depth. Add a comment in the schema documenting the FK-chain scoping.

---

### [TS-003] INFO: Tenant cache keyed by raw cookie header

**File:** `src/shared/auth/middleware.ts:22-30`
**Category:** cache-design
**Tag:** [info]

**Evidence:**

```ts
function tenantCacheKey(headers: Headers): string | null {
  const cookie = headers.get('cookie')
  if (!cookie || cookie.trim() === '') {
    return null
  }
  return cookie // Raw cookie string as cache key
}
```

**Impact:** Functionally safe — different sessions have different cookies, and empty cookies are excluded. The 5-second TTL limits any confusion window. Under high traffic with large cookies, the Map could consume more memory than needed, but the 100-entry FIFO cap prevents unbounded growth.

**Fix:** Consider hashing the cookie header (`SHA-256`) for memory efficiency. Not a security issue.

---

## Part 2: Security Audit

### 2.1 Authentication & Session Management

**Better Auth configuration** (`src/shared/auth/auth.ts`) provides:

- Organization plugin for multi-tenant sessions
- Session-based auth (cookies, not tokens)
- `activeOrganizationId` binding per session

**Cookie security:** Better Auth handles cookie flags internally. The session is managed server-side via `getSession()` which reads from the `better_auth_session` table — no client-visible session tokens.

**OAuth flow security:**

- State parameter uses HMAC-SHA256 with dedicated `OAUTH_STATE_SECRET`
- 10-minute freshness window prevents replay
- `timingSafeEqual` prevents timing attacks
- PKCE not visible (Google OAuth may use it internally via Better Auth)
- ✅ **Secure**

**Session fixation:** Better Auth regenerates session on login. Not vulnerable.

### 2.2 Token Encryption

**File:** `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts`

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key:** 32-byte hex key from `ENCRYPTION_KEY` env var (validated: 64 hex chars)
- **IV:** 12 bytes random per encryption (recommended for GCM)
- **Format:** `iv:authTag:ciphertext` (base64 parts)
- ✅ **Cryptographically sound**

### 2.3 Authorization & Access Control

**Permission system** (`src/shared/domain/permissions.ts`):

- `can(role, permission)` sync check — used in every use case
- Three roles: `AccountAdmin` (full), `PropertyManager` (manage with assignment scoping), `Staff` (read-only)
- Property-scoped access via `staff_assignment` table

**Property-scoped enforcement:**

- Use cases like `addInboxNote` verify property access via `staffPublicApi.getAccessiblePropertyIds()`
- Staff can only see reviews for properties they're assigned to
- ✅ **Properly enforced**

**Privilege escalation:**

- Role assignment is org-scoped; only `AccountAdmin` can manage roles
- Better Auth's organization plugin handles role storage
- `toDomainRole()` maps Better Auth roles (`owner`/`admin`/`member`) to domain roles (`AccountAdmin`/`PropertyManager`/`Staff`)
- ✅ **No escalation path found**

### 2.4 Input Validation

**Zod schemas** validate all server function inputs via `.inputValidator(schema)`. Every endpoint has explicit input validation.

**SQL injection:**

- Drizzle ORM parameterizes all queries by default
- Raw `sql` template literals use Drizzle's parameterization (e.g., `sql`${reviews.expiresAt} <= ${date}``)
- The `sql` tagged template is from `drizzle-orm/sql` which handles parameterization
- ✅ **No SQL injection risk**

**XSS:**

- React's JSX auto-escapes by default
- Two uses of `dangerouslySetInnerHTML`: chart.tsx (static theme CSS — no user input) and root.tsx (theme init script — hardcoded)
- ✅ **No XSS risk**

### 2.5 Rate Limiting

**File:** `src/shared/rate-limit/middleware.ts`

- Redis-backed sliding window rate limiter
- Applied to guest/public endpoints (submit rating, submit feedback)
- Session-scoped via `rating:${sessionId}` and `feedback:${sessionId}` keys
- Returns `429 Too Many Requests` when exceeded
- Guest IP hashed with daily salt (`GUEST_SESSION_SALT`) before storage
- Honeypot field on feedback form catches bots

**Gaps:**

---

### [SEC-001] MINOR: No rate limiting on recordScan and public portal GET endpoints

**File:** `src/contexts/guest/server/public.ts`
**Category:** dos
**Tag:** [code-fix]

**Evidence:** `recordScanFn` and `getPublicPortal` do not call `rateLimiter.check()`. Only `submitRatingFn` and `submitFeedbackFn` use rate limiting.

**Impact:** An attacker could flood scan recording or public portal loads. `recordScan` creates a DB row per call. Under sustained attack, this could bloat the `scan_events` table.

**Fix:** Add rate limiting to `recordScanFn` (session + IP scoped) and consider a higher limit for `getPublicPortal` (read-only, but still costs DB queries).

---

### [SEC-002] MINOR: No rate limiting on authenticated server functions

**File:** All `src/contexts/*/server/*.ts`
**Category:** dos
**Tag:** [info]

**Evidence:** Authenticated endpoints rely solely on session-based auth with no rate limiting.

**Impact:** A compromised account could enumerate resources or flood write operations. Better Auth may provide some built-in throttling, but application-level rate limiting is absent.

**Fix:** Consider adding per-user rate limiting for write-heavy endpoints (inbox operations, reply submission) as defense-in-depth.

---

### 2.6 Error Handling & Information Disclosure

**File:** `src/shared/auth/server-errors.ts`

- `catchUntagged()` logs full stack traces server-side but returns generic `"Internal server error"` (status 500) to the client
- Stack traces, SQL queries, and internal details are NOT exposed to clients
- ✅ **Secure**

---

### [SEC-003] INFO: Logging includes stack traces server-side

**File:** `src/shared/auth/server-errors.ts:62`
**Category:** data-exposure
**Tag:** [info]

**Evidence:**

```ts
logger.error(
  {
    requestId: ctx?.requestId,
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined, // Stack trace logged
    errorType: 'UntaggedError',
  },
  `← THROW InternalError → 500`,
)
```

**Impact:** Stack traces in logs are expected for debugging. This is correct behavior — just noting for completeness that log infrastructure should be access-controlled.

**Fix:** Ensure log aggregation (pino → whatever sink) is properly access-controlled. Not a code change.

---

### 2.7 PII Handling

**Email addresses:** Not found in any logger calls. The OAuth callback logs security warnings without email content. The `maskEmail()` convention from observability patterns is documented.

**IP addresses:** Guest IPs are SHA-256 hashed with a daily salt before storage. Raw IPs never stored.

**Google OAuth tokens:** Encrypted at rest with AES-256-GCM. Never returned in API responses.

**Session cookies:** Better Auth manages these; no custom cookie handling.

- ✅ **PII properly handled**

### 2.8 Redirect Security

All redirects in the OAuth callback target `${env.BETTER_AUTH_URL}/properties/import` — a validated, environment-configured URL. The `errorParam` is interpolated into the query string but only as a pre-defined enum (`denied`, `invalid_state`, `session_expired`, `connection_failed`).

- ✅ **No open redirects**

### 2.9 External Service Boundaries

**Google Pub/Sub webhook:**

- JWT Bearer token verification against Google's JWKS
- Audience validation
- Returns 200 for all valid messages (prevents Pub/Sub retry loops)
- Returns 401/400 for malformed requests
- ✅ **Secure**

**Google OAuth:**

- HMAC-signed state prevents CSRF
- Authorization code exchanged server-side (never exposed to client)
- Connection associated with resolved org context
- ✅ **Secure**

**S3:**

- Presigned upload URLs with content type + size validation
- Keys are org-scoped (`portals/${orgId}/${portalId}/hero/${uuid}`)
- ✅ **Secure**

### 2.10 Dependency Security

Key security-relevant dependencies:

- `better-auth: ^1.5.3` — Active maintained auth library
- `jose: ^6.2.3` — Standard JWT/JWKS library
- `@aws-sdk/client-s3: ^3.1039.0` — Current AWS SDK
- `ioredis: ^5.10.1` — Standard Redis client
- `zod: v4` — Input validation

No `helmet`, `cors`, or CSRF middleware visible — TanStack Start/Vinxi likely handles these at the server level.

---

### [SEC-004] MINOR: No CORS or CSP configuration visible in application code

**File:** N/A — no custom CORS/CSP middleware found
**Category:** network
**Tag:** [info]

**Evidence:** No `cors()`, `helmet()`, or CSP header configuration in application code. This may be handled by Vinxi/TanStack Start defaults or the hosting platform (Railway).

**Impact:** Without explicit CSP, XSS (if ever introduced) could load external scripts. Without CORS configuration, browser-based cross-origin requests may be allowed by default.

**Fix:** Verify that the deployment platform sets appropriate headers. Consider adding CSP for the authenticated app surface at minimum.

---

### 2.11 Worker & Background Job Security

**BullMQ:**

- Redis-backed job queue
- Jobs enqueued only by trusted server code
- No external-facing job submission API
- Job payloads carry `organizationId` from authenticated context

---

### [SEC-005] INFO: BullMQ queues have no authentication

**File:** `src/shared/jobs/worker.ts`, `src/shared/jobs/queue.ts`
**Category:** worker
**Tag:** [info]

**Impact:** If Redis were exposed publicly, an attacker could inject crafted job payloads. Currently mitigated because Redis is server-side only and Railway's internal networking prevents external access.

**Fix:** Ensure Redis is never exposed publicly. Consider Redis AUTH (`requirepass`) as defense-in-depth.

---

### 2.12 Business Logic Security

**Review reply workflow:**

- `draft` → `pending_approval` → `approved` → `published` lifecycle enforced
- Only PM+ roles can manage replies (Staff cannot)
- Permission check `can(role, 'reply.manage')` at use case level
- ✅ **Secure**

**Inbox triage:**

- Status transitions follow defined graph
- Bulk operations validate per-item
- Property-scoped access via staff assignment
- ✅ **Secure**

**Invitation flow:**

- Only AccountAdmin can invite
- Invitation via Better Auth's organization plugin
- ✅ **Secure**

**Property deletion:**

- Soft delete (`deletedAt` timestamp)
- `baseWhere` automatically filters deleted records
- Google connection cleanup handled
- ✅ **Secure**

### 2.13 Environment & Secrets

**File:** `src/shared/config/env.ts`

- All secrets validated via Zod at startup
- `BETTER_AUTH_SECRET` minimum 32 chars, alphanumeric required
- `ENCRYPTION_KEY` exactly 64 hex chars (32 bytes)
- `OAUTH_STATE_SECRET` minimum 32 hex chars
- `GUEST_SESSION_SALT` minimum 16 chars (required in production)
- Dev-only defaults exist but are gated by `NODE_ENV !== 'production'`
- ✅ **Properly validated**

---

## Findings Summary

### Tenant Separation

| ID     | Severity | Description                                       | Action                                    |
| ------ | -------- | ------------------------------------------------- | ----------------------------------------- |
| TS-001 | MINOR    | Portal group `update()` lacks org filter in WHERE | Add `baseWhere` to match `delete` pattern |
| TS-002 | INFO     | `goal_progress` lacks direct `organization_id`    | Consider denormalized column              |
| TS-003 | INFO     | Tenant cache keyed by raw cookie string           | Hash for memory efficiency (optional)     |

### Security

| ID      | Severity | Description                                            | Action                              |
| ------- | -------- | ------------------------------------------------------ | ----------------------------------- |
| SEC-001 | MINOR    | No rate limiting on `recordScan` and `getPublicPortal` | Add session-scoped rate limiting    |
| SEC-002 | MINOR    | No rate limiting on authenticated endpoints            | Consider per-user limits for writes |
| SEC-003 | INFO     | Stack traces logged server-side (correct behavior)     | Verify log access controls          |
| SEC-004 | MINOR    | No explicit CORS/CSP configuration                     | Verify platform-level headers       |
| SEC-005 | INFO     | BullMQ queues lack authentication                      | Ensure Redis is private; add AUTH   |

### Overall Assessment

**0 CRITICAL findings**
**0 MAJOR findings**
**4 MINOR findings** (defense-in-depth improvements)
**4 INFO findings** (observations, no action required)

The codebase demonstrates excellent multi-tenant isolation discipline. The `baseWhere` helper, consistent `organizationId` parameterization, and capability-token patterns for public flows show mature architectural thinking. The only actionable code fix is TS-001 (portal group update), which is a defense-in-depth gap rather than an exploitable vulnerability.
