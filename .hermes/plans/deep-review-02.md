# Deep Review #2 — Bounded Context Boundaries Fix Plan

## Scope
Fix all relevant findings from the Bounded Context Boundaries review (6 BLOCKER, 3 MAJOR, 2 MINOR).
Outdated-doc/wontfix: B4 (Dashboard direct reads — acceptable for read-model), M1 (StoragePort — acceptable pattern).

## Tasks

### B1: Integration writes Property table directly
- **File:** `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts:170-178`
- **Fix:** Extract the FK cleanup into a port (`PropertyCleanupPort` or reuse `PropertyLookupPort`). Integration emits a request, Property context handles it. Short-term: move the query to a port implemented in composition.ts. Long-term: domain event.

### B2: Integration reads Property table (property-import.repo)
- **File:** `src/contexts/integration/infrastructure/repositories/property-import.repository.ts`
- **Fix:** The `PropertyImportRepo` port should be defined in integration/application/ports/. The implementation queries the Property table — acceptable in the adapter (it implements a port for integration's use case), but the direct schema import from `#/shared/db/schema` should go through Property's public API or a dedicated port. Wire in composition.ts.

### B3: Integration reads Property table (gbp-cache.repo)
- **File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`
- **Fix:** Same pattern as B2 — add a Property lookup port and delegate table access to Property context.

### B5: hasRole() in review reply-operations
- **File:** `src/contexts/review/application/use-cases/reply-operations.ts:20-24`
- **Fix:** Replace `hasRole(role, MANAGER_ROLE)` with `can(role, 'reply.manage')`. Add `reply.manage` permission to the permissions registry if not already present.

### B6: hasRole() in integration repository
- **File:** `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts:51`
- **Fix:** Move the role-based filtering to the use case layer. The repository should accept a pre-computed filter, not a Role.

### B7: Property domain unbranded FK
- **File:** `src/contexts/property/domain/types.ts:16`
- **Fix:** Change `googleConnectionId: string | null` to `googleConnectionId: GoogleConnectionId | null`. Import branded type.

### M2: StaffAssignment ownership conflict in docs
- **Files:** `CONTEXT.md`, `src/contexts/CONTEXT.md`
- **Fix:** Remove `StaffAssignment` from Team's Key Entities column.

### M3: Metric context undocumented
- **Files:** `CONTEXT.md`, `src/contexts/CONTEXT.md`
- **Fix:** Add Metric row to bounded-context tables.

### M4: Composition root queries Property table
- **File:** `src/composition.ts:194-206`
- **Fix:** Replace inline DB query with call to Property context's public API (`findByGbpPlaceId`). If Property doesn't expose this, add it to Property's application layer.

### m1: Missing context membership comments on Metric handlers
- **Fix:** Add `// Metric context — <purpose>` header comments to all 6 event handler files.

### m2: MetricReading unbranded string IDs
- **File:** `src/contexts/metric/domain/types.ts:12-14`
- **Fix:** Import branded types and replace `string` with `OrganizationId`, `PropertyId`, `PortalId | null`.

## Execution Order

1. **B5** (reply-operations hasRole) — quick permission fix
2. **B6** (integration repo hasRole) — move auth to use case
3. **B7** (unbranded FK) — quick type fix
4. **M2** (StaffAssignment docs) — quick doc fix
5. **M3** (Metric docs) — quick doc fix
6. **m1** (Metric handler comments) — quick fix
7. **m2** (MetricReading branded IDs) — quick type fix
8. **B1** (Integration writes Property table) — port extraction
9. **B2/B3** (Integration reads Property table) — port extraction (batch)
10. **M4** (Composition root Property query) — use Property public API
11. **Verify** — `npx tsc --noEmit`
