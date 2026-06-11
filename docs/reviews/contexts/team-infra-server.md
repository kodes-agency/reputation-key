# Team Context — Infrastructure & Server Review

**Date:** 2026-06-10
**Reviewer:** TeamInfraServer agent
**Scope:** `src/contexts/team/infrastructure/`, `src/contexts/team/server/`
**Dimensions:** D5 (repository ports), D7 (multi-tenancy), D8 (server functions), D12 (CONTEXT.md accuracy), D15 (error handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 2     |
| NIT      | 1     |

---

## Findings

### 1. [D12] [MAJOR] CONTEXT.md documents getTeam use case but no server function exists

**File:** `src/contexts/team/CONTEXT.md:59`
**Quote:**

```
- **`getTeam`** — Retrieve a single team by ID with member info via StaffPublicApi.
```

**Rule:** D12 — CONTEXT.md claims must match actual code. CONTEXT.md section "Server functions" says `teams.ts` provides "CRUD server functions for teams (create, update, list, get, delete)".
**Fix:** Either add a `getTeam` server function to `src/contexts/team/server/teams.ts`, or update CONTEXT.md to document that `getTeam` is an application-only use case not exposed as a server function. The use case exists at `application/use-cases/get-team.ts` and is wired in `build.ts`, but is unreachable from the client.

---

### 2. [D8] [MAJOR] Server functions do not perform explicit permission checks

**File:** `src/contexts/team/server/teams.ts:41-54`
**Quote:**

```ts
async ({ data }) => {
  const headers = await headersFromContext()
  const ctx = await resolveTenantContext(headers)

  try {
    const { useCases } = getContainer()
    const team = await useCases.createTeam(data, ctx)
```

**Rule:** D8 — server functions must include auth middleware, input validation, permission check. CONTEXT.md states permissions `team.create`, `team.update`, `team.delete` should gate operations. None of the four server functions call `can(role, permission)` or any equivalent before invoking the use case. Permission enforcement is delegated entirely to the use-case layer. If D8 requires the server layer to explicitly check permissions (as stated: "permission check" step), this is a gap. If the architecture intentionally defers to use cases, update D8 wording accordingly.
**Fix:** Add explicit `can(ctx.role, 'team.create')` (etc.) checks in each server function handler before calling the use case, or confirm this is by-design and document the delegation.

---

### 3. [D15] [MINOR] Repository insert throws teamError directly — domain error in infrastructure layer

**File:** `src/contexts/team/infrastructure/repositories/team.repository.ts:67-69`
**Quote:**

```ts
if (team.organizationId !== orgId) {
  throw teamError('forbidden', 'Tenant mismatch on team insert')
}
```

**Rule:** D1/D15 — infrastructure layer should not produce domain errors. Domain errors (`teamError`) belong to the domain layer. The infrastructure adapter should return a result or throw an infrastructure-level error, letting the application layer translate it.
**Fix:** Remove the `teamError` import and throw. The `insert` method can simply check the guard and return void (the guard is redundant — the caller already has both `orgId` and `team.organizationId`); or throw a plain Error / return a Result type.

---

### 4. [D12] [MINOR] Mapper test fixture includes phantom `portalId` column not in schema

**File:** `src/contexts/team/infrastructure/mappers/team.mapper.test.ts:16`
**Quote:**

```ts
const makeTeamRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'team-1',
  organizationId: 'org-1',
  propertyId: 'prop-1',
  portalId: null,
  name: 'Alpha Team',
```

**Rule:** D12 — test fixtures should match actual schema shape. The `teams` table schema (`team.schema.ts`) has no `portalId` column. The fixture is typed as `Record<string, unknown>` so TypeScript doesn't catch this, but it's misleading and suggests a stale fixture from a schema migration.
**Fix:** Remove `portalId: null` from `makeTeamRow`.

---

### 5. [D5] [NIT] Repository `update` method patch type is `Partial<Team>` but implementation uses ad-hoc SetValues

**File:** `src/contexts/team/infrastructure/repositories/team.repository.ts:74-87`
**Quote:**

```ts
update: async (orgId, id, patch) => {
  return trace('team.update', async () => {
    const setValues: SetValues = {}
    if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt
    if (patch.name !== undefined) setValues.name = patch.name
    ...
```

**Rule:** D5 — the port declares `patch: Readonly<Partial<Team>>` but the implementation manually picks fields via a local `SetValues` type, which can silently ignore new Team fields added later. This works but is fragile.
**Fix:** Consider typing `SetValues` as a subset of the Drizzle insert type or deriving it from the schema, so adding a new Team field surfaces a type error here.

---

## Positive Observations

- **D7 (Multi-tenancy):** Every repository method correctly uses `baseWhere(teams, orgId)` which enforces both `organization_id` equality and `deleted_at IS NULL`. The `insert` method has an additional guard `team.organizationId !== orgId`. Integration tests explicitly verify cross-tenant isolation (findById, nameExistsInProperty, listByProperty).
- **D5 (Repository ports):** Port interface is well-defined in `application/ports/team.repository.ts` with `orgId: OrganizationId` as the first parameter on every method. Factory function `createTeamRepository(db)` follows convention.
- **D15 (Error handling):** Server functions use consistent try/catch with `isTeamError` type guard, `throwContextError` for tagged errors, and `catchUntagged` as safety net. The `teamErrorStatus` mapping uses `ts-pattern` `.exhaustive()` ensuring all error codes are covered.
- **D8 (Server functions):** All four functions follow the pattern: `createServerFn` → `inputValidator` (zod) → `tracedHandler` → `resolveTenantContext` → use case call → error translation. Input schemas are DTOs from the application layer.
- **Infrastructure tracing:** Every repository method is wrapped with `trace()` spans.
- **Schema:** The unique index `teams_org_property_name_unique` with `WHERE deleted_at IS NULL` correctly enforces the "no duplicate names per property" invariant at the DB level.
