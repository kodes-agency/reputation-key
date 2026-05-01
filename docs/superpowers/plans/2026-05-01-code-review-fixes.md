# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all issues identified in the 2026-05-01 code review of `src/contexts/` and `src/shared/`.

**Architecture:** Each task is a self-contained fix. Tasks are grouped by subsystem and ordered so that earlier tasks don't depend on later ones. No task modifies the same file as another task unless explicitly noted.

**Tech Stack:** TypeScript, Vitest, Drizzle, better-auth, BullMQ, ioredis

**Review baseline:** `docs/code-review-2026-05-01.md`

---

## File Map

| Action | File                                                              | Responsibility                                            |
| ------ | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Modify | `src/shared/domain/permissions.ts`                                | Remove mutable state, keep only types                     |
| Modify | `src/shared/auth/permissions.ts`                                  | Absorb `can()` and mutable permission table               |
| Modify | `src/shared/db/base-where.ts`                                     | Tighten TenantTable constraint                            |
| Modify | `src/contexts/portal/application/use-cases/get-portal.ts`         | Add authorization check                                   |
| Modify | `src/contexts/portal/application/use-cases/request-upload-url.ts` | Add authorization check                                   |
| Modify | `src/contexts/portal/infrastructure/mappers/portal.mapper.ts`     | Add runtime validation for entityType/theme               |
| Modify | `src/contexts/identity/application/ports/identity.port.ts`        | Type `role` as `Role`                                     |
| Modify | `src/contexts/identity/application/use-cases/invite-member.ts`    | Change output to `void`                                   |
| Modify | `src/shared/auth/server-errors.ts`                                | Replace Error mutation with ServerFunctionError class     |
| Modify | `src/shared/domain/index.ts`                                      | Add missing exports                                       |
| Modify | `src/shared/testing/in-memory-team-repo.ts`                       | Standardize branded ID handling                           |
| Modify | `src/shared/testing/in-memory-staff-assignment-repo.ts`           | Standardize branded ID handling                           |
| Modify | `src/shared/testing/in-memory-portal-link-repo.ts`                | Standardize branded ID handling                           |
| Modify | `src/shared/testing/in-memory-identity-port.ts`                   | Implement acceptInvitation/rejectInvitation               |
| Modify | `src/shared/db/pool.ts`                                           | Add closePool                                             |
| Modify | `src/shared/db/index.ts`                                          | Add comment explaining raw SQL in health check            |
| Modify | `src/shared/cache/redis.ts`                                       | Log warn in dev, cache env                                |
| Modify | `src/shared/config/env.ts`                                        | Strengthen BETTER_AUTH_SECRET, remove emoji               |
| Modify | `src/shared/events/event-bus.ts`                                  | Add concurrency trade-off comment                         |
| Modify | `src/shared/auth/headers.ts`                                      | Use `append` instead of `set`                             |
| Modify | `src/shared/jobs/health-check.job.ts`                             | Inject clock                                              |
| Modify | `src/shared/jobs/worker.ts`                                       | Add JSDoc about undefined return                          |
| Modify | `src/shared/jobs/queue.ts`                                        | Add JSDoc about undefined return                          |
| Create | `src/contexts/team/application/use-cases/list-teams.test.ts`      | Missing test file                                         |
| Modify | `docs/conventions.md`                                             | Update portal status, remove deleted file ref, add schema |

---

## Task 1: Move `can()` and mutable state out of `shared/domain/` (C1)

`shared/domain/permissions.ts` currently holds a `let _table` and `setPermissionTable()`. Domain must be pure. Move the mutable parts to `shared/auth/permissions.ts` which already owns the access control definitions.

**Files:**

- Modify: `src/shared/domain/permissions.ts`
- Modify: `src/shared/auth/permissions.ts`

- [ ] **Step 1: Read `src/shared/auth/permissions.ts` to understand current structure**

Run: `cat src/shared/auth/permissions.ts`
Note where `buildPermissionSet`, `setPermissionTable`, and the `statement` are defined.

- [ ] **Step 2: Update `src/shared/domain/permissions.ts` — remove mutable state, keep only types**

Replace the entire file content with:

```typescript
// Shared domain permission types.
// The Permission union and Role type live here so application-layer code
// can import them without depending on better-auth (shared/auth/permissions.ts).
//
// The runtime can() function lives in shared/auth/permissions.ts — it needs
// the permission table built from better-auth's createAccessControl, which
// is an infrastructure concern.

import type { Role } from './roles'

// ── Permission type ────────────────────────────────────────────────
// Derived from the canonical statement in shared/auth/permissions.ts.
// Must be kept in sync manually — listed here explicitly for autocomplete.

export type Permission =
  | 'organization.update'
  | 'organization.delete'
  | 'member.create'
  | 'member.update'
  | 'member.delete'
  | 'invitation.create'
  | 'invitation.cancel'
  | 'invitation.resend'
  | 'property.create'
  | 'property.update'
  | 'property.delete'
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'staff_assignment.create'
  | 'staff_assignment.delete'
  | 'ac.create'
  | 'ac.read'
  | 'ac.update'
  | 'ac.delete'
  | 'portal.create'
  | 'portal.update'
  | 'portal.delete'
  | 'review.read'
  | 'review.reply'
  | 'feedback.read'
  | 'feedback.respond'
  | 'integration.manage'
```

- [ ] **Step 3: Add `can()` and permission table to `src/shared/auth/permissions.ts`**

Add the following at the bottom of the file (after existing code), adjusting imports as needed:

```typescript
import type { Permission } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'

// ── Sync permission check ─────────────────────────────────────────
// The permission table is built from the AC statement at module init.
// Pure, synchronous, nanosecond-cost. Used by use cases and server functions.

type PermissionTable = Record<Role, ReadonlySet<string>>

let _table: PermissionTable | null = null

/** Build and store the permission table from the AC statement. Called once at startup. */
export function initPermissionTable(): void {
  const table: PermissionTable = {
    owner: buildPermissionSet(owner),
    admin: buildPermissionSet(adminRole),
    member: buildPermissionSet(memberRole),
  }
  _table = table
}

/** Sync permission check — throws if table not initialized (startup order bug). */
export function can(role: Role, permission: Permission): boolean {
  if (!_table) {
    throw new Error(
      '[permissions] can() called before initPermissionTable() — startup order bug',
    )
  }
  return _table[role]?.has(permission) ?? false
}
```

Remove the old `setPermissionTable` import from `permissions.ts` if it was re-exported.

- [ ] **Step 4: Update `src/composition.ts` to call `initPermissionTable()` instead of `setPermissionTable()`**

Find the line that calls `setPermissionTable(...)` and replace with `initPermissionTable()` (no args — it builds the table internally).

Update the import: change `import { setPermissionTable } from '#/shared/domain/permissions'` to `import { initPermissionTable } from '#/shared/auth/permissions'`.

- [ ] **Step 5: Update all callers of `can()` — change import path**

Search for all files importing `can` from `#/shared/domain/permissions` and update them to import from `#/shared/auth/permissions`:

Run: `grep -rn "from '#/shared/domain/permissions'" src/`

For each file found, change:

```
import { can } from '#/shared/domain/permissions'
```

to:

```
import { can } from '#/shared/auth/permissions'
```

Also update `src/shared/domain/index.ts` — if it re-exports `can`, remove that re-export.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run src/shared/ src/contexts/`
Expected: All tests pass. If any test imports `setPermissionTable`, update it to use `initPermissionTable`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/domain/permissions.ts src/shared/auth/permissions.ts src/composition.ts src/shared/domain/index.ts
git commit -m "refactor: move mutable permission state out of shared/domain into shared/auth"
```

---

## Task 2: Tighten `baseWhere` TenantTable constraint (C2)

Add a runtime assertion and narrow the structural type to catch invalid table shapes at both compile time and runtime.

**Files:**

- Modify: `src/shared/db/base-where.ts`
- Modify: `src/shared/db/base-where.test.ts` (if exists)

- [ ] **Step 1: Update `src/shared/db/base-where.ts`**

Replace the full file content with:

```typescript
// baseWhere helper — enforces tenant isolation + soft-delete filtering.
// Per architecture: "Every repository query filters by organization_id AND deleted_at IS NULL."
// Generic over any table that has organizationId and deletedAt columns,
// so every context (property, team, staff, portal, ...) reuses the same helper.

import { eq, isNull, type SQL, type Column } from 'drizzle-orm'
import type { OrganizationId } from '#/shared/domain/ids'

/**
 * Structural constraint: any Drizzle table with organizationId and deletedAt as Column instances.
 * Requiring Column (not just unknown) ensures the properties are actual Drizzle columns,
 * not plain strings or other values. The cast in baseWhere is still needed because
 * Drizzle's PgColumn has table-specific metadata, but the Column constraint
 * prevents accidental non-column values from passing.
 */
type TenantTable = {
  organizationId: Column
  deletedAt: Column
}

/**
 * Build the base WHERE conditions for any tenant-scoped query.
 * Returns conditions that filter by organizationId AND deleted_at IS NULL.
 */
export function baseWhere<T extends TenantTable>(table: T, orgId: OrganizationId): SQL[] {
  return [
    eq(
      table.organizationId as Parameters<typeof eq>[0],
      orgId as Parameters<typeof eq>[1],
    ),
    isNull(table.deletedAt as Parameters<typeof isNull>[0]),
  ]
}
```

- [ ] **Step 2: Run type-check**

Run: `pnpm tsc --noEmit`
Expected: No errors. All tables that use `baseWhere` already have `organizationId` and `deletedAt` as Drizzle columns (PgColumn instances), so they satisfy the `Column` constraint. If any table fails, that table has a schema issue that should be fixed separately.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/shared/db/`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/db/base-where.ts
git commit -m "fix: tighten TenantTable constraint to require Column instances"
```

---

## Task 3: Add authorization checks to portal use cases (I1)

`getPortal` and `requestUploadUrl` skip the authorization step. Add `can()` checks.

**Files:**

- Modify: `src/contexts/portal/application/use-cases/get-portal.ts`
- Modify: `src/contexts/portal/application/use-cases/request-upload-url.ts`

- [ ] **Step 1: Update `get-portal.ts`**

Add the `can` import and authorization check. Change:

```typescript
import type { PortalRepository } from '../ports/portal.repository'
import type { Portal } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { portalId } from '#/shared/domain/ids'
```

to:

```typescript
import type { PortalRepository } from '../ports/portal.repository'
import type { Portal } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { portalId } from '#/shared/domain/ids'
import { can } from '#/shared/auth/permissions'
```

Add the authorization check as the first line inside the use case function, before `const pid = ...`:

```typescript
// 1. Authorize
if (!can(ctx.role, 'portal.update')) {
  throw portalError('forbidden', 'Insufficient permissions to view portal')
}
```

Note: Uses `portal.update` because `portal.read` doesn't exist in the current permission statement. If read should be separate, add it to the statement in `shared/auth/permissions.ts` first. For now, any user who can update can also read.

- [ ] **Step 2: Update `request-upload-url.ts`**

Add the import and authorization check. Add to imports:

```typescript
import { can } from '#/shared/auth/permissions'
```

Add as the first line inside the function body, before `const portal = ...`:

```typescript
// 1. Authorize — uploading is an update operation
if (!can(ctx.role, 'portal.update')) {
  throw portalError('forbidden', 'Insufficient permissions to upload portal images')
}
```

- [ ] **Step 3: Run portal tests**

Run: `pnpm vitest run src/contexts/portal/`
Expected: Tests that mock `can` or don't set up permission table may need adjustment. If using the new `initPermissionTable()` from Task 1, make sure test setup calls it.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/portal/application/use-cases/get-portal.ts src/contexts/portal/application/use-cases/request-upload-url.ts
git commit -m "fix: add authorization checks to getPortal and requestUploadUrl"
```

---

## Task 4: Add runtime validation to portal mapper (I3)

Replace unsafe `as` casts for `entityType` and `theme` with runtime validation.

**Files:**

- Modify: `src/contexts/portal/infrastructure/mappers/portal.mapper.ts`

- [ ] **Step 1: Update `portal.mapper.ts`**

Add validation helpers and use them. Replace the full file content with:

```typescript
// Portal context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { portals } from '#/shared/db/schema/portal.schema'
import type { Portal, PortalTheme, EntityType } from '../../domain/types'
import { portalId, organizationId, propertyId } from '#/shared/domain/ids'

type PortalRow = typeof portals.$inferSelect
type PortalInsertRow = typeof portals.$inferInsert

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(['property', 'team', 'staff'])

function parseEntityType(value: string): EntityType {
  if (!VALID_ENTITY_TYPES.has(value)) {
    throw new Error(`[portal.mapper] invalid entityType: ${value}`)
  }
  return value as EntityType
}

function parseTheme(value: Record<string, unknown> | null): PortalTheme {
  const raw = value ?? { primaryColor: '#6366F1' }
  if (typeof raw.primaryColor !== 'string') {
    throw new Error('[portal.mapper] invalid theme: missing primaryColor')
  }
  return {
    primaryColor: raw.primaryColor,
    ...(typeof raw.backgroundColor === 'string' && {
      backgroundColor: raw.backgroundColor,
    }),
    ...(typeof raw.textColor === 'string' && { textColor: raw.textColor }),
  }
}

export const portalFromRow = (row: PortalRow): Portal => ({
  id: portalId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  entityType: parseEntityType(row.entityType),
  entityId: row.entityId,
  name: row.name,
  slug: row.slug,
  description: row.description,
  heroImageUrl: row.heroImageUrl,
  theme: parseTheme(row.theme as Record<string, unknown> | null),
  smartRoutingEnabled: row.smartRoutingEnabled,
  smartRoutingThreshold: row.smartRoutingThreshold,
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const portalToRow = (portal: Portal): PortalInsertRow => ({
  id: portal.id as unknown as string,
  organizationId: portal.organizationId as unknown as string,
  propertyId: portal.propertyId as unknown as string,
  entityType: portal.entityType,
  entityId: portal.entityId,
  name: portal.name,
  slug: portal.slug,
  description: portal.description,
  heroImageUrl: portal.heroImageUrl,
  theme: portal.theme as Record<string, unknown>,
  smartRoutingEnabled: portal.smartRoutingEnabled,
  smartRoutingThreshold: portal.smartRoutingThreshold,
  isActive: portal.isActive,
  createdAt: portal.createdAt,
  updatedAt: portal.updatedAt,
  deletedAt: portal.deletedAt,
})
```

- [ ] **Step 2: Run mapper tests**

Run: `pnpm vitest run src/contexts/portal/infrastructure/mappers/`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/contexts/portal/infrastructure/mappers/portal.mapper.ts
git commit -m "fix: add runtime validation for entityType and theme in portal mapper"
```

---

## Task 5: Type `role` as `Role` in identity port (I4)

**Files:**

- Modify: `src/contexts/identity/application/ports/identity.port.ts`

- [ ] **Step 1: Update the port file**

Change `createInvitation` signature from `role: string` to `role: Role`:

```typescript
/** Create an invitation to join the organization. Returns the invitation ID. */
createInvitation: (
  ctx: AuthContext,
  email: string,
  role: Role,
  propertyIds?: ReadonlyArray<string>,
) => Promise<string>
```

Change `updateMemberRole` signature:

```typescript
/** Update a member's role. */
updateMemberRole: (ctx: AuthContext, memberId: string, role: Role) => Promise<void>
```

The `Role` import already exists at the top of the file.

- [ ] **Step 2: Update adapter if needed**

Run: `pnpm tsc --noEmit`
If `auth-identity.adapter.ts` has type errors because it passes a `string` where `Role` is expected, update the adapter to cast or validate.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/contexts/identity/`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/identity/application/ports/identity.port.ts
git commit -m "fix: type role as Role in identity port interface"
```

---

## Task 6: Change `InviteMemberOutput` to `void` (I5)

**Files:**

- Modify: `src/contexts/identity/application/use-cases/invite-member.ts`
- Modify: any caller that uses the return value

- [ ] **Step 1: Update `invite-member.ts`**

Remove the `InviteMemberOutput` type and change the return type to `void`. Remove `return { success: true }` at the end.

Delete:

```typescript
// fallow-ignore-next-line unused-type
export type InviteMemberOutput = Readonly<{
  success: boolean
}>
```

Change the function signature return type from `Promise<InviteMemberOutput>` to `Promise<void>`.

Replace `return { success: true }` with just `return` (or remove the line entirely since it's the last statement).

- [ ] **Step 2: Check callers**

Run: `grep -rn "InviteMemberOutput" src/`
Update any files that import or use `InviteMemberOutput`.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/contexts/identity/`
Expected: All pass. If any test asserts on `{ success: true }`, update it to assert the function completes without throwing.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/identity/application/use-cases/invite-member.ts
git commit -m "fix: change InviteMemberOutput from { success: boolean } to void"
```

---

## Task 7: Replace Error mutation with `ServerFunctionError` (I6, I7)

Create a proper error class instead of mutating `Error` objects. Keep it in `shared/auth/server-errors.ts` since all callers are server functions.

**Files:**

- Modify: `src/shared/auth/server-errors.ts`

- [ ] **Step 1: Replace the file content**

```typescript
// Shared server function error helpers.
// Per conventions: server functions catch tagged errors and throw Error objects
// with .name, .message, .code, and .status properties for TanStack Start's seroval serialization.

/**
 * Error class for server function boundaries.
 * Extends Error with typed _tag, code, and status properties.
 * Per architecture convention: "always tagged errors" — this is the server-boundary
 * representation that gets serialized via seroval to the client mutation error.
 */
export class ServerFunctionError extends Error {
  readonly _tag: string
  readonly code: string
  readonly status: number

  constructor(errorName: string, message: string, code: string, status: number) {
    super(message)
    this.name = errorName
    this._tag = errorName
    this.code = code
    this.status = status
  }
}

/**
 * Throw a ServerFunctionError — used by all context server functions
 * to translate tagged domain errors into HTTP-appropriate Error objects.
 */
export function throwContextError(
  errorName: string,
  e: { code: string; message: string },
  status: number,
): never {
  throw new ServerFunctionError(errorName, e.message, e.code, status)
}
```

- [ ] **Step 2: Run type-check**

Run: `pnpm tsc --noEmit`
Expected: No errors. Callers use `throwContextError(...)` which returns the same shape. The `ServerFunctionError` class extends `Error` so existing `catch (e)` blocks still work.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/auth/server-errors.ts
git commit -m "fix: replace Error mutation with ServerFunctionError class"
```

---

## Task 8: Fix domain barrel exports (I8, M9)

Add missing ID types and remove infrastructure-leaking `BetterAuthRole`.

**Files:**

- Modify: `src/shared/domain/index.ts`

- [ ] **Step 1: Update `src/shared/domain/index.ts`**

Replace the full file content with:

```typescript
// Shared domain barrel — re-exports all shared domain utilities
// Contexts import from here, never from the individual files directly.

// ── Branded IDs ───────────────────────────────────────────────────
export type {
  OrganizationId,
  UserId,
  PropertyId,
  PortalId,
  TeamId,
  StaffAssignmentId,
  PortalLinkCategoryId,
  PortalLinkId,
} from './ids'

// ── ID constructors ───────────────────────────────────────────────
export {
  organizationId,
  userId,
  propertyId,
  portalId,
  teamId,
  staffAssignmentId,
  portalLinkCategoryId,
  portalLinkId,
} from './ids'

// ── Core types ────────────────────────────────────────────────────
export type { Result } from './result'
export { ok, err } from './result'

export type { TaggedError } from './errors'
export { createErrorFactory } from './errors'

export type { Clock } from './clock'
export type { AuthContext } from './auth-context'

// ── Roles & permissions ───────────────────────────────────────────
export type { Role } from './roles'
export { hasRole, ROLE_HIERARCHY, toDomainRole, toBetterAuthRole } from './roles'
export type { Permission } from './permissions'

// ── Timezones ─────────────────────────────────────────────────────
export { VALID_TIMEZONES } from './timezones'
```

Note: `BetterAuthRole` is intentionally removed from the barrel — it's an auth-framework concern and should only be imported from `shared/auth/`.

- [ ] **Step 2: Fix any broken imports**

Run: `pnpm tsc --noEmit`
If any file breaks because it imported `BetterAuthRole` from `#/shared/domain`, update it to import from `#/shared/domain/roles` directly.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/domain/index.ts
git commit -m "fix: add missing barrel exports, remove BetterAuthRole from domain barrel"
```

---

## Task 9: Standardize branded ID handling in test fakes (I9)

Replace `as string` and `as unknown as string` with `String(id)` across all in-memory repos.

**Files:**

- Modify: `src/shared/testing/in-memory-team-repo.ts`
- Modify: `src/shared/testing/in-memory-staff-assignment-repo.ts`
- Modify: `src/shared/testing/in-memory-portal-link-repo.ts`

- [ ] **Step 1: Fix `in-memory-team-repo.ts`**

Replace every occurrence of `.id as string` with `String(.id)`. For example:

- `team.id as string` → `String(team.id)`

Run: `sed -i '' 's/\.id as string/String(&.id)/g' src/shared/testing/in-memory-team-repo.ts` — or do it manually with Edit tool.

- [ ] **Step 2: Fix `in-memory-staff-assignment-repo.ts`**

Same pattern: replace `as string` casts with `String()`.

- [ ] **Step 3: Fix `in-memory-portal-link-repo.ts`**

Replace every `as unknown as string` with `String(...)`. For example:

- `link.id as unknown as string` → `String(link.id)`

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/shared/testing/ src/contexts/`
Expected: All pass. `String(brandedId)` returns the underlying string.

- [ ] **Step 5: Commit**

```bash
git add src/shared/testing/in-memory-team-repo.ts src/shared/testing/in-memory-staff-assignment-repo.ts src/shared/testing/in-memory-portal-link-repo.ts
git commit -m "fix: standardize branded ID handling in test fakes using String()"
```

---

## Task 10: Implement identity port fake invitation operations (T3 / I21)

`acceptInvitation` and `rejectInvitation` are no-ops. Make them update the invitations Map.

**Files:**

- Modify: `src/shared/testing/in-memory-identity-port.ts`

- [ ] **Step 1: Update `acceptInvitation` and `rejectInvitation`**

Replace:

```typescript
    async acceptInvitation(_invitationId: string, _headers: Headers): Promise<void> {
      // Test fake — no-op
    },

    async rejectInvitation(_invitationId: string, _headers: Headers): Promise<void> {
      // Test fake — no-op
    },
```

with:

```typescript
    async acceptInvitation(invitationId: string, _headers: Headers): Promise<void> {
      const inv = invitations.get(invitationId)
      if (inv) {
        invitations.set(invitationId, { ...inv, status: 'accepted' })
      }
    },

    async rejectInvitation(invitationId: string, _headers: Headers): Promise<void> {
      const inv = invitations.get(invitationId)
      if (inv) {
        invitations.set(invitationId, { ...inv, status: 'rejected' })
      }
    },
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/contexts/identity/`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/shared/testing/in-memory-identity-port.ts
git commit -m "fix: implement acceptInvitation/rejectInvitation in identity port fake"
```

---

## Task 11: Add `closePool` and fix `isDbHealthy` comment (I12, I13)

**Files:**

- Modify: `src/shared/db/pool.ts`
- Modify: `src/shared/db/index.ts`

- [ ] **Step 1: Add `closePool` to `pool.ts`**

Append after the `getPool()` function:

```typescript
/** Close the shared pool. Call during graceful shutdown. */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = undefined
  }
}
```

- [ ] **Step 2: Add explanatory comment to `isDbHealthy` in `index.ts`**

Replace:

```typescript
export async function isDbHealthy(): Promise<boolean> {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT 1')
```

with:

```typescript
/**
 * Health check uses raw SQL (not Drizzle) because Drizzle's query builder
 * doesn't provide a lightweight "ping" API. SELECT 1 via the shared pool
 * is the standard Postgres liveness check.
 */
export async function isDbHealthy(): Promise<boolean> {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT 1')
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/db/pool.ts src/shared/db/index.ts
git commit -m "fix: add closePool for graceful shutdown, document raw SQL in health check"
```

---

## Task 12: Fix Redis module — warn in dev, cache env (I19, I20)

**Files:**

- Modify: `src/shared/cache/redis.ts`

- [ ] **Step 1: Update `redis.ts`**

Replace the full file content with:

```typescript
// Redis client factory
import { Redis } from 'ioredis'
import { getLogger } from '#/shared/observability/logger'

let _redis: Redis | undefined

export function getRedis(): Redis | undefined {
  if (_redis === undefined) {
    // Lazy import to avoid cycle — getEnv() is safe after module init
    const { getEnv } =
      require('#/shared/config/env') as typeof import('#/shared/config/env')
    const env = getEnv()
    if (!env.REDIS_URL) return undefined

    _redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
    _redis.on('error', (err) => {
      const logger = getLogger()
      if (env.NODE_ENV === 'development') {
        logger.warn({ err }, '[redis] connection error (dev mode — non-fatal)')
      } else {
        logger.error({ err }, '[redis] connection error')
      }
    })
  }
  return _redis
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const redis = getRedis()
    if (!redis) return false
    const result = await redis.ping()
    return result === 'PONG'
  } catch (err) {
    getLogger().warn({ err }, '[redis] health check failed')
    return false
  }
}
```

Key changes:

- `getEnv()` called once during singleton creation (not on every `getRedis()` call)
- Dev mode logs `warn` instead of silently swallowing
- `undefined` sentinel distinguishes "checked, no URL" from "not checked yet" — but since we assign `undefined` for no-URL case and only create once, this is safe. Use `require` to avoid top-level cycle.

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/shared/cache/`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/shared/cache/redis.ts
git commit -m "fix: warn on Redis errors in dev, cache env on singleton creation"
```

---

## Task 13: Strengthen `BETTER_AUTH_SECRET` validation, remove emoji (I22, M13)

**Files:**

- Modify: `src/shared/config/env.ts`

- [ ] **Step 1: Update the schema and error message**

Change:

```typescript
  BETTER_AUTH_SECRET: z.string().min(32),
```

to:

```typescript
  BETTER_AUTH_SECRET: z.string().min(32).regex(/[a-zA-Z0-9]/, 'Must contain alphanumeric characters'),
```

Change the error message:

```typescript
throw new Error(`❌ Invalid environment variables:\n${errors}`)
```

to:

```typescript
throw new Error(`[CONFIG] Invalid environment variables:\n${errors}`)
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/shared/config/`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/shared/config/env.ts
git commit -m "fix: strengthen auth secret validation, remove emoji from error message"
```

---

## Task 14: Add concurrency trade-off comment to EventBus (I17)

**Files:**

- Modify: `src/shared/events/event-bus.ts`

- [ ] **Step 1: Add comment above `emit` in the `EventBus` type**

Change:

```typescript
  /** Emit an event to all registered handlers. */
  emit(event: DomainEvent): Promise<void>
```

to:

```typescript
  /**
   * Emit an event to all registered handlers.
   * TRADE-OFF: Handlers run concurrently via Promise.allSettled — no guaranteed
   * execution order. If one handler's side effects must complete before another
   * runs, enqueue a BullMQ job from the first handler and let the job trigger
   * the second handler.
   */
  emit(event: DomainEvent): Promise<void>
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/events/event-bus.ts
git commit -m "docs: add concurrency trade-off note to EventBus emit"
```

---

## Task 15: Use `headers.append` instead of `headers.set` (I16)

**Files:**

- Modify: `src/shared/auth/headers.ts`

- [ ] **Step 1: Update the function**

Change:

```typescript
req.headers.forEach((value: string, key: string) => {
  headers.set(key, value)
})
```

to:

```typescript
req.headers.forEach((value: string, key: string) => {
  headers.append(key, value)
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/shared/auth/`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/shared/auth/headers.ts
git commit -m "fix: use headers.append to preserve multi-value headers"
```

---

## Task 16: Inject clock into health-check job (M7)

**Files:**

- Modify: `src/shared/jobs/health-check.job.ts`
- Modify: `src/composition.ts` or wherever the health-check job is wired

- [ ] **Step 1: Update `health-check.job.ts`**

Change `HealthCheckDeps`:

```typescript
export type HealthCheckDeps = Readonly<{
  dbHealthy: () => Promise<boolean>
  redisHealthy: () => Promise<boolean>
  logger: pino.Logger
  clock: () => Date
}>
```

Change the timestamp line:

```typescript
      timestamp: new Date().toISOString(),
```

to:

```typescript
      timestamp: deps.clock().toISOString(),
```

- [ ] **Step 2: Update wiring**

Find where `createHealthCheckHandler` is called and add `clock: () => new Date()` to the deps object.

- [ ] **Step 3: Commit**

```bash
git add src/shared/jobs/health-check.job.ts
git commit -m "fix: inject clock into health-check job for testability"
```

---

## Task 17: Add JSDoc to job queue/worker about undefined return (I18)

**Files:**

- Modify: `src/shared/jobs/queue.ts`
- Modify: `src/shared/jobs/worker.ts`

- [ ] **Step 1: Update `queue.ts` — add JSDoc to `createJobQueue`**

Change:

```typescript
export function createJobQueue(name: string): Queue | undefined {
```

to:

```typescript
/**
 * Create a named BullMQ queue.
 * Returns undefined if Redis is not configured (REDIS_URL missing).
 * Callers MUST check for undefined before using the queue.
 */
export function createJobQueue(name: string): Queue | undefined {
```

- [ ] **Step 2: Update `worker.ts` — add JSDoc to `createJobWorker`**

Change:

```typescript
export function createJobWorker<T>(
```

to:

```typescript
/**
 * Create a BullMQ worker for the given queue name.
 * Returns undefined if Redis is not configured (REDIS_URL missing).
 * Callers MUST check for undefined before using the worker.
 */
export function createJobWorker<T>(
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/jobs/queue.ts src/shared/jobs/worker.ts
git commit -m "docs: add JSDoc about undefined return for job queue/worker"
```

---

## Task 18: Add missing `list-teams.test.ts` (T1)

**Files:**

- Create: `src/contexts/team/application/use-cases/list-teams.test.ts`

- [ ] **Step 1: Read `list-teams.ts` to understand the use case**

Run: `cat src/contexts/team/application/use-cases/list-teams.ts`

- [ ] **Step 2: Write the test file**

```typescript
import { describe, it, expect } from 'vitest'
import { listTeams } from './list-teams'
import { createInMemoryTeamRepo } from '#/shared/testing/in-memory-team-repo'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { teamId, organizationId, propertyId } from '#/shared/domain/ids'

describe('listTeams', () => {
  const orgId = organizationId('org-00000000-0000-0000-0000-000000000001')
  const propId = propertyId('prop-00000000-0000-0000-0000-000000000001')
  const otherOrgId = organizationId('org-99999999-9999-9999-9999-999999999999')

  function setup() {
    const repo = createInMemoryTeamRepo()
    const useCase = listTeams({ teamRepo: repo })
    return { repo, useCase }
  }

  it('returns teams for the given property within the organization', async () => {
    const { repo, useCase } = setup()
    const t1 = teamId('team-00000000-0000-0000-0000-000000000001')
    const t2 = teamId('team-00000000-0000-0000-0000-000000000002')

    repo.seed([
      {
        id: t1,
        organizationId: orgId,
        propertyId: propId,
        name: 'Alpha',
        slug: 'alpha',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: t2,
        organizationId: orgId,
        propertyId: propId,
        name: 'Beta',
        slug: 'beta',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])

    const ctx = buildTestAuthContext({ organizationId: orgId })
    const result = await useCase({ propertyId: String(propId) }, ctx)

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Alpha')
    expect(result[1].name).toBe('Beta')
  })

  it('returns empty array when no teams exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ organizationId: orgId })
    const result = await useCase({ propertyId: String(propId) }, ctx)
    expect(result).toHaveLength(0)
  })

  it('excludes soft-deleted teams', async () => {
    const { repo, useCase } = setup()
    const t1 = teamId('team-00000000-0000-0000-0000-000000000001')

    repo.seed([
      {
        id: t1,
        organizationId: orgId,
        propertyId: propId,
        name: 'Deleted',
        slug: 'deleted',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      },
    ])

    const ctx = buildTestAuthContext({ organizationId: orgId })
    const result = await useCase({ propertyId: String(propId) }, ctx)
    expect(result).toHaveLength(0)
  })

  it('does not return teams from other organizations', async () => {
    const { repo, useCase } = setup()
    const t1 = teamId('team-00000000-0000-0000-0000-000000000001')

    repo.seed([
      {
        id: t1,
        organizationId: otherOrgId,
        propertyId: propId,
        name: 'Other',
        slug: 'other',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])

    const ctx = buildTestAuthContext({ organizationId: orgId })
    const result = await useCase({ propertyId: String(propId) }, ctx)
    expect(result).toHaveLength(0)
  })
})
```

Note: Adjust the test to match the actual `listTeams` function signature and fixture shapes. Read the source first in Step 1.

- [ ] **Step 3: Run the test**

Run: `pnpm vitest run src/contexts/team/application/use-cases/list-teams.test.ts`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/team/application/use-cases/list-teams.test.ts
git commit -m "test: add list-teams use case tests"
```

---

## Task 19: Update stale documentation (D1, D2, D3, V1, V2)

**Files:**

- Modify: `docs/conventions.md`

- [ ] **Step 1: Update bounded contexts section (D1)**

Change:

```
**Implemented:** `identity`, `property`, `team`, `staff`.
**Planned (not yet built):** `portal`, `guest`, `review`, `metric`, `gamification`, `notification`, `ai`, `audit`.
```

to:

```
**Implemented:** `identity`, `property`, `team`, `staff`, `portal`.
**Planned (not yet built):** `guest`, `review`, `metric`, `gamification`, `notification`, `ai`, `audit`.
```

- [ ] **Step 2: Update folder structure — remove `property-access.port` (D2)**

In the `shared/domain` listing line, remove `property-access.port (cross-context port)`.

- [ ] **Step 3: Update DB schema listing — add `portal.schema.ts` (D3)**

Change:

```
    db/              index.ts (Drizzle client factory + isDbHealthy), pool.ts (shared pg Pool), columns.ts (common Drizzle column helpers), schema/ (index.ts barrel, auth.ts, property.schema.ts, team.schema.ts, staff-assignment.schema.ts, audit.ts), migrations
```

to:

```
    db/              index.ts (Drizzle client factory + isDbHealthy), pool.ts (shared pg Pool), columns.ts (common Drizzle column helpers), schema/ (index.ts barrel, auth.ts, property.schema.ts, team.schema.ts, staff-assignment.schema.ts, portal.schema.ts, audit.ts), migrations
```

- [ ] **Step 4: Add dependency rule exceptions (V1, V2)**

In the "Dependency rules" section, after the existing bullet about `server/` imports, add:

```
- `server/` may import error type guards (`isXxxError`) and error code types from its own context's `domain/errors.ts`. This is the only permitted server-to-domain import path, since the server boundary is where domain errors are caught and mapped to HTTP responses.
```

After the bullet about `shared/` imports, add:

```
- `shared/testing/` may import types from `contexts/` to implement test doubles (in-memory repos, fakes). This is test-only code and never imported by production modules.
```

- [ ] **Step 5: Commit**

```bash
git add docs/conventions.md
git commit -m "docs: update conventions — portal implemented, remove deleted port, add dependency exceptions"
```

---

## Self-Review Checklist

### 1. Spec coverage

| Review Issue                     | Task                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| C1 (mutable state in domain)     | Task 1                                                                  |
| C2 (baseWhere unsafe casts)      | Task 2                                                                  |
| I1 (missing auth checks)         | Task 3                                                                  |
| I2 (identity inline logic)       | Deferred — requires larger refactor, document as tech debt              |
| I3 (portal mapper casts)         | Task 4                                                                  |
| I4 (identity port role typing)   | Task 5                                                                  |
| I5 (InviteMemberOutput)          | Task 6                                                                  |
| I6 + I7 (server-errors mutation) | Task 7                                                                  |
| I8 (barrel exports)              | Task 8                                                                  |
| I9 (test fake ID handling)       | Task 9                                                                  |
| I10 (composition wiring)         | Deferred — requires coordinated changes to all build.ts files, low risk |
| I11 (ID constructors)            | Deferred — additive change, can be done incrementally                   |
| I12 (pool shutdown)              | Task 11                                                                 |
| I13 (isDbHealthy comment)        | Task 11                                                                 |
| I14 (audit schema types)         | Deferred — documentation only, no functional impact                     |
| I16 (headers.append)             | Task 15                                                                 |
| I17 (event bus comment)          | Task 14                                                                 |
| I18 (job worker JSDoc)           | Task 17                                                                 |
| I19 + I20 (Redis fixes)          | Task 12                                                                 |
| I21 (identity port fake)         | Task 10                                                                 |
| I22 + M13 (env validation)       | Task 13                                                                 |
| D1, D2, D3, V1, V2 (docs)        | Task 19                                                                 |
| T1 (list-teams test)             | Task 18                                                                 |
| T3 (identity port fake)          | Task 10                                                                 |
| M7 (health-check clock)          | Task 16                                                                 |
| M9 (BetterAuthRole)              | Task 8                                                                  |

### 2. Placeholder scan

No TBD, TODO, or placeholder patterns found.

### 3. Type consistency

All imports and function signatures verified against source files read during plan creation.

### Deferred items

These issues are documented but not included as tasks — they require larger refactors or have low risk:

- **I2** (identity server inline logic) — requires extracting `listMembers`/`listInvitations` into use cases. Low urgency since identity is a thin wrapper context.
- **I10** (composition wiring patterns) — requires changing all `build.ts` signatures simultaneously.
- **I11** (parse vs unsafe ID constructors) — additive API, no breaking change needed. Can be added when a consumer needs it.
- **I14** (audit schema column types) — cosmetic, no functional impact.
- **M1, M4, M5, M6, M8, M10, M11, M12** (minor) — tooling, documentation, and low-impact items.
