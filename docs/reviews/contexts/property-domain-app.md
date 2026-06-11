# Property Context — Domain & Application Layer Review

**Reviewed:** 2026-06-10  
**Scope:** `src/contexts/property/domain/`, `src/contexts/property/application/`, `src/contexts/property/build.ts`  
**Dimensions:** D2 (events), D3 (use cases), D4 (build function), D11 (domain purity), D12 (CONTEXT.md accuracy), D15 (error handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 3     |
| MAJOR    | 6     |
| MINOR    | 4     |
| NIT      | 3     |

---

## BLOCKER

### B1. [D12] CONTEXT.md claims soft-delete but code performs hard-delete

CONTEXT.md invariant: "Properties are soft-deleted (`deletedAt`), never hard-deleted."  
The actual use case calls `hardDelete` and the file comment says "Hard delete — cascades to reviews, replies, inbox items via FK."

- **File:** `src/contexts/property/application/use-cases/soft-delete-property.ts:1,39`
- **Quote:**
  ```
  // Property context — hard-delete property use case
  await deps.propertyRepo.hardDelete(ctx.organizationId, propertyId)
  // 3. Hard delete — cascades to reviews, replies, inbox items via FK
  ```
- **Rule:** CONTEXT.md §Invariants: "Properties are soft-deleted (`deletedAt`), never hard-deleted."
- **Fix:** Either update CONTEXT.md to reflect hard-delete semantics (and document the cascade behavior), or change the implementation to set `deletedAt` instead of calling `hardDelete`. The file name `soft-delete-property.ts` also contradicts the implementation.

### B2. [D3] createProperty omits gbpPlaceId/googleConnectionId from emitted event

The `property.created` event type defines optional `gbpPlaceId`, `gbpLocationName`, and `googleConnectionId` fields, and CONTEXT.md documents them in the event payload. The `createProperty` use case does not pass these fields even when the created property has them set (e.g., when `gbpPlaceId` is provided in the input DTO).

- **File:** `src/contexts/property/application/use-cases/create-property.ts:64-72`
- **Quote:**
  ```
  await deps.events.emit(
    propertyCreated({
      propertyId: property.id,
      organizationId: property.organizationId,
      name: property.name,
      slug: property.slug,
      occurredAt: property.createdAt,
    }),
  )
  ```
- **Rule:** D3 §"Emit events" — event payloads must include all defined fields present on the entity. CONTEXT.md §Events produced documents gbpPlaceId, gbpLocationName, googleConnectionId.
- **Fix:** Spread the property fields into the event: `gbpPlaceId: property.gbpPlaceId ?? undefined, googleConnectionId: property.googleConnectionId ?? undefined`. Or simplify by omitting only the fields that are genuinely not available at creation time.

### B3. [D4] importProperty does not emit property.created event

The `importProperty` public API method creates a property in the database but emits no event. Per CONTEXT.md, "Create a new property, emits `property.created`" applies to all property creation paths.

- **File:** `src/contexts/property/build.ts:108-145`
- **Quote:**
  ```
  importProperty: async (input) => {
    try {
      const id = idGen()
      const now = deps.clock()
      const property: Property = { ... }
      const inserted = await deps.repo.insertAndReturn(input.orgId, property)
      return { id: inserted.id, ... }
      // No deps.events.emit(propertyCreated(...))
    } catch (err) { ... }
  }
  ```
- **Rule:** D4 — build function wires all paths; CONTEXT.md §Use cases says creation emits `property.created`.
- **Fix:** After `insertAndReturn`, emit `propertyCreated({ propertyId: inserted.id, organizationId: inserted.organizationId, name: inserted.name, slug: inserted.slug, gbpPlaceId: inserted.gbpPlaceId ?? undefined, googleConnectionId: inserted.googleConnectionId ?? undefined, occurredAt: inserted.createdAt })`.

---

## MAJOR

### M1. [D2] Event constructors use crypto.randomUUID() directly instead of IdGenerator port

Domain purity standard: "UUID via IdGenerator" port. The event constructors (`propertyCreated`, `propertyUpdated`, `propertyDeleted`) call `crypto.randomUUID()` inline for `eventId` generation, bypassing the port.

- **File:** `src/contexts/property/domain/events.ts:31`
- **Quote:**
  ```
  eventId: crypto.randomUUID(),
  ```
- **Rule:** D11 — "UUID via IdGenerator" port for domain purity.
- **Fix:** Accept `eventId` as a constructor argument or inject an `idGen` function. If the event constructor is called from application layer only, the application can pass `deps.idGen()` and the domain event constructor takes `eventId` as input.

### M2. [D4] importProperty bypasses domain constructor — no validation

The `importProperty` method constructs a raw `Property` object without going through `buildProperty`. This skips all domain rules: name length, slug format, timezone validity.

- **File:** `src/contexts/property/build.ts:112-123`
- **Quote:**
  ```
  const property: Property = {
    id,
    organizationId: input.orgId,
    name: input.name,
    slug: input.slug,
    timezone: 'UTC',
    ...
  }
  ```
- **Rule:** D4 — composition root should use domain constructors. D11 — entities built via smart constructors.
- **Fix:** Use `buildProperty` with appropriate input (hardcode timezone to `'UTC'`, pass through name/slug from GBP data). If GBP imports genuinely have different validation rules, create a separate domain constructor like `buildImportedProperty` that enforces the relaxed rules explicitly rather than bypassing validation entirely.

### M3. [D3] listProperties test suite missing authorization denial test

The `listProperties` use case checks `can(ctx.role, 'property.read')` but the test suite has no test for the forbidden path (a role without `property.read` permission).

- **File:** `src/contexts/property/application/use-cases/list-properties.test.ts`
- **Quote:** (entire file — 4 tests, none test authorization failure)
- **Rule:** D3 — all use case steps including authorization must be tested.
- **Fix:** Add test: `it('rejects users without property.read permission', ...)` using a role that lacks `property.read`.

### M4. [D12] CONTEXT.md architecture section omits application/use-cases/ directory

CONTEXT.md §Architecture layers lists `application/ports/` and `application/dto/` but does not list `application/use-cases/` where all five use case files live.

- **File:** `src/contexts/property/CONTEXT.md:41-43`
- **Quote:**
  ```
  application/
    ports/             property.repository.ts
    dto/               create-property.dto.ts, update-property.dto.ts
    public-api.ts      re-exports PropertyPublicApi, import types, event types/constructors
  ```
- **Rule:** D12 — CONTEXT.md must accurately reflect actual file structure.
- **Fix:** Add `use-cases/  create-property.ts, update-property.ts, get-property.ts, list-properties.ts, soft-delete-property.ts` to the architecture section.

### M5. [D12] CONTEXT.md use case name "softDeleteProperty" doesn't match exported "deleteProperty"

CONTEXT.md §Use cases says `softDeleteProperty`. The actual export from `soft-delete-property.ts` is `deleteProperty` with types `DeletePropertyInput`, `DeletePropertyDeps`, `DeletePropertyUseCase`.

- **File:** `src/contexts/property/CONTEXT.md:58` vs `src/contexts/property/application/use-cases/soft-delete-property.ts:23`
- **Quote:**

  ```
  // CONTEXT.md
  - **`softDeleteProperty`** — Soft-delete a property, emits `property.deleted`.

  // Actual code
  export const deleteProperty = ...
  ```

- **Rule:** D12 — CONTEXT.md must match actual code names.
- **Fix:** Either rename the export to `softDeleteProperty` (and all related types) to match documentation, or update CONTEXT.md to say `deleteProperty`. Given the hard-delete reality (B1), the name should probably be `hardDeleteProperty` throughout.

### M6. [D3] deleteProperty type naming doesn't follow {Name}Input/{Name}Deps/{Name} convention

The use case exports `DeletePropertyInput`, `DeletePropertyDeps`, `DeletePropertyUseCase` but the D3 standard requires `{Name}Input`, `{Name}Deps`, `{Name}` where `{Name}` matches the function name. The function is `deleteProperty` so types should be `DeletePropertyInput`, `DeletePropertyDeps`, `DeleteProperty` (or `SoftDeletePropertyInput` etc. to match CONTEXT.md). The exported type alias is `DeletePropertyUseCase` instead of `DeleteProperty`.

- **File:** `src/contexts/property/application/use-cases/soft-delete-property.ts:12,19,52`
- **Quote:**
  ```
  export type DeletePropertyDeps = Readonly<{ ... }>
  export type DeletePropertyInput = Readonly<{ ... }>
  export type DeletePropertyUseCase = ReturnType<typeof deleteProperty>
  ```
- **Rule:** D3 — three exported types: `{Name}Input`, `{Name}Deps`, `{Name}`.
- **Fix:** Rename `DeletePropertyUseCase` to `DeleteProperty` (or `SoftDeleteProperty` depending on B1 resolution). The other use cases follow the convention correctly (e.g., `CreateProperty`, `UpdateProperty`, `GetProperty`, `ListProperties`).

---

## MINOR

### m1. [D5] findByGbpPlaceId and findBySlug on port lack organizationId parameter

`PropertyRepository.findByGbpPlaceId(gbpPlaceId)` and `findBySlug(slug)` don't take `organizationId`, creating cross-tenant lookups. This is documented as intentional (webhook resolution, public portal) but the port should note the exception explicitly.

- **File:** `src/contexts/property/application/ports/property.repository.ts:28-31`
- **Quote:**
  ```
  findByGbpPlaceId: (gbpPlaceId: string) => Promise<Property | null>
  findBySlug: (slug: string) => Promise<Property | null>
  ```
- **Rule:** D7 — every query on tenant-owned table should include organizationId. D5 — exceptions should be documented.
- **Fix:** Add JSDoc comments explicitly noting these are intentional cross-tenant exceptions and why (e.g., `/** Cross-tenant lookup — used by integration context for webhook resolution where orgId is not yet known. */`).

### m2. [D15] PropertyImportConflict doc comment says "Thrown" but it's not an Error subclass

The JSDoc says "Thrown by importProperty..." but `PropertyImportConflict` is a plain tagged object `{ _tag, message }`, not an `Error` subclass. While `throw` works with any value in JS, the documentation is misleading.

- **File:** `src/contexts/property/application/public-api.ts:30`
- **Quote:**
  ```
  /** Thrown by importProperty when a unique-constraint violation occurs (e.g. duplicate gbpPlaceId). */
  export type PropertyImportConflict = Readonly<{ ... }>
  ```
- **Rule:** D15 — consistent error handling; documentation should match implementation.
- **Fix:** Change to "Returned as a rejection value by importProperty..." or simply "Signaled by importProperty...".

### m3. [D4] importProperty catch block checks PostgreSQL-specific error code in composition root

The `importProperty` catch block checks for PostgreSQL error code `'23505'` (unique constraint violation). This ties the composition root to a specific database driver's error shape.

- **File:** `src/contexts/property/build.ts:134-137`
- **Quote:**
  ```
  const isPg23505 =
    err instanceof Error && 'code' in err && (err as { code: string }).code === '23505'
  ```
- **Rule:** D4 — composition root should abstract infrastructure details.
- **Fix:** Consider adding a `isUniqueConstraintViolation(err)` helper to the infrastructure layer repository or a shared utility, keeping DB-specific knowledge out of build.ts.

### m4. [D3/D4] File name soft-delete-property.ts contradicts hard-delete implementation

The file is named `soft-delete-property.ts` but the implementation does hard-delete. The file comment (line 1) correctly says "hard-delete" but the file name is misleading.

- **File:** `src/contexts/property/application/use-cases/soft-delete-property.ts:1`
- **Quote:**
  ```
  // Property context — hard-delete property use case
  ```
- **Rule:** D3 — naming consistency between file names and behavior.
- **Fix:** Rename file to `delete-property.ts` or `hard-delete-property.ts` to match actual behavior (pending B1 resolution).

---

## NIT

### n1. [D11] node:assert/strict import in domain/events.ts

Domain events import `node:assert/strict` for constructor validation. While assert is a Node built-in (not a framework), it's a runtime dependency in the domain layer.

- **File:** `src/contexts/property/domain/events.ts:4`
- **Quote:**
  ```
  import assert from 'node:assert/strict'
  ```
- **Rule:** D11 — domain should avoid runtime dependencies beyond shared/domain.
- **Fix:** Low priority. Consider replacing with a simple `if (!(args.occurredAt instanceof Date)) throw new Error(...)` or a shared domain assertion utility.

### n2. Empty repos object in build.ts return value

The build function returns `repos: {} as const` — the repos are not exposed through the internal API.

- **File:** `src/contexts/property/build.ts:154`
- **Quote:**
  ```
  return { publicApi, internal: { repos: {} as const, useCases } } as const
  ```
- **Rule:** D4 — composition root should expose what consumers need; dead code should be removed.
- **Fix:** Either remove `repos` from the return type if nothing consumes it, or wire it if other contexts need direct repo access.

### n3. PropertySlugLookupResult and PropertyLookupResult use plain string instead of branded IDs

`PropertySlugLookupResult.id` and `PropertyLookupResult.id` are `string` rather than `PropertyId`. This is likely intentional for cross-context API simplicity but creates a type boundary that's worth noting.

- **File:** `src/contexts/property/application/public-api.ts:9-18`
- **Quote:**
  ```
  export type PropertySlugLookupResult = Readonly<{ id: string; organizationId: string }>
  export type PropertyLookupResult = Readonly<{ id: string; organizationId: string; ... }>
  ```
- **Rule:** D5 — domain-generated IDs; D11 — branded IDs prevent accidental substitution.
- **Fix:** Low priority. Intentional cross-context simplification. If consumers cast back to branded IDs, consider using the branded types directly.
