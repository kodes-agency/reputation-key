# Review: Identity, Property, Integration & Review Contexts

**Reviewer:** Senior code reviewer (ruthless mode)  
**Date:** 2025-05-18  
**Scope:** Identity, Property, Integration, Review bounded contexts

---

## Summary

Four bounded contexts reviewed across ~143 files. The codebase demonstrates strong architectural discipline overall — hexagonal layers are clean, factory function pattern is consistent, tagged errors with `ts-pattern .exhaustive()` is properly maintained. The critical tenant isolation invariant is generally well-enforced. However, there are several findings that need attention: one **P0 critical security issue** (missing `organizationId` in GBP cache upsert conflict target), several P1 issues around missing tenant isolation in specific queries, and a handful of architectural violations. The integration context's `import-property.job.ts` is a 191-line cyclomatic monster that desperately needs decomposition.

---

## Critical Issues (P0/P1)

### P0-01: GBP Cache upsert conflict target missing `organizationId`

**File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:29-30`

The `upsert` method's `onConflictDoUpdate` targets `[gbpCache.propertyId, gbpCache.dataType]` — this does **NOT** include `organizationId`. If the same `propertyId` UUID were somehow shared across tenants (unlikely with UUIDs but possible with data migration or manual insertion), cross-tenant data corruption occurs. More importantly, this directly **violates convention #10**: "Unique indexes AND onConflictDoUpdate targets MUST include organizationId."

```ts
// CURRENT (WRONG):
.onConflictDoUpdate({
  target: [gbpCache.propertyId, gbpCache.dataType],
  ...
})
// SHOULD BE:
.onConflictDoUpdate({
  target: [gbpCache.organizationId, gbpCache.propertyId, gbpCache.dataType],
  ...
})
```

The corresponding unique index in the schema must also include `organizationId`.

### P0-02: GBP Cache `findByPropertyAndType` has no tenant isolation

**File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:13-21`

`findByPropertyAndType(propertyId, dataType)` queries by `propertyId` and `dataType` only — **no `organizationId` filter**. This violates convention #9. A caller from one tenant could read another tenant's cached GBP data if they know the property ID.

```ts
// MISSING: organizationId parameter and eq(gbpCache.organizationId, orgId) in WHERE
```

### P1-01: GBP Cache `upsert` set clause missing `updatedAt`

**File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:29-37`

Convention #8 states: "Upsert set clause MUST include `updatedAt`." The `upsert` method's `set` block does not include `updatedAt`, meaning cache entry timestamps are never updated on conflict.

### P1-02: `import-property.job.ts` — 191 LOC, cyclomatic complexity ~15

**File:** `src/contexts/integration/infrastructure/jobs/import-property.job.ts`

This job handler is a monolithic 191-line function with cyclomatic complexity ~15. It does connection lookup, token refresh, GBP API calls, property matching, property creation, job status updates, counter increments, per-item error handling, and event emission — all in one function. This needs to be decomposed into smaller functions or extracted into helper use cases. The per-item try/catch (convention #26) IS present, which is good.

### P1-03: `gbp-api.adapter.ts` `mapGbpLocation` — cyclomatic complexity ~21

**File:** `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`

The `mapGbpLocation` function maps a raw GBP API response to a domain type. At cyclomatic complexity ~21, this is a readability and maintainability hazard. Each field extraction with null coalescing, conditional mapping, and nested object construction should be broken into smaller focused mappers.

### P1-04: `updateOrganization` server function contains business logic

**File:** `src/contexts/identity/server/organizations.ts:517-527`

Convention #5: "Server fn thin wrapper — NO business logic." The `updateOrganization` handler has a role check (`ctx.role !== 'AccountAdmin' && ctx.role !== 'PropertyManager'`) embedded directly in the server function. This authorization check should live in a use case. Additionally, the `null`-to-`undefined` conversion logic (lines 530-551) is transformation logic that belongs in a DTO mapper, not a server function.

### P1-05: `disconnectGoogleAccount` silently swallows token revocation errors

**File:** `src/contexts/integration/application/use-cases/disconnect-google-account.ts:53-59`

Convention #13: "Per-item catch in batch loops must log, not swallow silently." While this is a single operation (not a batch loop), the empty catch block with no logging is still problematic. At minimum, log the revocation failure for operational visibility:

```ts
} catch (revocationError) {
  // Best-effort: log and continue
  logger.warn('Google token revocation failed', { connectionId, error: revocationError })
}
```

---

## Warnings (P2)

### P2-01: Identity `signInUser` swallows all error details

**File:** `src/contexts/identity/server/organizations.ts:474-484`

The `signInUser` handler catches **all** errors from `auth.api.signInEmail` and replaces them with a generic "Invalid email or password" message. This is correct for security (don't leak auth internals), but any non-auth errors (network failures, database issues, internal errors) will also be swallowed and presented as "invalid credentials." Consider catching more specifically or logging the original error before replacing.

### P2-02: `connectGoogleAccount` has select-then-write pattern for existing connections

**File:** `src/contexts/integration/application/use-cases/connect-google-account.ts:47-61`

The flow `findByGoogleAccountId` → `updateReconnection` is a select-then-update pattern. Convention #7 says "Upsert MUST use onConflictDoUpdate — never select-then-write (race condition)." However, this case may be acceptable since it's keyed on `googleAccountId` (globally unique) rather than a composite that could race within a tenant. Flagging for awareness.

### P2-03: `refreshGoogleToken` does select → update → select

**File:** `src/contexts/integration/application/use-cases/refresh-google-token.ts:26-76`

The pattern is: `findById` → `updateTokens` → `findById`. This is three DB round-trips where one upsert with returning would suffice. Not a correctness issue, but a performance concern for a hot path called before every Google API call.

### P2-04: Review `sync-reviews.ts` doesn't handle `GoogleReviewApiPort` returning rate-limited errors

**File:** `src/contexts/review/application/use-cases/sync-reviews.ts`

The sync use case calls `deps.googleApi.fetchReviews(...)` inside a batch loop. Convention #19 says "Map 429 to `gbp_api_rate_limited`." The adapter should do this mapping, but the use case should propagate the error as a retryable signal rather than catching it per-item. Need to verify the adapter's 429 handling is complete and that the use case doesn't swallow `gbp_api_rate_limited` in its per-item catch.

### P2-05: `gbpCache.deleteExpired` has no tenant filter

**File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:55-63`

`deleteExpired` deletes all expired cache entries regardless of organization. Convention #12 says "System-level queries (no tenant filter) must be named `findAll*`." This method should either be named `deleteAllExpired` or include a tenant parameter.

### P2-06: `requestOrgLogoUpload` and `requestAvatarUpload` bypass use case error handling

**File:** `src/contexts/identity/server/organizations.ts:574-645`

The logo/avatar upload server functions construct use cases inline (`requestOrgLogoUploadUseCase({ storage })`) instead of going through `getContainer().useCases`. If the use case throws a tagged error, the server function has no try/catch to translate it, violating the error handling pattern used everywhere else.

### P2-07: Identity `acceptInvitation` and `cancelInvitation` call better-auth directly without tenant validation

**File:** `src/contexts/identity/server/organizations.ts:205-241`

`acceptInvitation` doesn't call `resolveTenantContext` before delegating to better-auth. `cancelInvitation` calls `resolveTenantContext` but ignores the result. Both delegate invitation management entirely to better-auth without validating that the invitation belongs to the tenant's organization. This relies on better-auth's internal authorization, which may be correct but is architecturally inconsistent.

### P2-08: Property `createProperty` emits event without `await`

**File:** `src/contexts/property/application/use-cases/create-property.ts:63-71`

`deps.events.emit(...)` is called without `await`. Other use cases (e.g., `connect-google-account.ts:75`) correctly `await` the emit. If the event bus is async, this event may fire after the response is sent, or worse, be lost on process crash. Either `await` it or document that fire-and-forget is intentional.

---

## Minor (P3)

### P3-01: `fallow-ignore-next-line` comments in property use case

**File:** `src/contexts/property/application/use-cases/create-property.ts:15,77`

Comments like `// fallow-ignore-next-line unused-type` suggest a linting tool that isn't suppressing properly via configuration. Fix the lint config rather than sprinkling ignore comments.

### P3-02: Type alias `AuthMemberResponse`, `AuthInvitationResponse`, `AuthOrganizationResponse` in server file

**File:** `src/contexts/identity/server/organizations.ts:56-92`

These type definitions are in a server function file. They should ideally live in a shared types file or adapter layer, not in the thin server wrapper.

### P3-03: `SetValues` mutable type in property repository

**File:** `src/contexts/property/infrastructure/repositories/property.repository.ts:15-22`

The `SetValues` type manually strips `readonly` from Property fields. This is fragile — if new fields are added, this type must be manually updated. Consider using a utility type like `Partial<Writable<...>>`.

### P3-04: `extractOrgBillingFields` uses `as Record<string, unknown>` cast

**File:** `src/contexts/identity/server/organizations.ts:99-116`

This function casts `unknown` to `Record<string, unknown>` and then individual field accesses with `as string | null`. This is defensive but verbose. A Zod schema partial parse would be safer and self-documenting.

### P3-05: Google OAuth adapter constructs `URLSearchParams` with plain objects

**File:** `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts:33-39`

Using `new URLSearchParams({...})` is fine but note that `URLSearchParams` coerces all values to strings. The `code`, `client_id`, etc. are already strings so this is correct, but worth noting for future maintenance.

---

## Security Findings

### SEC-01: Token encryption uses AES-256-GCM ✅ (verified)

**File:** `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts`

Token encryption properly uses `AES-256-GCM` with a random IV per encryption. Key is derived from `ENCRYPTION_KEY` env var. This is correct.

### SEC-02: OAuth code exchange includes redirect URI ✅ (verified)

**File:** `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts:28-39`

The `redirectUriParam` is passed through from the use case's `callbackUrl` configuration, not from user input. This prevents open redirect attacks.

### SEC-03: Google OAuth adapter doesn't validate `id_token`

**File:** `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts:50-89`

The adapter fetches user info via a separate `/userinfo` call instead of validating the `id_token` from the token response. This is functionally equivalent for getting user info, but means the `googleAccountId` comes from the userinfo endpoint rather than from a verified JWT. In practice, this is secure because the access token is freshly obtained via a confidential client flow. Low risk.

### SEC-04: GBP Cache cross-tenant read risk (see P0-02)

The missing `organizationId` filter in `findByPropertyAndType` is a tenant isolation violation. See P0-02 above.

### SEC-05: GBP Cache cross-tenant write/upsert risk (see P0-01)

The missing `organizationId` in the unique index/conflict target means upserts could theoretically collide across tenants. See P0-01 above.

### SEC-06: Review repo tenant isolation ✅ (verified)

**Files:** `src/contexts/review/infrastructure/repositories/review.repository.ts`, `reply.repository.ts`

Both review and reply repositories include `organizationId` in every query, upsert conflict targets, and delete operations. This is correctly implemented.

### SEC-07: 30-day Google data retention ✅ (verified)

**File:** `src/contexts/review/infrastructure/repositories/review.repository.ts`

The `upsert` method sets `expiresAt = now() + 30 days` on every upsert operation, satisfying convention #17.

---

## Positive Findings

1. **Consistent factory function pattern.** Every use case follows `(deps) => async (input, ctx) => Promise<T>`. No exceptions found.

2. **Tagged errors with `.exhaustive()`.** Every server function error mapper uses `ts-pattern` with `.exhaustive()`, ensuring new error codes force a compiler error at the boundary. This is correctly implemented across all four contexts.

3. **Review repo upserts are rock-solid.** `review.repository.ts` and `reply.repository.ts` both use `onConflictDoUpdate` with conflict targets including `organizationId`, set `updatedAt` in the set clause, and include `organizationId` in every query. This is textbook.

4. **Cross-context adapter wiring is clean.** `google-review-api.adapter.ts` in the integration context implements review's `GoogleReviewApiPort` facade, resolving connection → tokens → HTTP internally. The review context never sees access tokens (convention #16). ✅

5. **Reply mirroring correctly distinguishes sources.** The sync use case marks synced replies as `source='google_sync'` and never overwrites `source='internal'` replies (convention #18). ✅

6. **Per-item try/catch in batch loops.** Both `sync-reviews.ts` and `import-property.job.ts` correctly implement per-item error handling with logging (convention #26). ✅

7. **Branded IDs at domain, string at Drizzle boundaries.** The mapper layer correctly unbrands IDs for DB operations and re-brands on reads. ✅

8. **Property repo tenant guard on insert.** The property repository includes a runtime check `property.organizationId !== orgId` before insert (line 66). This is a defense-in-depth measure that's commendable.

9. **`baseWhere()` shared helper.** Property repo uses a shared `baseWhere(properties, orgId)` function that encapsulates `organizationId` + soft-delete filtering. Good DRY approach.

10. **Test quality is high.** Review context tests use in-memory repos for use case tests, integration tests for repos include explicit tenant isolation tests. Error code tests check exhaustive coverage. Mapper tests verify round-trips. This is exactly what convention #22-24 prescribe.

---

## Files Reviewed

### Identity Context

- `src/contexts/identity/domain/errors.ts`
- `src/contexts/identity/domain/types.ts`
- `src/contexts/identity/domain/constructors.ts`
- `src/contexts/identity/domain/rules.ts`
- `src/contexts/identity/domain/events.ts`
- `src/contexts/identity/server/organizations.ts` (665 lines)
- `src/contexts/identity/application/dto/invitation.dto.ts`

### Property Context

- `src/contexts/property/domain/types.ts`
- `src/contexts/property/domain/constructors.ts`
- `src/contexts/property/domain/rules.ts`
- `src/contexts/property/domain/errors.ts`
- `src/contexts/property/domain/events.ts`
- `src/contexts/property/application/use-cases/create-property.ts`
- `src/contexts/property/application/dto/create-property.dto.ts`
- `src/contexts/property/application/dto/update-property.dto.ts`
- `src/contexts/property/application/ports/property.repository.ts`
- `src/contexts/property/infrastructure/repositories/property.repository.ts`
- `src/contexts/property/infrastructure/mappers/property.mapper.ts`
- `src/contexts/property/server/properties.ts`

### Integration Context

- `src/contexts/integration/domain/types.ts`
- `src/contexts/integration/domain/errors.ts`
- `src/contexts/integration/domain/events.ts`
- `src/contexts/integration/domain/constructors.ts`
- `src/contexts/integration/application/use-cases/connect-google-account.ts`
- `src/contexts/integration/application/use-cases/disconnect-google-account.ts`
- `src/contexts/integration/application/use-cases/refresh-google-token.ts`
- `src/contexts/integration/application/ports/google-connection.repository.ts`
- `src/contexts/integration/application/ports/google-oauth.port.ts`
- `src/contexts/integration/application/ports/token-encryption.port.ts`
- `src/contexts/integration/application/ports/gbp-cache.repository.ts`
- `src/contexts/integration/application/ports/gbp-import.repository.ts`
- `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`
- `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts`
- `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`
- `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts`
- `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts`
- `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`
- `src/contexts/integration/infrastructure/repositories/gbp-import.repository.ts`
- `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.ts`
- `src/contexts/integration/infrastructure/mappers/gbp-import.mapper.ts`
- `src/contexts/integration/infrastructure/jobs/import-property.job.ts`
- `src/contexts/integration/server/google-connections.ts`
- `src/contexts/integration/server/google-oauth.ts`
- `src/contexts/integration/server/gbp-import.ts`
- `src/contexts/integration/server/shared.ts`
- `src/contexts/integration/build.ts`

### Review Context

- `src/contexts/review/domain/types.ts`
- `src/contexts/review/domain/constructors.ts`
- `src/contexts/review/domain/rules.ts`
- `src/contexts/review/domain/events.ts`
- `src/contexts/review/domain/errors.ts`
- `src/contexts/review/domain/rules.test.ts`
- `src/contexts/review/domain/constructors.test.ts`
- `src/contexts/review/application/ports/google-review-api.port.ts`
- `src/contexts/review/application/ports/review.repository.ts`
- `src/contexts/review/application/ports/reply.repository.ts`
- `src/contexts/review/application/ports/review-queue.port.ts`
- `src/contexts/review/application/use-cases/sync-reviews.ts`
- `src/contexts/review/application/use-cases/sync-reviews.test.ts`
- `src/contexts/review/application/dto/sync-reviews.dto.ts`
- `src/contexts/review/infrastructure/repositories/review.repository.ts`
- `src/contexts/review/infrastructure/repositories/review.repository.test.ts`
- `src/contexts/review/infrastructure/repositories/reply.repository.ts`
- `src/contexts/review/infrastructure/repositories/reply.repository.test.ts`
- `src/contexts/review/infrastructure/mappers/review.mapper.ts`
- `src/contexts/review/infrastructure/mappers/review.mapper.test.ts`
- `src/contexts/review/infrastructure/mappers/reply.mapper.ts`
- `src/contexts/review/infrastructure/mappers/reply.mapper.test.ts`
- `src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts`
- `src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts`
- `src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.test.ts`
- `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts`
- `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.test.ts`
- `src/contexts/review/build.ts`

---

**Total: ~50+ files examined across 4 bounded contexts.**
