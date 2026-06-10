# Property Context — Infrastructure & Server Review

**Reviewer:** automated deep review
**Date:** 2026-06-10
**Scope:** `src/contexts/property/infrastructure/` and `src/contexts/property/server/`
**Dimensions:** D5 (Repository Ports), D7 (Multi-Tenancy), D8 (Server Functions), D12 (Context Docs), D15 (Error Handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 3     |
| MINOR    | 5     |
| NIT      | 3     |

---

## Findings

### [D5] [MINOR] findIdsByGoogleConnection returns raw string instead of branded PropertyId

File: src/contexts/property/infrastructure/repositories/property.repository.ts:147
Quote:

```ts
return rows.map((r) => r.id as PropertyId)
```

Rule: D5 — Adapter returns domain types; branded IDs should be reconstructed via constructor.
Fix: Use `propertyId(r.id)` instead of bare `as PropertyId` cast, consistent with `propertyFromRow` in all other methods.

### [D5] [MINOR] clearGoogleConnectionRef casts propertyIds array with `as readonly string[]` instead of using unbrandAll

File: src/contexts/property/infrastructure/repositories/property.repository.ts:160
Quote:

```ts
inArray(properties.id, propertyIds as readonly string[]),
```

Rule: D5 — Adapter should use branded ID utilities at infrastructure boundary.
Fix: Use `inArray(properties.id, unbrandAll(propertyIds))` for consistency with D5 and the project's `unbrandAll` utility.

### [D5] [MINOR] findIdsByGoogleConnection port signature returns `ReadonlyArray<string>` instead of `ReadonlyArray<PropertyId>`

File: src/contexts/property/application/ports/property.repository.ts:33-36
Quote:

```ts
findIdsByGoogleConnection: (connectionId: GoogleConnectionId, orgId: OrganizationId) =>
  Promise<ReadonlyArray<PropertyId>>
```

Rule: D5 — Port returns domain types. The implementation (line 147) does `r.id as PropertyId` which satisfies the type but the `public-api.ts` interface (line 93) declares the return as `ReadonlyArray<string>`, creating an inconsistency between the port's `PropertyId` and the public API's `string`.
Fix: Align `PropertyPublicApi.findIdsByGoogleConnection` return type to `ReadonlyArray<PropertyId>` (or use the branded constructor in the impl and keep `string` in the public API with explicit `unbrand`).

### [D7] [MAJOR] findByGbpPlaceId omits organizationId filter — cross-org data leak possible if caller misuses

File: src/contexts/property/infrastructure/repositories/property.repository.ts:112-121
Quote:

```ts
// Intentional cross-org lookup: GBP webhook identifies properties by placeId,
// not orgId. The webhook handler verifies Google Pub/Sub JWT before calling this.
// Caller is responsible for org-scoping the result.
findByGbpPlaceId: async (gbpPlaceId) => {
```

Rule: D7 — Every DB query on tenant-owned table has organizationId. While the comment explains the intentional design, there is no compile-time or runtime enforcement that callers actually scope the result. The port signature (line 28) omits `orgId`, making it easy for a future consumer to call this without realizing it's unscoped.
Fix: Acceptable as-is with the documented justification, but consider adding an optional `orgId?: OrganizationId` parameter that is applied when provided, and documenting the "unscoped call requires JWT-verified caller" invariant in the port JSDoc.

### [D7] [MAJOR] findBySlug omits organizationId filter — unauthenticated path returns any org's property

File: src/contexts/property/infrastructure/repositories/property.repository.ts:125-134
Quote:

```ts
// Public slug lookup — no orgId scoping. Slugs are unique per property
// and used for public-facing URLs (guest portal resolution).
findBySlug: async (slug) => {
```

Rule: D7 — Every DB query on tenant-owned table has organizationId. The public API justifies this (guest portal resolution), but the port interface has no guard preventing misuse by other internal callers.
Fix: Acceptable for the documented public-facing use case. Ensure callers of `findBySlug` are limited to the public API surface and add a code-level comment in the port to gate future usage.

### [D12] [MAJOR] CONTEXT.md omits property-read.ts split file

File: src/contexts/property/CONTEXT.md:48
Quote:

```
  server/              properties.ts
```

Rule: D12 — CONTEXT.md architecture layers should match actual code. The actual server directory contains two files: `properties.ts` and `property-read.ts`, but CONTEXT.md only lists `properties.ts`.
Fix: Update CONTEXT.md architecture layers to list both files:

```
  server/              properties.ts, property-read.ts
```

### [D8] [NIT] listProperties server function has no input validation

File: src/contexts/property/server/property-read.ts:21-41
Quote:

```ts
export const listProperties = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
```

Rule: D8 — Server functions wrapped in tracedServerFn, auth middleware, input validation. While `listProperties` takes no user input (list all for the authenticated org), this is technically compliant since there is no input to validate. Noted for completeness.
Fix: No fix needed — correct behavior for a no-input GET endpoint.

### [D8] [NIT] deleteProperty uses POST method instead of DELETE

File: src/contexts/property/server/property-read.ts:70
Quote:

```ts
export const deleteProperty = createServerFn({ method: 'POST' })
```

Rule: D8 — Server function conventions. The delete mutation uses POST rather than DELETE. This is consistent with TanStack Start server function patterns which typically use POST for all mutations, so this is acceptable.
Fix: No fix needed — TanStack Start convention.

### [D15] [MINOR] build.ts importProperty catches raw PG error code '23505' without type guard

File: src/contexts/property/build.ts:134-137
Quote:

```ts
const isPg23505 =
  err instanceof Error && 'code' in err && (err as { code: string }).code === '23505'
```

Rule: D15 — Consistent error handling, no bare catch. The error detection is present but relies on a loose structural check (`'code' in err`). Drizzle/PG errors are `DatabaseError` objects, not plain `Error`, so `err instanceof Error` may be falsy for some PG drivers, causing the unique-constraint detection to silently fail and the raw error to propagate.
Fix: Use a dedicated type guard (e.g., `isPgUniqueViolation` in shared/db) that handles `DatabaseError` from `pg` / `postgres` correctly.

### [D15] [MINOR] Repository insert/insertAndReturn tenant guard throws propertyError directly in infrastructure

File: src/contexts/property/infrastructure/repositories/property.repository.ts:79,169
Quote:

```ts
throw propertyError('forbidden', 'Tenant mismatch on property insert')
```

Rule: D15 — No domain errors thrown from infrastructure layer. The infrastructure layer imports and throws `propertyError` from `domain/errors.ts`, creating a dependency from infrastructure → domain errors. This is a layer violation — infrastructure should not know about domain error codes.
Fix: Throw a generic infrastructure error (e.g., `new Error('Tenant mismatch')`) and let the application layer catch and translate it, or use a shared infrastructure error type. Alternatively, document this as an acceptable defense-in-depth pattern if the team has decided the repo is the "last line of defense."

### [D7] [NIT] Repository test casts `property.id as never` to satisfy branded types

File: src/contexts/property/infrastructure/repositories/property.repository.test.ts:77,102,105
Quote:

```ts
const found = await repo.findById(ORG_A, property.id as never)
```

Rule: D7 — Tests should use proper branded ID constructors. Using `as never` suppresses type checking and could hide real type mismatches.
Fix: Use `propertyId(property.id)` or adjust `buildTestProperty` to return properly branded IDs.

### [D12] [MINOR] CONTEXT.md says "Events consumed: None" — verify no event subscriptions exist

File: src/contexts/property/CONTEXT.md:34
Quote:

```
None. Property context does not subscribe to events from other contexts.
```

Rule: D12 — CONTEXT.md claims must match actual code. Verified: no event handler files exist in property context, and no imports from `shared/events` appear in infrastructure or server layers. **Confirmed accurate.**

### [D12] [MINOR] CONTEXT.md does not document the public-api methods added to the repository (insertAndReturn, findExistingGbpPlaceIds, existsByGbpPlaceId)

File: src/contexts/property/CONTEXT.md:38-50
Rule: D12 — Architecture layers documentation should reflect the full port surface. The port interface has 14 methods but the CONTEXT.md only describes the architecture at a file level. The public API section (line 62-68) lists `PropertyImportResult` and `PropertyImportConflict` but omits mention of the supporting repo methods that enable them.
Fix: Add a brief note in CONTEXT.md Public API section about the supporting repository methods (`insertAndReturn`, `findExistingGbpPlaceIds`, `existsByGbpPlaceId`) that were added for GBP import.

---

## Positive Observations

1. **Multi-tenancy is well-enforced.** All tenant-scoped queries use `baseWhere(properties, orgId)` which applies both `organization_id` and `deleted_at IS NULL` filters. The two exceptions (`findByGbpPlaceId`, `findBySlug`) are clearly documented and justified.

2. **Server functions follow the prescribed pattern.** All 5 server functions use `tracedHandler`, `resolveTenantContext`, typed input validation via Zod, and consistent error translation via `propertyErrorStatus` with `ts-pattern .exhaustive()`.

3. **Repository tests include explicit tenant isolation tests.** Lines 84-141 verify cross-org isolation for `findById`, `slugExists`, and `list`.

4. **Error handling is consistent.** Domain errors use tagged `_tag: 'PropertyError'` pattern, server functions use `throwContextError` + `catchUntagged`, and the exhaustive pattern match ensures new error codes trigger compile-time errors.

5. **Mapper is clean and bidirectional.** `propertyFromRow` reconstructs branded IDs via constructors, `propertyToRow` uses `unbrand()`. Pure functions, no side effects.
