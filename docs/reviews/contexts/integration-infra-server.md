# Integration Context — Infrastructure & Server Layer Review

**Reviewer:** automated deep review  
**Date:** 2026-06-10  
**Scope:** `src/contexts/integration/infrastructure/`, `src/contexts/integration/server/`  
**Dimensions:** D5 (Repository Ports), D7 (Multi-Tenancy), D8 (Server Functions), D12 (CONTEXT.md Accuracy), D15 (Error Handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 1     |
| MAJOR    | 5     |
| MINOR    | 4     |
| NIT      | 2     |

---

## Findings

### [D8] [BLOCKER] disconnectGoogle and updateConnectionVisibility missing permission checks

File: src/contexts/integration/server/google-connections.ts:93-106,118-131
Quote:

```
export const disconnectGoogle = createServerFn({ method: 'POST' })
  .inputValidator(disconnectGoogleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const connection = await useCases.disconnectGoogleAccount(data, ctx)
```

Rule: D8 — Server functions must include auth middleware, input validation, permission check. `connectGoogle`, `listGoogleConnections`, and `getGoogleAuthUrl` all check `can(ctx.role, 'integration.manage')` before proceeding. `disconnectGoogle` and `updateConnectionVisibility` resolve tenant context but never call `can()`. Any authenticated user can disconnect or modify visibility of any connection in their org.
Fix: Add the same `can(ctx.role, 'integration.manage')` guard before the try block in both handlers.

---

### [D8] [MAJOR] startPropertyImport checks integration.manage instead of property.create

File: src/contexts/integration/server/gbp-import.ts:59-82
Quote:

```
if (!can(ctx.role, 'integration.manage')) {
  throwContextError(
    'AuthError',
    {
      code: 'forbidden',
      message: 'Insufficient permissions to manage integrations',
    },
    403,
  )
}
```

Rule: CONTEXT.md §Permissions — `startPropertyImport` is documented as requiring `property.create` (cross-context permission from property context). The implementation checks `integration.manage` instead. This may grant too-broad or too-narrow access depending on role-permission mappings.
Fix: Change the permission check to `can(ctx.role, 'property.create')` to match CONTEXT.md, or update CONTEXT.md to reflect the actual permission used.

---

### [D5] [MAJOR] gbp-cache port deleteByProperty uses raw string for orgId instead of branded OrganizationId

File: src/contexts/integration/application/ports/gbp-cache.repository.ts:15
Quote:

```
deleteByProperty: (propertyId: PropertyId, orgId: string) => Promise<void>
```

Rule: D5 — Ports should use domain-generated IDs and branded types. `deleteByProperty` accepts `orgId: string` while `findByPropertyAndType` correctly uses `organizationId: OrganizationId`. Similarly, `deleteByConnectionId` accepts `connectionId: string` instead of `GoogleConnectionId`.
Fix: Change to `(propertyId: PropertyId, orgId: OrganizationId)` and `(connectionId: GoogleConnectionId, orgId: OrganizationId)`.

---

### [D7] [MAJOR] gbp-import.repository insert does not include organizationId in WHERE clause

File: src/contexts/integration/infrastructure/repositories/gbp-import.repository.ts:35-38
Quote:

```
insert: async (job) => {
  return trace('gbpImport.insert', async () => {
    await db.insert(gbpImportJobs).values(gbpImportJobToInsert(job))
  })
},
```

Rule: D7 — Every mutation on tenant-owned tables must include organizationId. While INSERTs implicitly carry orgId from the job domain object, the pattern is inconsistent with other methods that explicitly use orgId in WHERE. This is acceptable for INSERT (values come from domain) but worth noting — if the job object were ever constructed without orgId, the row would be orphaned. No actual leak risk since orgId is a required field in the domain constructor.
Fix: No code change required for INSERT — domain constructor enforces orgId. Document the rationale.

---

### [D12] [MAJOR] CONTEXT.md server functions claim "handle webhook" but no webhook server function exists

File: src/contexts/integration/CONTEXT.md:103
Quote:

```
- **`google-connections.ts`** — Server functions for Google connection CRUD (connect, disconnect, list, update visibility, list locations, start import, get import status, handle webhook).
```

Rule: D12 — CONTEXT.md claims must match actual code. The phrase "handle webhook" is listed in `google-connections.ts` server functions but no webhook server function exists in that file. The actual webhook handling is done through `infrastructure/handlers/gbp-notification-handler.ts` (called from a file route, not a createServerFn). Additionally, `gbp-import.ts` is not mentioned in the `google-connections.ts` line despite sharing some import-related functions.
Fix: Remove "handle webhook" from the `google-connections.ts` description. Add a note about the webhook being handled via `infrastructure/handlers/gbp-notification-handler.ts` from a file route.

---

### [D12] [MAJOR] CONTEXT.md missing google-auth-url.ts server file

File: src/contexts/integration/CONTEXT.md:78
Quote:

```
server/              google-connections.ts, gbp-import.ts, error-helpers.ts
```

Rule: D12 — CONTEXT.md architecture listing must reflect actual files. `server/google-auth-url.ts` exists and exports `getGoogleAuthUrl` server function but is not listed in the architecture section or server functions section.
Fix: Add `google-auth-url.ts` to the architecture listing and server functions section.

---

### [D15] [MAJOR] gbp-cache.mapper throws bare Error for corrupt DB data

File: src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.ts:25-27
Quote:

```
if (result.isErr()) {
  throw new Error(`Invalid GBP cache entry from DB: ${result.error.message}`)
}
```

Rule: D15 — No `throw new Error` in infrastructure. Should use the tagged `IntegrationError` from domain/errors.ts or a dedicated infrastructure error type. This also leaks internal error details (the domain validation message) as an untagged error that bypasses the server function's `isIntegrationError` catch.
Fix: Use `integrationError('invalid_cache_entry', ...)` or create a tagged infrastructure error that the server layer can translate.

---

### [D15] [MINOR] token-encryption.adapter throws bare Error for invalid key/ciphertext

File: src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts:14,33
Quote:

```
throw new Error('Invalid encryption key configuration')
...
throw new Error('Invalid ciphertext format')
```

Rule: D15 — No bare `throw new Error`. These are adapter-level errors. The comment "F147: Sanitized error" suggests intentional error message sanitization, but the error is still untagged and won't be caught by `isIntegrationError` in server functions, leading to a generic 500.
Fix: Consider wrapping in `integrationError('encryption_error', ...)` for consistent handling at the server boundary. The encryption_error code already exists in `IntegrationErrorCode`.

---

### [D5] [MINOR] gbp-import.repository port has inconsistent parameter ordering vs implementation

File: src/contexts/integration/application/ports/gbp-import.repository.ts:12-19
Quote:

```
updateStatus: (
  id: GbpImportJobId,
  orgId: OrganizationId,
  status: GbpImportJobStatus,
) => Promise<void>
incrementImported: (id: GbpImportJobId, orgId: OrganizationId) => Promise<void>
```

Rule: D5 — Port convention is `orgId` as first parameter. The `GoogleConnectionRepository` port consistently takes `orgId` first. `GbpImportRepository` puts `id` first then `orgId`, which is inconsistent with the convention established by the google-connection port.
Fix: Reorder parameters to `(orgId, id, status)` for consistency with other ports.

---

### [D1] [MINOR] gbp-notification-handler imports getContainer directly — composition root awareness

File: src/contexts/integration/infrastructure/handlers/gbp-notification-handler.ts:7
Quote:

```
import { getContainer } from '#/composition'
```

Rule: D1 — Infrastructure imports domain + application + shared + external libs. `getContainer` is the global composition root. While not strictly a layer breach (infrastructure can access composition), this creates a hidden coupling where the handler depends on the global container rather than receiving its deps via factory function. This pattern differs from `import-property.job.ts` which receives deps via `createImportPropertyHandler(deps)`.
Fix: Refactor to use the same factory-deps pattern as the job handler for testability and consistency.

---

### [D11] [MINOR] gbp-api-error.ts carries HTTP status code in domain layer

File: src/contexts/integration/domain/gbp-api-error.ts:8
Quote:

```
export type GbpApiError = Readonly<{
  _tag: 'GbpApiError'
  operation: string
  status: number
  body: string
  message: string
}>
```

Rule: D11/D15 — Domain should not contain HTTP codes. `GbpApiError` stores `status: number` which is an HTTP status. However, this is in the domain layer. The status is used by the gbp-api adapter (infrastructure) and the google-review-api adapter to decide between `gbp_api_error` and `gbp_api_rate_limited` integration error codes. The type is only constructed in infrastructure and the error itself is never exposed directly to the server boundary.
Fix: Move `GbpApiError` to a shared infrastructure type or keep in domain but remove `status` field and let infrastructure decide the error code based on the raw response. Low priority since it's never serialized to the client.

---

### [D7] [NIT] gbp-cache deleteAllExpired intentionally skips tenant filter — correctly documented

File: src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:68-76
Quote:

```
/** System-level cleanup — no tenant filter by design. Scheduled job purges expired cache entries across all orgs. */
deleteAllExpired: async () => {
```

Rule: D7 — Every DB query on tenant-owned table has organizationId. This is an intentional exception (system cleanup job) with a clear doc comment. The port signature correctly does not accept orgId.
Fix: No fix needed — correctly documented exception.

---

### [D12] [NIT] CONTEXT.md mentions gbp-notification-handler but architecture listing omits event-handlers/ dir

File: src/contexts/integration/CONTEXT.md:70-76
Quote:

```
infrastructure/
  ...
  handlers/          gbp-notification-handler.ts
  ...
```

Rule: D12 — The `infrastructure/event-handlers/` directory exists with a README but is not listed in the architecture tree. Only `handlers/` (singular) is listed. This is technically accurate since event-handlers has no actual code, but the directory exists and should be noted.
Fix: Add `event-handlers/ (empty — no consumers)` to the architecture listing for completeness.

---

## Positive Observations

1. **Multi-tenancy is excellent.** Every SELECT/UPDATE/DELETE in `google-connection.repository.ts` and `gbp-import.repository.ts` uses `organizationId` in WHERE clauses. The `gbp-cache.repository.ts` correctly scopes all tenant-facing operations and documents the `deleteAllExpired` exception.

2. **Server functions follow the pattern consistently.** All use `tracedHandler`, `headersFromContext`, `resolveTenantContext`, and translate domain errors via `integrationErrorStatus`. The `connectGoogle`, `listGoogleConnections`, `getGoogleAuthUrl`, and all `gbp-import.ts` functions properly check permissions.

3. **Port-adapter separation is clean.** Repositories implement application port interfaces exactly. Mappers are pure functions. Adapters use factory patterns with typed deps.

4. **Cross-context access is properly mediated.** `property-import.repository.ts` delegates through `PropertyPublicApi` (ADR-0001 compliant). `gbp-cache.repository.ts` delegates property ownership checks to `PropertyQueryPort`.

5. **Error handling is largely consistent.** Domain uses tagged `IntegrationError` with closed union of error codes. Server layer maps via `ts-pattern` `.exhaustive()`. The `error-helpers.ts` status mapping covers all declared error codes.

6. **Events are well-structured.** Flat payloads, proper `eventId`/`occurredAt`/`correlationId` envelope, assertion-validated constructors, correct tag naming (`integration.entity.verb`).
