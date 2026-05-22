# Security & Multi-Tenancy Audit Report

**Date**: 2026-05-22  
**Scope**: 10 contexts, 15+ repository files, 14 server function files, 1 webhook route  
**Auditor**: Automated audit via Hermes Agent

---

## 1. Tenant Isolation in Repositories

### ✅ PASSING — Well-isolated contexts

| Context | Repo | Status |
|---------|------|--------|
| property | `property.repository.ts` | ✅ All queries use `baseWhere(properties, orgId)` or explicit `organizationId` filter |
| team | `team.repository.ts` | ✅ All queries use `baseWhere(teams, orgId)` |
| staff | `staff-assignment.repository.ts` | ✅ All queries use `baseWhere(staffAssignments, orgId)` |
| portal | `portal.repository.ts` | ✅ All queries use `baseWhere(portals, orgId)`, including raw SQL in `getPortalQrInfo` |
| portal-links | `portal-link.repository.ts` | ✅ All queries use `catOrg(orgId)` / `linkOrg(orgId)` helpers |
| inbox | `inbox.repository.ts` | ✅ All queries include `eq(inboxItems.organizationId, orgId)` |
| inbox-notes | `inbox-note.repository.ts` | ✅ `findByInboxItemId` includes orgId |
| review | `review.repository.ts` | ✅ All tenant-scoped queries include `eq(reviews.organizationId, organizationId)` |
| reply | `reply.repository.ts` | ✅ All queries include `eq(replies.organizationId, organizationId)` |
| metric | `metric.repository.ts` | ✅ All queries include `eq(metricReadings.organizationId, orgId)` |
| dashboard | `dashboard.repository.ts` | ✅ All aggregation queries filter by `organizationId` via `reviewWhere()` or inline conditions |
| google-connection | `google-connection.repository.ts` | ✅ All queries include `eq(googleConnections.organizationId, orgId)` |
| guest-interaction | `guest-interaction.repository.ts` | ✅ `hasRated` includes orgId; inserts receive orgId from domain objects |
| property-import | `property-import.repository.ts` | ✅ `findExistingGbpPlaceIds` and `existsByGbpPlaceId` include orgId |

### ⚠️ FINDINGS

**FINDING T1 — `property.repository.ts:102` — Cross-tenant query without orgId filter**
- **File**: `src/contexts/property/infrastructure/repositories/property.repository.ts`
- **Line**: 102 (`findByGbpPlaceId`)
- **Severity**: **P1**
- **Detail**: `findByGbpPlaceId` queries by `gbpPlaceId` only, without `organizationId`. This is an internal-only method used by the GBP notification handler to resolve which property a webhook notification belongs to. No user input reaches this path directly — it's called from the webhook handler which receives a Google location ID.
- **Risk**: Low in practice — the GBP Place ID is an external identifier tied to a Google account, not user-controllable. But if a gbpPlaceId were ever reused across tenants (edge case), this would return the wrong property.
- **Recommendation**: Add a comment `// INTENTIONAL: webhook resolver — no tenant context available` or add an optional `organizationId` parameter for defense-in-depth.

**FINDING T2 — `gbp-cache.repository.ts:65-68` — `deleteAllExpired` has no orgId filter**
- **File**: `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`
- **Line**: 65-68
- **Severity**: **P3** (by design)
- **Detail**: `deleteAllExpired` deletes all expired cache entries across all orgs. This is a system-level batch operation (cron job).
- **Status**: ✅ Acceptable — this is a documented system-level query. Naming convention (`deleteAll*`) is followed.

**FINDING T3 — `gbp-cache.repository.ts:84-85` — `deleteByConnectionId` deletes by propertyIds only**
- **File**: `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`
- **Line**: 84-85
- **Severity**: **P2**
- **Detail**: `deleteByConnectionId` resolves propertyIds via `propertyQuery.findIdsByGoogleConnection(connectionId, orgId)` (which IS org-scoped), but the DELETE query itself uses `inArray(gbpCache.propertyId, propertyIds)` without an explicit `eq(gbpCache.organizationId, orgId)`. While the propertyIds come from an org-scoped lookup, the DELETE doesn't have defense-in-depth tenant isolation.
- **Recommendation**: Add `eq(gbpCache.organizationId, orgId)` to the DELETE WHERE clause for defense-in-depth.

**FINDING T4 — `review.repository.ts:119,131` — System queries without orgId**
- **File**: `src/contexts/review/infrastructure/repositories/review.repository.ts`
- **Lines**: 119 (`findAllExpiringBefore`), 131 (`findAllExpiredBefore`)
- **Severity**: **P3** (by design)
- **Detail**: These are documented system-level batch queries for scheduled jobs. The `findAll*` naming convention is followed.
- **Status**: ✅ Acceptable.

**FINDING T5 — `link-resolver.repository.ts:27` — No orgId on public lookup**
- **File**: `src/contexts/portal/infrastructure/repositories/link-resolver.repository.ts`
- **Line**: 27
- **Severity**: **P3** (by design)
- **Detail**: `resolveLinkById` queries by link ID only, no orgId. This is explicitly documented as a public/guest API using the link ID as a capability token (unguessable UUID).
- **Status**: ✅ Acceptable — documented exception for public API capability tokens.

**FINDING T6 — Upsert conflict targets include orgId**
- `gbpCache.upsert`: target `[organizationId, propertyId, dataType]` ✅
- `review.upsert`: target `[platform, externalId, organizationId]` ✅
- `reply.upsert`: target `[reviewId, source, organizationId]` ✅
- All upsert conflict targets properly include `organizationId`.

---

## 2. Auth Checks in Server Functions

### ✅ PASSING — All authenticated endpoints

Every server function in tenant-scoped contexts calls `resolveTenantContext(headers)`:

| Server File | Auth Check | Functions |
|-------------|-----------|-----------|
| `dashboard.ts` | `resolveTenantContext` | ✅ 1 function |
| `inbox.ts` | `resolveTenantContext` | ✅ 8 functions |
| `gbp-import.ts` | `resolveTenantContext` | ✅ 3 functions |
| `google-connections.ts` | `resolveTenantContext` | ✅ 4 functions |
| `portal-links.ts` | `resolveTenantContext` | ✅ 9 functions |
| `portals.ts` | `resolveTenantContext` | ✅ 8 functions |
| `properties.ts` | `resolveTenantContext` | ✅ 5 functions |
| `reply.ts` | `resolveTenantContext` | ✅ 7 functions |
| `staff-assignments.ts` | `resolveTenantContext` | ✅ 3 functions |
| `teams.ts` | `resolveTenantContext` | ✅ 4 functions |
| `organizations.ts` | `resolveTenantContext` / `requireAuth` | ✅ 17+ functions |

### ⚠️ FINDINGS

**FINDING A1 — `guest/server/public.ts` — No auth on guest endpoints**
- **File**: `src/contexts/guest/server/public.ts`
- **Severity**: **P3** (by design)
- **Detail**: `getPublicPortal`, `submitRatingFn`, `submitFeedbackFn`, `resolveLinkAndTrack` have no `resolveTenantContext` or `requireAuth`. These are public/guest-facing endpoints — the portal context is resolved via `useCases.resolvePortalContext({ portalId })` using the portal ID as a capability token, with rate limiting.
- **Status**: ✅ Acceptable — documented exception for guest API.

**FINDING A2 — `identity/server/auth-settings.ts` — Uses better-auth internal session, no `resolveTenantContext`**
- **File**: `src/contexts/identity/server/auth-settings.ts`
- **Severity**: **P2**
- **Detail**: `changePasswordFn`, `updateProfileFn`, `updateUserImageFn`, `createOrganizationFn` pass `headers` directly to `auth.api.*()` calls. These use better-auth's internal session verification rather than the standard `resolveTenantContext` pattern. This is architecturally different but functionally correct — better-auth validates the session cookie.
- **Risk**: These operations are user-scoped (not tenant-scoped), so the divergence is understandable. However, `createOrganizationFn` creates a new org and should be carefully reviewed.
- **Recommendation**: Document this pattern exception in the codebase conventions.

---

## 3. Permission Coverage (`can()` calls)

### Architecture Observation

The codebase has a **two-layer authorization pattern**:
1. **Server layer**: Only `dashboard.ts` and `organizations.ts` call `can()` directly
2. **Use-case layer**: Most contexts delegate `can()` checks to use cases

**FINDING P1 — `inbox/server/inbox.ts` — No `can()` in server or use-case layer**
- **File**: `src/contexts/inbox/server/inbox.ts` and all `src/contexts/inbox/application/use-cases/*.ts`
- **Severity**: **P1**
- **Detail**: Inbox has 4 mutation endpoints (`updateInboxStatus`, `bulkUpdateInboxStatus`, `assignInboxItem`, `addInboxNote`) with NO `can()` permission check at any layer. Authorization relies solely on:
  - `resolveTenantContext` (auth check — verifies session + org membership)
  - Role-scoped property access in use cases (checks if user has access to the property via staff assignments)
- **Risk**: Any authenticated user in the org can perform inbox operations. The staff-assignment check provides property-level access control, but there's no coarse permission gate (e.g., `inbox.manage`). A Staff role user who shouldn't have inbox access but is assigned to a property could still mutate inbox items.
- **Recommendation**: Add `can(ctx.role, 'inbox.manage')` or `can(ctx.role, 'inbox.read')` to use cases or server functions.

**FINDING P2 — `review/server/reply.ts` — `can()` only in use case**
- **File**: `src/contexts/review/server/reply.ts` → `src/contexts/review/application/use-cases/reply-operations.ts`
- **Severity**: **P3** (acceptable)
- **Detail**: `can(role, 'reply.manage')` is called in the use case layer, not server layer. This follows the predominant pattern in the codebase.
- **Status**: ✅ Acceptable — permission check exists.

**FINDING P3 — Read-only endpoints without explicit `can()`**
- **Files**: Most GET endpoints across contexts
- **Severity**: **P2**
- **Detail**: GET endpoints (e.g., `getInboxItems`, `getInboxNotes`, `getUnreadCount`, `listPortals`, `listProperties`, `listTeams`) resolve auth context but don't call `can()`. Any authenticated user in the org can read all data.
- **Risk**: In multi-tenant SaaS, all org members can read all context data. If the Staff role should be restricted from certain read operations, these need permission gates.
- **Recommendation**: Evaluate whether Staff role users should have read access to all data. If not, add `can(ctx.role, '<context>.read')` checks.

---

## 4. Error Leakage

### ✅ PASSING — Robust error handling

**FINDING E1 — `tracedHandler` safety net prevents raw error leakage**
- **File**: `src/shared/observability/traced-server-fn.ts`
- **Detail**: All server functions are wrapped in `tracedHandler`, which catches untagged errors and converts them to generic 500 responses via `catchUntagged()`. Tagged errors (`ServerFunctionError`) are re-thrown with sanitized messages.
- **Status**: ✅ Strong safety net.

**FINDING E2 — Pattern: `catch → if (isXxxError) throwContextError → throw e`**
- **Files**: All server function files
- **Detail**: The ubiquitous `throw e` pattern is safe because `tracedHandler` catches it. If it's a `ServerFunctionError`, it re-throws. If it's truly unexpected, `catchUntagged()` returns a generic 500.
- **Status**: ✅ Safe.

**FINDING E3 — Webhook error responses are sanitized**
- **File**: `src/routes/api/webhooks/gbp/notifications.ts`
- **Detail**: Error responses return generic messages (`'Unexpected error processing webhook notification'`). The original error is logged server-side only.
- **Status**: ✅ Safe.

**FINDING E4 — `server-errors.ts` logs full detail, returns sanitized messages**
- **File**: `src/shared/auth/server-errors.ts`
- **Detail**: `throwContextError` logs the full error with request context but throws a `ServerFunctionError` with only the domain error message. `catchUntagged` returns only `'Internal server error'` to the client.
- **Status**: ✅ Safe.

---

## 5. Webhook Security

### ✅ PASSING — GBP webhook is properly secured

**FINDING W1 — GBP webhook route has JWT verification**
- **File**: `src/routes/api/webhooks/gbp/notifications.ts`
- **Detail**:
  - ✅ Verifies Bearer token presence
  - ✅ Verifies JWT via `verifyPubSubJwt` using Google's public JWKS
  - ✅ Validates audience claim
  - ✅ No direct DB queries — delegates to `handleGbpNotification` handler
  - ✅ Returns 200 on all non-error outcomes (prevents Pub/Sub retries)
  - ✅ Error responses are generic
- **Status**: ✅ Properly secured.

**FINDING W2 — Webhook handler → use case → repository chain is isolated**
- **File**: `src/contexts/integration/application/use-cases/handle-gbp-notification.ts`
- **Detail**: The use case resolves the property by `gbpPlaceId` (webhook context), then enqueues a review sync job. The property lookup via `findByGbpPlaceId` returns the organizationId which is then used in the queued job for tenant-scoped processing.
- **Status**: ✅ No tenant isolation bypass.

---

## Summary of Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| T1 | **P1** | `property.repository.ts:102` | `findByGbpPlaceId` lacks orgId — intentional for webhook resolver, add defense-in-depth |
| T3 | **P2** | `gbp-cache.repository.ts:84` | `deleteByConnectionId` DELETE lacks explicit orgId filter |
| P1 | **P1** | `inbox/server/inbox.ts` + use cases | No `can()` permission check on inbox mutations |
| P3 | **P2** | Various GET endpoints | Read endpoints lack explicit `can()` — any org member can read |
| A2 | **P2** | `identity/server/auth-settings.ts` | Diverges from standard auth pattern (uses better-auth directly) |
| T2 | **P3** | `gbp-cache.repository.ts:65` | `deleteAllExpired` — system-level, by design |
| T4 | **P3** | `review.repository.ts:119,131` | `findAllExpiringBefore/findAllExpiredBefore` — system-level, by design |
| T5 | **P3** | `link-resolver.repository.ts:27` | Public API capability token — by design |
| A1 | **P3** | `guest/server/public.ts` | No auth on guest endpoints — by design |

### Overall Assessment

**The codebase has strong multi-tenancy foundations**: `baseWhere()` helper, explicit orgId checks in nearly every query, tenant mismatch guards on inserts, and orgId in all upsert conflict targets. The two-layer auth pattern (server + use case) is well-implemented for most contexts.

**Priority fixes**:
1. **P1**: Add `can()` permission checks to inbox mutations
2. **P2**: Add orgId to `deleteByConnectionId` DELETE WHERE clause
3. **P2**: Evaluate read-access permission gates for Staff role
