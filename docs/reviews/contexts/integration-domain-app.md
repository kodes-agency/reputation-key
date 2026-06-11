# Integration Context — Domain & Application Layer Review

**Reviewer:** Agent (IntegrationDomainApp)
**Date:** 2026-06-10
**Scope:** `src/contexts/integration/domain/`, `src/contexts/integration/application/`, `src/contexts/integration/build.ts`
**Dimensions:** D2, D3, D4, D11, D12, D15

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 3     |
| MAJOR    | 6     |
| MINOR    | 5     |
| NIT      | 3     |

---

## Findings

### [D12] [BLOCKER] `integration.property_import.completed` event defined but never emitted

- **File:** `src/contexts/integration/domain/events.ts:52-74`
- **Quote:**
  ```
  export type IntegrationPropertyImportCompleted = Readonly<{
    _tag: 'integration.property_import.completed'
    ...
  }>
  export const integrationPropertyImportCompleted = (...)
  ```
- **Rule:** CONTEXT.md §Events produced claims `integration.property_import.completed` is emitted when an import job finishes. D2 §4-layer consistency requires definition → constructor → union → handler.
- **Fix:** Emit `integrationPropertyImportCompleted` in `importProperty` use case after finalizing the job status (line ~197). Or remove from CONTEXT.md and the union if deliberately deferred.

### [D12] [BLOCKER] CONTEXT.md `GbpImportJobStatus` lifecycle does not match actual status values

- **File:** `src/contexts/integration/CONTEXT.md:12`
- **Quote:**
  ```
  Status: `pending` → `processing` → `completed` (or `failed`)
  ```
- **Actual** (`src/contexts/integration/domain/types.ts:49-56`):
  ```typescript
  export type GbpImportJobStatus =
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'completed_with_skips'
    | 'completed_with_failures'
  ```
- **Rule:** D12 — CONTEXT.md claims must match actual code. The CONTEXT.md uses wrong names (`pending`/`processing`) and omits two terminal statuses.
- **Fix:** Update CONTEXT.md to: `Status: 'queued' → 'in_progress' → 'completed' | 'completed_with_skips' | 'completed_with_failures' | 'failed'`

### [D12] [BLOCKER] CONTEXT.md claims disconnect "nulls out property FKs" — actual code does not

- **File:** `src/contexts/integration/CONTEXT.md:85`
- **Quote:**
  ```
  disconnectGoogleAccount — Revoke tokens, clear caches, null out property FKs.
  ```
- **Actual** (`src/contexts/integration/application/use-cases/disconnect-google-account.ts:67-71`): disconnect only calls `updateStatus('disconnected')` and `cacheRepo.deleteByConnectionId`. No FK cleanup.
- **Rule:** D12 — CONTEXT.md claims must match actual code.
- **Fix:** Either add property FK cleanup to the disconnect flow (call `connectionRepo.delete` which includes FK cleanup, or call a FK cleanup port), or update CONTEXT.md to reflect current behavior (no FK nulling on disconnect — only on delete).

### [D4] [MAJOR] `handleGbpNotification` use case not wired in build.ts

- **File:** `src/contexts/integration/build.ts` (entire file)
- **Quote:** `handleGbpNotification` is imported in `use-cases/index.ts` but absent from `build.ts`.
- **Rule:** D4 — build function must wire all use cases. CONTEXT.md §Architecture layers lists it under use-cases.
- **Fix:** Wire `handleGbpNotification` in `buildIntegrationContext`, passing `propertyLookup`, `reviewQueue`, and `logger` deps.

### [D2] [MAJOR] Event tag `integration.google_connection.visibility_changed` uses underscores in verb segment

- **File:** `src/contexts/integration/domain/events.ts:76-84`
- **Quote:**
  ```typescript
  export type IntegrationGoogleConnectionVisibilityChanged = Readonly<{
    _tag: 'integration.google_connection.visibility_changed'
  ```
- **Rule:** D2 §Tag naming: `context.entity.verb` — no hyphens. Underscores in the entity segment (`google_connection`) and verb segment (`visibility_changed`) are inconsistent with other events which use dots and underscores differently. The tag is `visibility_changed` (underscore in verb) vs `connected`/`disconnected` (no underscore). Not a strict violation if the rule only bans hyphens, but inconsistent.
- **Fix:** Consider renaming to `integration.google_connection.visibility.updated` for consistency with the `verb` convention. Otherwise document that multi-word verbs use underscores.

### [D3] [MAJOR] `startPropertyImport` uses `crypto.randomUUID()` directly instead of injected `idGen`

- **File:** `src/contexts/integration/application/use-cases/start-property-import.ts:59`
- **Quote:**
  ```typescript
  const importJobId = gbpImportJobId(crypto.randomUUID())
  ```
- **Rule:** D3 — use cases should receive dependencies through deps parameter. D11 — IDs via IdGenerator port. `connectGoogleAccount` correctly uses `deps.idGen()`.
- **Fix:** Add `idGen: () => string` to `StartPropertyImportDeps`, use `deps.idGen()` instead of `crypto.randomUUID()`. Wire in `build.ts`.

### [D3] [MAJOR] `listGoogleConnections` use case has no `Input` type exported

- **File:** `src/contexts/integration/application/use-cases/list-google-connections.ts:17-19`
- **Quote:**
  ```typescript
  export const listGoogleConnections =
    (deps: ListGoogleConnectionsDeps) =>
    async (ctx: AuthContext): Promise<ReadonlyArray<GoogleConnection>> => {
  ```
- **Rule:** D3 — three exported types: `{Name}Input`, `{Name}Deps`, `{Name}`. This use case has `ListGoogleConnectionsDeps` and `ListGoogleConnections` but no `ListGoogleConnectionsInput`. The barrel `index.ts` also doesn't export it.
- **Fix:** Either define `export type ListGoogleConnectionsInput = void` and re-export it, or document this as the accepted pattern for zero-input use cases (no action needed if the convention explicitly exempts void-input use cases).

### [D15] [MAJOR] Use cases throw `integrationError` objects instead of using Result type

- **File:** Multiple use cases, e.g. `src/contexts/integration/application/use-cases/disconnect-google-account.ts:34-38`
- **Quote:**
  ```typescript
  throw integrationError('forbidden', 'You do not have permission to manage integrations')
  ```
- **Rule:** D15 — no `throw new Error` in domain/application. The domain constructors correctly use `ok`/`err` Result types, but the application use cases `throw integrationError(...)` as plain objects (not `Error` instances). This works at runtime but mixes Result-returning and throwing patterns.
- **Fix:** Either adopt a consistent Result return type across all use cases (return `err(integrationError(...))`) or document that application-layer throws of tagged error objects are the accepted pattern for this project.

### [D3] [MAJOR] `importProperty` use case doesn't take `AuthContext` — cannot authorize

- **File:** `src/contexts/integration/application/use-cases/import-property.ts:96-98`
- **Quote:**
  ```typescript
  export const importProperty =
    (deps: ImportPropertyDeps) =>
    async (input: ImportPropertyInput): Promise<ImportPropertyResult> => {
  ```
- **Rule:** D3 — use cases should follow: Authorize → Load → Check rules → Build → Persist → Emit → Return. This use case has no authorization step (no `AuthContext`, no `can()` check). It runs as a background job, which is a valid exception, but should be documented.
- **Fix:** Document in the use case header comment that this runs as a background job and authorization is performed at the `startPropertyImport` entry point.

### [D5] [MINOR] `GbpCacheRepository.deleteByProperty` uses untyped `string` for `orgId`

- **File:** `src/contexts/integration/application/ports/gbp-cache.repository.ts:15`
- **Quote:**
  ```typescript
  deleteByProperty: (propertyId: PropertyId, orgId: string) => Promise<void>
  ```
- **Rule:** D5 — ports should use branded domain types. Same file uses `OrganizationId` for other methods (line 17).
- **Fix:** Change `orgId: string` to `orgId: OrganizationId`.

### [D5] [MINOR] `GbpQueuePort` and `ImportPropertyJobData` use plain strings instead of branded IDs

- **File:** `src/contexts/integration/application/ports/gbp-queue.port.ts:5-8`
- **Quote:**
  ```typescript
  export type ImportPropertyJobData = Readonly<{
    jobId: string
    organizationId: string
    connectionId: string
  ```
- **Rule:** D5 — domain-generated IDs should be branded. Queue data crossing boundaries loses type safety.
- **Fix:** Use branded types `GbpImportJobId`, `OrganizationId`, `GoogleConnectionId`. Serialize to strings only at the BullMQ boundary (in the adapter).

### [D5] [MINOR] `PropertyQueryPort` uses untyped `string` params instead of branded IDs

- **File:** `src/contexts/integration/application/ports/property-query.port.ts:10-16`
- **Quote:**
  ```typescript
  belongsToOrg: (propertyId: string, orgId: string) => Promise<boolean>
  findIdsByGoogleConnection: (connectionId: string, orgId: string) => Promise<...>
  ```
- **Rule:** D5 — ports should use branded domain types for type safety.
- **Fix:** Use `PropertyId`, `OrganizationId`, `GoogleConnectionId` branded types.

### [D5] [MINOR] `PropertyLookupPort` uses plain string types instead of branded IDs

- **File:** `src/contexts/integration/application/ports/property-lookup.port.ts:7-11`
- **Quote:**
  ```typescript
  export type PropertyLookup = Readonly<{
    id: string
    organizationId: string
    googleConnectionId: string | null
  }>
  ```
- **Rule:** D5 — ports should use branded domain types. The comment says "the webhook is push-based from Google, not tenant-initiated" — but the return type should still use branded IDs for downstream type safety.
- **Fix:** Use `PropertyId`, `OrganizationId`, `GoogleConnectionId` branded types in the `PropertyLookup` result.

### [D12] [MINOR] CONTEXT.md §Architecture lists `handle-gbp-notification.ts` in use-cases/ but it's not wired in build.ts

- **File:** `src/contexts/integration/CONTEXT.md:63`
- **Quote:**
  ```
  handle-gbp-notification.ts
  ```
- **Rule:** D12 — architecture documentation should match reality.
- **Fix:** Wire the use case in `build.ts`, or if it's wired elsewhere (e.g., directly in the server route), document that exception in CONTEXT.md.

### [D2] [NIT] Event constructor tests use `_tag` prefix `property_import.completed` instead of full tag

- **File:** `src/contexts/integration/domain/events.test.ts:88`
- **Quote:**
  ```typescript
  it('sets _tag to "property_import.completed"', () => {
  ```
- **Rule:** D2 — 4-layer consistency. The test description says `property_import.completed` but the actual tag is `integration.property_import.completed`.
- **Fix:** Update test description to `'sets _tag to "integration.property_import.completed"'`.

### [D2] [NIT] Event constructors use `crypto.randomUUID()` directly instead of injected `IdGenerator`

- **File:** `src/contexts/integration/domain/events.ts:26`
- **Quote:**
  ```typescript
  eventId: crypto.randomUUID(),
  ```
- **Rule:** D2 §Envelope fields — `eventId` should use `IdGenerator` port for testability. D11 — UUID via IdGenerator. Every constructor repeats `crypto.randomUUID()` on line 26, 46, 70, 94.
- **Fix:** Accept an `idGen?: () => string` parameter, defaulting to `crypto.randomUUID`. This is a minor point since event constructors are in the domain layer and `crypto` is a Node.js built-in, but it improves testability.

### [D12] [NIT] CONTEXT.md §Public API omits `GbpCacheEntry` / `GbpCacheDataType` from exports

- **File:** `src/contexts/integration/CONTEXT.md:99`
- **Quote:**
  ```
  Types: GoogleConnectionDto, GoogleConnectionStatus, GoogleConnectionVisibility, GbpLocation, GbpImportJob, GbpImportJobStatus
  ```
- **Rule:** D12 — CONTEXT.md public API should match `public-api.ts` exports. `public-api.ts` only exports what's listed, so this is accurate. However, `GbpCacheEntry` and `GbpCacheDataType` are not re-exported — by design, but worth noting for completeness.
- **Fix:** No action needed. Current exports are correct per the documented list.
