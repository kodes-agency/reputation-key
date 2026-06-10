# Portal Context — Infrastructure & Server Review

**Date:** 2026-06-10
**Scope:** `src/contexts/portal/infrastructure/`, `src/contexts/portal/server/`
**Dimensions:** D5 (Repository Ports), D7 (Multi-Tenancy), D8 (Server Functions), D12 (CONTEXT.md Accuracy), D15 (Error Handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 1     |
| MAJOR    | 5     |
| MINOR    | 4     |
| NIT      | 3     |

---

## Findings

### [D7] BLOCKER `resolvePortalContext` has no organizationId filter — tenant data leak

```
File:  src/contexts/portal/infrastructure/repositories/portal.repository.ts:173-191
Quote: resolvePortalContext: async (portalIdParam) => {
         const rows = await db
           .select({
             organizationId: portals.organizationId,
             propertyId: portals.propertyId,
           })
           .from(portals)
           .where(eq(portals.id, unbrand(portalIdParam)))
           .limit(1)
```

**Rule:** D7 — Every DB query on tenant-owned table must include organizationId. Port signature (line 64–66 of the port) takes only `portalIdParam` and no `orgId`, so the implementation cannot scope by tenant.

**Fix:** Intentional by design (public API for guest context — portal ID acts as capability token), but the port should be annotated with an explicit opt-out comment and the port interface should be named to make the public/unauthenticated nature clear (e.g., move to a separate `PublicPortalRepository` type or add a documented exemption). Currently the code has no comment explaining the tenant-scope bypass, which is a process risk during audits.

---

### [D15] MAJOR `throw new Error()` in process-image job — untagged error bypasses error envelope

```
File:  src/contexts/portal/infrastructure/jobs/process-image.job.ts:45-47
Quote: throw new Error(
         `Failed to download image: ${response.status} ${response.statusText}`,
       )
```

**Rule:** D15 — No `throw new Error` in domain/application; infrastructure jobs should use tagged errors or structured logging with re-throw. This bare `Error` has no `_tag`, no code, and will produce unstructured noise in error tracking.

**Fix:** Replace with `portalError('upload_failed', ...)` or a dedicated job error type with `_tag: 'JobError'` and a structured code field.

---

### [D15] MAJOR `Object.assign(new Error(...))` in `findPublicPortalBySlug` — ad-hoc error shape

```
File:  src/contexts/portal/infrastructure/repositories/portal.repository.ts:223-225
Quote: throw Object.assign(new Error('Portal is inactive'), {
         _tag: 'portal_inactive' as const,
       })
```

**Rule:** D15 — No bare `throw new Error` in domain/application layers; errors should use the context's tagged error constructor (`portalError()`). This creates an inconsistent error shape that is not caught by `isPortalError()` at the server boundary, meaning it will propagate as an untagged 500.

**Fix:** Use `portalError('portal_not_found', 'Portal is inactive')` or add `'portal_inactive'` as a new `PortalErrorCode` and use the standard constructor.

---

### [D15] MAJOR `portal-groups.ts` server uses `throw e` instead of `catchUntagged(e)` — inconsistent error handling

```
File:  src/contexts/portal/server/portal-groups.ts:63,88,117,146,171,201,226
Quote: throw e
```

**Rule:** D15 — Server functions should use `catchUntagged(e)` from `#/shared/auth/server-errors` for untagged errors, not raw `throw e`. Other server files (`portal-read.ts`, `portal-uploads.ts`, `portal-links.ts`, `portal-link-categories.ts`) all use `catchUntagged`. The `portal-groups.ts` file does not import `catchUntagged` at all (line 10 only imports `throwContextError`).

**Fix:** Import `catchUntagged` and replace all `throw e` with `throw catchUntagged(e)`.

---

### [D8] MAJOR Duplicate server function exports — `portals.ts` and `portal-uploads.ts` both export `requestUploadUrl`, `finalizeUpload`, `getPortalForQR`

```
File:  src/contexts/portal/server/portals.ts:196-280
       src/contexts/portal/server/portal-uploads.ts:28-104
Quote: // portals.ts line 196:
       export const requestUploadUrl = createServerFn({ method: 'POST' })
       // portal-uploads.ts line 28:
       export const requestUploadUrl = createServerFn({ method: 'POST' })
```

**Rule:** D8 — Server functions should be unique. Having the same server function defined in two files leads to registration conflicts in TanStack Start.

**Fix:** Remove the duplicate definitions from one file. The CONTEXT.md only lists `portals.ts, portal-links.ts, portal-groups.ts` — the split files (`portal-uploads.ts`, `portal-read.ts`, `portal-link-categories.ts`) appear to be the newer canonical locations. Remove the duplicated functions from `portals.ts`.

---

### [D8] MAJOR Duplicate server function exports — `portals.ts` and `portal-read.ts` both export `listPortals`, `getPortal`, `deletePortal`

```
File:  src/contexts/portal/server/portals.ts:108-179
       src/contexts/portal/server/portal-read.ts:25-96
Quote: // portals.ts line 108:
       export const listPortals = createServerFn({ method: 'GET' })
       // portal-read.ts line 25:
       export const listPortals = createServerFn({ method: 'GET' })
```

**Rule:** D8 — Same as above. Duplicate registration will cause runtime conflicts.

**Fix:** Remove the CRUD functions from `portals.ts` that are now in `portal-read.ts`. Keep `portals.ts` as only the error-status helper and the `createPortal`/`updatePortal` write functions.

---

### [D7] MINOR `findPublicPortalBySlug` queries categories and links without organizationId filter

```
File:  src/contexts/portal/infrastructure/repositories/portal.repository.ts:236-246
Quote: const categories = await db
         .select()
         .from(portalLinkCategories)
         .where(eq(portalLinkCategories.portalId, portal.id))
       const links = await db
         .select()
         .from(portalLinks)
         .where(eq(portalLinks.portalId, portal.id))
```

**Rule:** D7 — Acceptable for the public API path (unauthenticated, portal ID as capability token), but the category/link queries are scoped only by `portalId` without `organizationId`. If a portal ID were leaked, this would expose links across tenant boundaries. Defense-in-depth would add orgId.

**Fix:** Add `eq(portalLinkCategories.organizationId, portal.organizationId)` and `eq(portalLinks.organizationId, portal.organizationId)` to the WHERE clauses. The `portal.organizationId` is already available from the prior query.

---

### [D5] MINOR `createPortalGroupRepository` update uses snake_case column names in setValues

```
File:  src/contexts/portal/infrastructure/repositories/portal-group.repository.ts:73-74
Quote: if (patch.name !== undefined) setValues['name'] = patch.name
       if (patch.sortKey !== undefined) setValues['sortKey'] = patch.sortKey
       if (patch.updatedAt !== undefined) setValues['updatedAt'] = patch.updatedAt
```

**Rule:** D5 — The portal-group repository uses `Record<string, unknown>` for `setValues` with camelCase keys (`sortKey`, `updatedAt`), but the portal repository (line 117-129) uses a typed `SetValues` interface. Inconsistent patterns between repositories increase maintenance burden. The `name` key is fine, but `sortKey`/`updatedAt` should be verified against the Drizzle column names — if the schema uses `snake_case` column mapping, these would silently no-op.

**Fix:** Use a typed interface (like portal repository's `SetValues`) and verify column name mapping matches the Drizzle schema.

---

### [D15] MINOR `portals.ts` upload handlers fabricate error objects instead of using domain constructor

```
File:  src/contexts/portal/server/portals.ts:213-217
Quote: throwContextError(
         'PortalError',
         { code: 'upload_failed', message: 'Upload request failed' },
         422,
       )
```

**Rule:** D15 — The catch block fabricates a `{ code, message }` object inline instead of using `portalError('upload_failed', ...)`. This bypasses the domain error constructor and may diverge from the `PortalError` shape (missing `_tag`).

**Fix:** Use `portalError('upload_failed', 'Upload request failed')` and pass that to `throwContextError`.

---

### [D12] MINOR CONTEXT.md server file listing is incomplete

```
File:  src/contexts/portal/CONTEXT.md:84
Quote: server/              portals.ts, portal-links.ts, portal-groups.ts
```

**Rule:** D12 — CONTEXT.md claims server layer contains only `portals.ts`, `portal-links.ts`, `portal-groups.ts`. Actual files include `portal-uploads.ts`, `portal-read.ts`, `portal-link-categories.ts` (plus test files). The documentation is stale after the file split.

**Fix:** Update CONTEXT.md line 84 to:

```
server/              portals.ts, portal-links.ts, portal-link-categories.ts,
                     portal-groups.ts, portal-uploads.ts, portal-read.ts
```

---

### [D12] NIT CONTEXT.md use case name mismatch — `softDeletePortalGroup` vs `deletePortalGroup`

```
File:  src/contexts/portal/CONTEXT.md:103
Quote: softDeletePortalGroup — Soft-delete a group, emits portal_group.deleted.
```

**Rule:** D12 — CONTEXT.md lists the use case as `softDeletePortalGroup`, but the actual file is `delete-portal-group.ts` exporting `deletePortalGroup`. The server function and build.ts use `softDeletePortalGroup` as the composition key. The naming is internally consistent in code but the use case filename does not match.

**Fix:** Rename `application/use-cases/delete-portal-group.ts` to `soft-delete-portal-group.ts` and update the export name accordingly, or update CONTEXT.md to match the actual naming.

---

### [D5] NIT Portal group repository `addPortal` transaction deletes without orgId filter on `portalGroupId`

```
File:  src/contexts/portal/infrastructure/repositories/portal-group.repository.ts:100-107
Quote: await tx
         .delete(portalGroupMembers)
         .where(
           and(
             eq(portalGroupMembers.portalId, unbrand(portalId)),
             eq(portalGroupMembers.organizationId, unbrand(orgId)),
           ),
         )
```

**Rule:** D5 — The cleanup delete filters by `portalId` + `organizationId` but not by `groupId`. If a portal were erroneously in two groups (despite the unique constraint), this would delete both memberships. The subsequent insert targets the correct group.

**Fix:** Add `eq(portalGroupMembers.portalGroupId, unbrand(groupId))` to the cleanup WHERE clause for precision.

---

### [D8] NIT `portal-links.ts` re-exports domain rule function — minor layer boundary concern

```
File:  src/contexts/portal/server/portal-links.ts:20
Quote: export { isValidExternalUrl } from '../domain/rules'
```

**Rule:** D8/D1 — Server layer re-exporting from domain is technically a layer concern. The comment says "boundary compliance" but it means route-layer consumers import from the server file rather than domain directly.

**Fix:** Acceptable if the re-export exists because routes cannot import from domain/ directly (build constraint). If not, remove and have consumers import from `domain/rules` directly.
