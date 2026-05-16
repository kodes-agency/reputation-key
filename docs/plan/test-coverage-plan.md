# Test Coverage Plan — reputation-key (port-louis)

**Goal:** Production-quality tests — not coverage numbers. Every test must catch a real bug if it breaks.

**Current state:** 84 test files, 719 tests, all passing. No coverage tooling installed.

**After completion:** ~120 test files, ~1,100+ tests, coverage thresholds enforced.

---

## Phase 1 — Integration Context (Zero → Full Coverage)

**33 new test files.** The entire integration context has zero tests — highest risk area.

### 1A. In-Memory Port Fakes (7 files) — Test Infrastructure

These are not test files themselves — they're fakes that use-case tests depend on. Follow the established pattern (`in-memory-portal-repo.ts`).

| #   | File                                                     | Port Interface                            | Key Behaviors to Model                                                                                                                                                                                         |
| --- | -------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/shared/testing/in-memory-google-connection-repo.ts` | `GoogleConnectionRepository` (11 methods) | Map by `id`, `isAccessible(orgId)`, visibility-based filtering in `listByOrganization` (admin sees all, non-admin sees org-visibility or own), `findByGoogleAccountId` uniqueness, `delete` removes from store |
| 2   | `src/shared/testing/in-memory-gbp-import-repo.ts`        | `GbpImportRepository` (7 methods)         | Map by `id`, org-scoped `findByOrganization`, `incrementImported/Skipped/Failed` mutate counters                                                                                                               |
| 3   | `src/shared/testing/in-memory-gbp-cache-repo.ts`         | `GbpCacheRepository` (5 methods)          | Map by compound key `propertyId+dataType`, `upsert` replaces or creates, `deleteByConnectionId` joins through property relationship                                                                            |
| 4   | `src/shared/testing/in-memory-google-oauth-port.ts`      | `GoogleOAuthPort` (3 methods)             | `exchangeCode` returns seeded tokens + userinfo, `refreshAccessToken` returns seeded result, `revokeToken` no-op (best-effort in prod too)                                                                     |
| 5   | `src/shared/testing/in-memory-token-encryption.ts`       | `TokenEncryptionPort` (2 methods)         | `encrypt` → prefix with `enc:`, `decrypt` → strip prefix. Deterministic for assertions                                                                                                                         |
| 6   | `src/shared/testing/in-memory-gbp-api-port.ts`           | `GbpApiPort` (4 methods)                  | Seeded accounts + locations maps. `listLocations` supports pagination via nextPageToken. Returns `createGbpApiError` for non-ok statuses                                                                       |
| 7   | `src/shared/testing/in-memory-gbp-queue-port.ts`         | `GbpQueuePort` (1 method)                 | `addBulkImportJob` records enqueued jobs in array for assertion                                                                                                                                                |

### 1B. Domain Layer Tests (5 files)

| #   | Test File                                               | Source             | Test Cases                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `src/contexts/integration/domain/rules.test.ts`         | `rules.ts`         | `isValidEmail`: valid (`a@b.c`), invalid (`no-at`, `""`, `@only`), unicode. `isValidVisibility`: `'private'` ok, `'organization'` ok, `'invalid'` rejected, `undefined` rejected                                                             |
| 9   | `src/contexts/integration/domain/constructors.test.ts`  | `constructors.ts`  | `buildGoogleConnection`: valid → ok with all fields; invalid email → err with `invalid_email`; invalid visibility → err with `invalid_visibility`. `buildGbpImportJob`: defaults (status='queued', all counters 0); custom fields propagated |
| 10  | `src/contexts/integration/domain/errors.test.ts`        | `errors.ts`        | `integrationError` creates correct shape (`_tag`, `code`, `message`). `isIntegrationError` true for tagged error, false for plain Error, false for null. All 11 error codes are valid                                                        |
| 11  | `src/contexts/integration/domain/gbp-api-error.test.ts` | `gbp-api-error.ts` | `createGbpApiError` returns Error instance. `_tag === 'GbpApiError'`. `operation`, `status`, `body` preserved. Message format. `instanceof Error` works                                                                                      |
| 12  | `src/contexts/integration/domain/events.test.ts`        | `events.ts`        | Each constructor (`googleAccountConnected`, `googleAccountDisconnected`, `googleConnectionVisibilityChanged`, `propertyImportCompleted`) sets correct `_tag`, preserves all payload fields, `occurredAt` is set                              |

### 1C. Use Case Tests (8 files)

Each follows the established pattern: `setup()` factory with in-memory deps, test authz → validation → business logic → side effects → event emission.

| #   | Test File                                                                             | Source                            | Test Cases                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | `src/contexts/integration/application/use-cases/connect-google-account.test.ts`       | `connect-google-account.ts`       | Happy path new connection created + event emitted. Forbidden role. OAuth exchange fails → propagates. Existing connection → reconnection path (updateReconnection called, event emitted). Token expiry calculated from `expiresIn`. Visibility passed through. Build error → throws      |
| 14  | `src/contexts/integration/application/use-cases/disconnect-google-account.test.ts`    | `disconnect-google-account.ts`    | Happy path: status updated, cache purged, event emitted. Forbidden. Not found. Already disconnected → early return (no side effects). Token revocation fails → continues (best-effort). All deps called correctly                                                                        |
| 15  | `src/contexts/integration/application/use-cases/refresh-google-token.test.ts`         | `refresh-google-token.ts`         | Token valid (> buffer) → returns as-is. Token expired → refreshes, encrypts, updates, returns updated. Not found → throws. Disconnected → throws. `expiresIn` propagated correctly                                                                                                       |
| 16  | `src/contexts/integration/application/use-cases/list-google-connections.test.ts`      | `list-google-connections.ts`      | Returns connections from repo. Passes correct `(orgId, userId, role)` to repo                                                                                                                                                                                                            |
| 17  | `src/contexts/integration/application/use-cases/list-gbp-locations.test.ts`           | `list-gbp-locations.ts`           | Happy path multi-account with deduplication by `gbpPlaceId`. Forbidden. Connection not found. Disconnected. Token refresh triggered when expired. Empty accounts → wildcard fallback call. Non-retryable error (401/403/429) propagates immediately. Retryable error → wildcard fallback |
| 18  | `src/contexts/integration/application/use-cases/start-property-import.test.ts`        | `start-property-import.ts`        | Happy path: job created + enqueued + returned. Forbidden. Connection not found. Disconnected. Empty locations → throws. Build error → throws. Queue receives correct data                                                                                                                |
| 19  | `src/contexts/integration/application/use-cases/get-import-status.test.ts`            | `get-import-status.ts`            | Returns job when found. `import_not_found` when not found                                                                                                                                                                                                                                |
| 20  | `src/contexts/integration/application/use-cases/update-connection-visibility.test.ts` | `update-connection-visibility.ts` | Happy path: visibility updated + event emitted. Forbidden. Not found. Event carries correct visibility                                                                                                                                                                                   |

### 1D. Repository Integration Tests (3 files)

Real Postgres, following `portal.repository.test.ts` pattern. Tenant isolation is non-negotiable.

| #   | Test File                                                                                   | Source                            | Test Cases                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21  | `src/contexts/integration/infrastructure/repositories/google-connection.repository.test.ts` | `google-connection.repository.ts` | Insert + findById roundtrip. findByGoogleAccountId uniqueness. listByOrganization: admin sees all, non-admin filtered. updateStatus. updateVisibility. updateTokens. updateReconnection. delete nulls property FK. Cross-org isolation |
| 22  | `src/contexts/integration/infrastructure/repositories/gbp-import.repository.test.ts`        | `gbp-import.repository.ts`        | Insert + findById. findByOrganization scoped. updateStatus transitions. incrementImported/Skipped/Failed counters. Cross-org isolation                                                                                                 |
| 23  | `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.test.ts`         | `gbp-cache.repository.ts`         | findByPropertyAndType. upsert creates new. upsert updates existing (conflict resolution). deleteByProperty org check. deleteByConnectionId via property join. deleteExpired removes stale entries                                      |

### 1E. Mapper Tests (3 files)

| #   | Test File                                                                          | Source                        | Test Cases                                                                                |
| --- | ---------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| 24  | `src/contexts/integration/infrastructure/mappers/google-connection.mapper.test.ts` | `google-connection.mapper.ts` | `fromRow` brands IDs, maps all fields, handles null optional fields. `toInsert` roundtrip |
| 25  | `src/contexts/integration/infrastructure/mappers/gbp-import.mapper.test.ts`        | `gbp-import.mapper.ts`        | `fromRow` maps all fields including status enum. `toInsert` roundtrip                     |
| 26  | `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.test.ts`         | `gbp-cache.mapper.ts`         | `fromRow` maps data + dataType. `toUpsert` includes all upsert fields                     |

### 1F. Server Function Tests (2 files)

Mock the use case. Test auth resolution, error code → HTTP status mapping, happy path response shape.

| #   | Test File                                                    | Source                  | Test Cases                                                                                                                                                             |
| --- | ------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27  | `src/contexts/integration/server/google-connections.test.ts` | `google-connections.ts` | `integrationErrorStatus` exhaustive mapping (all 11 codes). `getGoogleAuthUrl` state signing. Auth required for each endpoint. Error translation correct for each code |
| 28  | `src/contexts/integration/server/gbp-import.test.ts`         | `gbp-import.ts`         | Error code → status mapping. Auth required. Happy path returns expected shape                                                                                          |

### 1G. Fixtures (1 file update)

| #   | File                             | Action                                                                                                                      |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 29  | `src/shared/testing/fixtures.ts` | Add `buildTestGoogleConnection()`, `buildTestGbpImportJob()`, `buildTestGbpCacheEntry()`, `buildTestGbpLocation()` builders |

**Phase 1 total: 7 infrastructure + 5 domain + 8 use-case + 3 repo + 3 mapper + 2 server + 1 fixture = 29 new files**

---

## Phase 2 — Fill Gaps in Tested Contexts

**~15 new test files.** Covering missing pieces in guest, identity, and other contexts.

### 2A. Guest Context (5 files)

| #   | Test File                                                                             | Source                            | Test Cases                                                                                                 |
| --- | ------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 30  | `src/contexts/guest/domain/events.test.ts`                                            | `events.ts`                       | 4 constructors set correct `_tag`, preserve payload                                                        |
| 31  | `src/contexts/guest/application/use-cases/get-public-portal.test.ts`                  | `get-public-portal.ts`            | Returns portal when found. Throws `portal_not_found` when null                                             |
| 32  | `src/contexts/guest/application/use-cases/resolve-portal-context.test.ts`             | `resolve-portal-context.ts`       | Returns context when resolved. Throws `portal_not_found` when null                                         |
| 33  | `src/contexts/guest/infrastructure/mappers/guest.mapper.test.ts`                      | `guest.mapper.ts`                 | `scanEventToRow`, `ratingToRow`, `feedbackToRow` — each maps all fields, branded IDs unwrapped             |
| 34  | `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.test.ts` | `guest-interaction.repository.ts` | recordScan inserts. insertRating inserts. insertFeedback inserts. hasRated true/false. Cross-org isolation |

### 2B. Identity Context (6 files)

| #   | Test File                                                                      | Source                        | Test Cases                                                                                                                                  |
| --- | ------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 35  | `src/contexts/identity/domain/events.test.ts`                                  | `events.ts`                   | 4 constructors set correct `_tag`, preserve payload (role, orgId, userId etc.)                                                              |
| 36  | `src/contexts/identity/domain/errors.test.ts`                                  | `errors.ts`                   | `identityError` correct shape. `isIdentityError` type guard true/false. All 8 codes valid                                                   |
| 37  | `src/contexts/identity/application/use-cases/request-avatar-upload.test.ts`    | `request-avatar-upload.ts`    | Valid → returns URL. Invalid content type → `validation_error`. Oversized (5MB+) → `validation_error`. Key format `avatars/{userId}/{uuid}` |
| 38  | `src/contexts/identity/application/use-cases/request-org-logo-upload.test.ts`  | `request-org-logo-upload.ts`  | Valid → URL. Forbidden role. Invalid content type. Oversized. Key format `organizations/{orgId}/logo/{uuid}`                                |
| 39  | `src/contexts/identity/application/use-cases/finalize-avatar-upload.test.ts`   | `finalize-avatar-upload.ts`   | Valid → avatarUrl. Key not scoped to user → `forbidden`                                                                                     |
| 40  | `src/contexts/identity/application/use-cases/finalize-org-logo-upload.test.ts` | `finalize-org-logo-upload.ts` | Valid → logoUrl. Forbidden role. Key not scoped to org → `forbidden`                                                                        |

### 2C. Other Missing Domain Tests (3 files)

| #   | Test File                                        | Source            | Test Cases                                                            |
| --- | ------------------------------------------------ | ----------------- | --------------------------------------------------------------------- |
| 41  | `src/contexts/staff/domain/constructors.test.ts` | `constructors.ts` | `buildStaffAssignment` sets all fields. Optional teamId defaults null |
| 42  | `src/contexts/portal/domain/events.test.ts`      | `events.ts`       | 7 constructors set correct `_tag`, preserve payload                   |
| 43  | `src/contexts/property/domain/events.test.ts`    | `events.ts`       | 3 constructors set correct `_tag`, preserve payload                   |

### 2D. Additional Event Tests (3 files)

| #   | Test File                                     | Source          | Test Cases                                          |
| --- | --------------------------------------------- | --------------- | --------------------------------------------------- |
| 44  | `src/contexts/team/domain/events.test.ts`     | `events.ts`     | 3 constructors set correct `_tag`, preserve payload |
| 45  | `src/contexts/staff/domain/events.test.ts`    | `events.ts`     | 2 constructors set correct `_tag`, preserve payload |
| 46  | `src/contexts/identity/domain/events.test.ts` | (covered in 2B) | —                                                   |

**Note:** Event tests are mechanical but serve as living documentation and catch refactoring errors. If an event constructor adds validation logic in the future, the test already exists.

**Phase 2 total: 15 new files**

---

## Phase 3 — Coverage Tooling + Depth Review

### 3A. Coverage Infrastructure

| #   | Task                                         | Details                                                                                                                                                           |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Install `@vitest/coverage-v8`                | In iqaluit workspace (shared node_modules). Pin to match vitest version                                                                                           |
| —   | Add coverage config to `vitest.config.ts`    | `coverage: { provider: 'v8', reporter: ['text', 'lcov'], include: ['src/contexts/**', 'src/shared/**'], exclude: ['**/*.test.*', '**/index.ts', '**/types.ts'] }` |
| —   | Add coverage thresholds                      | `statements: 80, branches: 75, functions: 80, lines: 80`. These are floor values — raise as coverage grows                                                        |
| —   | Add `test:coverage` script to `package.json` | `"test:coverage": "vitest run --coverage"`                                                                                                                        |

### 3B. Depth Review of Existing Tests

Review existing test files for missing edge cases. This is a checklist review, not new files:

- [ ] Use cases: test concurrent operations (double-create, delete-then-read)
- [ ] Use cases: test null/optional fields (description null, theme null)
- [ ] Use cases: test empty arrays (no portals, no links, no teams)
- [ ] Repository tests: test update operations on soft-deleted entities
- [ ] Mapper tests: test null/undefined optional fields in both directions
- [ ] Error handling: verify error context is preserved (not just code/message)

### 3C. E2E Spec Review

Review the 9 existing Playwright specs for depth:

- [ ] Each spec covers the critical user flow end-to-end
- [ ] Error states are tested (not just happy path)
- [ ] Cross-tenant isolation verified at E2E level

---

## Execution Order

**Phase 1** is the bulk of the work. Execution within Phase 1 follows the dependency chain:

1. **Fixtures** (`1G`) — builders needed by everything
2. **In-memory fakes** (`1A`) — port implementations needed by use-case tests
3. **Domain tests** (`1B`) — pure unit, no deps, validate understanding
4. **Use-case tests** (`1C`) — depends on fakes + fixtures
5. **Mapper tests** (`1E`) — pure unit, no deps
6. **Repository tests** (`1D`) — integration, need DB, can run in parallel with above
7. **Server tests** (`1F`) — mock use cases, test HTTP layer

**Phase 2** can start once Phase 1 fixtures are stable. Guest and identity tests are independent of each other.

**Phase 3** runs last — install tooling, verify thresholds, depth review.

---

## Files Not Getting Tests (Intentional)

These are excluded with justification:

| Category                                   | Reason                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts` files                           | Pure type exports — no runtime code to test                                                                                                                                       |
| `index.ts` barrel files                    | Re-exports only — tested by consumers                                                                                                                                             |
| Port interfaces (`ports/*.ts`)             | TypeScript interfaces — no runtime code                                                                                                                                           |
| DTO schemas (Zod)                          | Validated implicitly through use-case and server-fn tests. Explicit DTO tests would be redundant unless schema has `.refine()` cross-field logic                                  |
| `build.ts` composition files               | Pure wiring — if a use case is tested, the wiring is implicitly correct                                                                                                           |
| Server fn wrappers without extracted logic | If a server fn is just `auth → validate → call use case`, the use-case test covers the logic. Server fn tests only added where there's custom logic (error mapping, HMAC signing) |

---

## Expected Outcome

| Metric                   | Before          | After                               |
| ------------------------ | --------------- | ----------------------------------- |
| Test files               | 84              | ~120                                |
| Test cases               | 719             | ~1,100+                             |
| Contexts with 0 coverage | 1 (integration) | 0                                   |
| Uncovered use cases      | 14              | 0                                   |
| Uncovered domain layers  | 13              | 0 (events: documented as pure data) |
| Uncovered repositories   | 4               | 0                                   |
| Uncovered mappers        | 4               | 0                                   |
| Coverage tooling         | None            | v8 provider + thresholds            |
