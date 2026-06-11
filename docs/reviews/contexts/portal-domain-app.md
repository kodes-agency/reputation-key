# Portal Context — Domain & Application Layer Review

**Reviewer:** automated code review
**Date:** 2026-06-10
**Scope:** `src/contexts/portal/domain/`, `src/contexts/portal/application/`, `src/contexts/portal/build.ts`
**Dimensions:** D2 (events), D3 (use cases), D4 (build function), D11 (domain purity), D12 (CONTEXT.md accuracy), D15 (error handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 1     |
| MAJOR    | 5     |
| MINOR    | 4     |
| NIT      | 3     |

---

## Findings

### [D2] [MAJOR] Event types missing `eventId` and `correlationId` envelope fields

**File:** src/contexts/portal/domain/events.ts:17-131
**Quote:**

```ts
export type PortalCreated = Readonly<{
  _tag: 'portal.created'
  portalId: PortalId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>
```

**Rule:** Event Standards — "Envelope fields: eventId, occurredAt, correlationId"
**Fix:** Add `eventId: string` and `correlationId: string` to every event type. Update constructors to accept and propagate these fields (or generate defaults).

---

### [D2] [NIT] Event constructors lack assertion validation for impossible states

**File:** src/contexts/portal/domain/events.ts:151-202
**Quote:**

```ts
export const portalCreated = (args: Omit<PortalCreated, '_tag'>): PortalCreated => ({
  _tag: 'portal.created',
  ...args,
})
```

**Rule:** Event Standards — "Constructor validation: assertions for impossible states"
**Fix:** Constructors are pure spread with no validation. Add at minimum a non-null assertion for required fields (portalId, organizationId, occurredAt) to fail fast on malformed calls.

---

### [D3] [MAJOR] Use cases throw portalError instead of returning Result

**File:** src/contexts/portal/application/use-cases/create-portal.ts:31-33
**Quote:**

```ts
if (!can(ctx.role, 'portal.create')) {
  throw portalError('forbidden', 'this role cannot create portals')
}
```

**Rule:** D15 Error Handling — "No throw in domain/application"; D3 Use Case Standards — "typed errors"
**Fix:** Use cases throughout the portal context use `throw portalError(...)` for all error paths. The domain layer correctly uses `Result<T, PortalError>`. The application layer should either return `Result` types or at minimum the throw-portalError pattern should be documented as an intentional application-layer convention. This affects every use case: create-portal, update-portal, get-portal, list-portals, soft-delete-portal, create-link, update-link, delete-link, create-link-category, update-link-category, delete-link-category, reorder-links, reorder-categories, request-upload-url, finalize-upload, create-portal-group, update-portal-group, soft-delete-portal-group, add-portal-to-group, remove-portal-from-group.

---

### [D3] [MINOR] `listPortalLinks` return type leaks repository types into use case contract

**File:** src/contexts/portal/application/use-cases/list-portal-links.ts:27-29
**Quote:**

```ts
): Promise<{
  categories: Awaited<ReturnType<PortalLinkRepository['listCategories']>>
  links: Awaited<ReturnType<PortalLinkRepository['listAllLinks']>>
}>
```

**Rule:** D3 Use Case Standards — "returns domain types"; D5 Port Standards — "adapter returns domain types"
**Fix:** Define an explicit return type or DTO rather than deriving from the repository port's method signature. This couples the use case's public contract to the port's internal shape.

---

### [D3] [MINOR] `deleteLink`, `deleteLinkCategory`, `reorderLinks`, `reorderCategories` do not emit deletion/reorder events for links and categories

**File:** src/contexts/portal/application/use-cases/delete-link.ts:35
**Quote:**

```ts
await deps.portalLinkRepo.deleteLink(ctx.organizationId, portalLinkId(input.linkId))
```

**Rule:** D3 Use Case Standards — "Persist → Emit events → Return"
**Fix:** `deleteLink` and `deleteLinkCategory` do not emit events after deletion, unlike other mutation use cases. CONTEXT.md does not define `portal_link.deleted` or `portal_link_category.deleted` events, so this may be intentional. However, this creates an inconsistency with the rest of the mutation use cases. If events are not needed, document this decision.

---

### [D4] [BLOCKER] Build function calls `getEnv()` directly — environment config not injected

**File:** src/contexts/portal/build.ts:39,55
**Quote:**

```ts
import { getEnv } from '#/shared/config/env'
...
const env = getEnv()
```

**Rule:** D4 Build Function — composition root should receive all configuration as injected dependencies; domain/application layers must not access `process.env` or config modules directly
**Fix:** Move `getEnv()` to the caller of `buildPortalContext` and pass the required env values (AWS keys, bucket, region) as typed fields of `PortalContextDeps`. The build function is part of the composition root and importing `getEnv` couples it to a specific config mechanism, making testing harder.

---

### [D4] [MAJOR] `linkIdGen` in build.ts returns raw `string`, not branded `PortalLinkId`

**File:** src/contexts/portal/build.ts:64
**Quote:**

```ts
const linkIdGen = () => randomUUID()
```

**Rule:** D5 Port Standards — "Domain-generated IDs"
**Fix:** Use `portalLinkId(randomUUID())` to return a branded ID consistent with `portalIdGen` and `portalGroupIdGen` on lines 62-63. The `CreateLinkCategoryDeps.idGen` and `CreateLinkDeps.idGen` are typed as `() => string`, which also need updating to `() => PortalLinkCategoryId` / `() => PortalLinkId` respectively, with the constructors wrapping the raw UUID.

---

### [D4] [MAJOR] Build function imports `randomUUID` from `crypto` directly

**File:** src/contexts/portal/build.ts:40
**Quote:**

```ts
import { randomUUID } from 'crypto'
```

**Rule:** D11 Domain Purity — "UUID via IdGenerator port"; D4 Build Function
**Fix:** The build function directly imports Node.js `crypto`. While the build function is at the composition root level (infrastructure), the `randomUUID` calls on lines 62-64 should ideally use an injected ID generator to allow test overrides. Currently the build function hardcodes `randomUUID` for `linkIdGen` and the `requestUploadUrl` idGen (`() => randomUUID()`).

---

### [D11] [NIT] `validateUrl` and `isValidExternalUrl` in rules.ts use bare `catch {}` blocks

**File:** src/contexts/portal/domain/rules.ts:99,109
**Quote:**

```ts
} catch {
  return err(portalError('invalid_url', 'Must be a valid URL'))
}
```

**Rule:** D15 Error Handling — "No bare catch"
**Fix:** The bare catch is defensible here (URL parsing is expected to fail on invalid input), but per the standard, add `catch (_e)` or `catch (_)` to make the discarded value explicit.

---

### [D11] [PASS] Domain layer is pure — no framework, I/O, or infrastructure imports

**File:** src/contexts/portal/domain/\*
**Verified:** All domain files import only from `#/shared/domain`, `./types`, `./errors`, `./rules`, and `neverthrow`. No React, TanStack, Drizzle, better-auth, fetch, process.env, or infrastructure imports detected.

---

### [D11] [PASS] Constructors use `Result` return type and accept time/ID as inputs

**File:** src/contexts/portal/domain/constructors.ts
**Verified:** `buildPortal`, `buildPortalGroup`, `buildPortalLinkCategory`, `buildPortalLink` all return `Result<T, PortalError>` and accept `now: Date` and branded IDs as inputs. No side effects.

---

### [D12] [MAJOR] Errors test claims 15 codes but errors.ts defines 19

**File:** src/contexts/portal/domain/errors.test.ts:62,73
**Quote:**

```ts
expect(codes).toHaveLength(15)
```

**Rule:** D12 CONTEXT.md accuracy / test completeness
**Fix:** The `PortalErrorCode` union in `errors.ts` defines 19 codes. The test's exhaustive check lists only 15, missing: `group_not_found`, `group_name_taken`, `portal_already_grouped`, `portal_not_in_group`. These were added for portal group support. Update the test array and the expected length to 19.

---

### [D12] [MAJOR] CONTEXT.md event list matches actual code — but `portal.updated` event lacks `propertyId`

**File:** src/contexts/portal/CONTEXT.md:42
**Quote:**

```
- **`portal.updated`** — portalId, organizationId, name, slug, occurredAt.
```

**Rule:** D12 CONTEXT.md accuracy
**Fix:** CONTEXT.md accurately lists all 12 event types matching the code. However, note that `portal.created` and `portal.updated` do not carry `propertyId` in their payloads, while `portal_group.created/updated/deleted` do. This asymmetry may be intentional (portal ID is enough to look up the property), but should be documented in CONTEXT.md if so.

---

### [D12] [MINOR] Duplicate DTO schemas in `portal-group.dto.ts` vs dedicated DTO files

**File:** src/contexts/portal/application/dto/portal-group.dto.ts:4-22
**Quote:**

```ts
export const createPortalGroupSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  name: z
    .string()
    .min(1, 'Group name is required')
    .max(100, 'Name must be at most 100 characters'),
})
export type CreatePortalGroupInput = z.infer<typeof createPortalGroupSchema>
```

**Rule:** D12 — architecture consistency
**Fix:** `portal-group.dto.ts` defines `CreatePortalGroupInput` and `UpdatePortalGroupInput` that overlap with the dedicated files `create-portal-group.dto.ts` and `update-portal-group.dto.ts`. The dedicated files are used by the use cases. The `portal-group.dto.ts` file also adds `DeletePortalGroupInput` and `ListPortalGroupsInput` schemas. Consolidate into one file per the architecture convention, or remove the duplicates.

---

### [D15] [PASS] No `throw new Error` in production domain/application code

**Verified:** `throw new Error` only appears in test files (`create-portal-group.test.ts`, `create-portal.test.ts`), never in production code. All errors use `portalError(...)` smart constructor.

---

### [D15] [PASS] Domain errors use tagged union pattern consistently

**File:** src/contexts/portal/domain/errors.ts
**Verified:** `PortalError` is a tagged readonly type with `_tag: 'PortalError'`, `code: PortalErrorCode`, `message: string`, and optional `context`. Type guard `isPortalError` provided. No HTTP codes in domain errors.

---

### [D5] [MINOR] `linkResolverPort.resolveLinkById` does not take `organizationId` parameter

**File:** src/contexts/portal/application/ports/link-resolver.port.ts:15
**Quote:**

```ts
resolveLinkById: (linkId: string) => Promise<ResolvedLinkInfo | null>
```

**Rule:** D5 Repository/Port Standards — "Every method takes organizationId as first parameter"; D7 Multi-Tenancy
**Fix:** `resolveLinkById` accepts only a `linkId` string without `organizationId`. This means the link resolver cannot enforce tenant isolation at the port level. The link ID may act as a capability token (similar to `resolvePortalContext`), but this exception should be documented. Also, the parameter is an unbranded `string` not a `PortalLinkId`.

---

### [D3] [NIT] `getPortalQrUrl` input type not exported as separate named type

**File:** src/contexts/portal/application/use-cases/get-portal-qr-url.ts:10-12
**Quote:**

```ts
export type GetPortalQrUrlInput = Readonly<{
  portalId: string
}>
```

**Rule:** D3 Use Case Standards — "Three exported types: {Name}Input, {Name}Deps, {Name}"
**Fix:** All three types are exported. This is correct. Minor note: the return type is an inline `{ portalUrl: string; slug: string }` rather than a named type, but this is acceptable for a simple query result.
