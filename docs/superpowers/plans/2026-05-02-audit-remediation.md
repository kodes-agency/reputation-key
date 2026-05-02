# Audit Remediation Plan — Guest Refactoring, Form Schemas & Tagged Errors

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all HIGH and CRITICAL audit findings from `docs/superpowers/plans/2026-05-02-codebase-audit.md` — guest server functions bypassing architecture, form schemas not deriving from DTOs, and plain Error throws in infrastructure.

**Architecture:** Guest refactoring extracts direct DB queries into use cases + ports, following the same pattern as property/team contexts. Form schema changes follow `CreatePropertyForm.tsx`. Tagged error changes replace `throw new Error(...)` with context error constructors.

**Tech Stack:** TypeScript, Zod v4, TanStack Form, TanStack Start, Drizzle, neverthrow

**Reference patterns:**

- `src/components/features/property/CreatePropertyForm.tsx` — form deriving from DTO
- `src/contexts/guest/application/use-cases/submit-rating.ts` — existing use case pattern
- `src/contexts/portal/domain/errors.ts` — tagged error pattern

**Out of scope:**

- Component→server import decoupling (P2)
- File size splits (P4)

---

## Phase 1: Guest Server Function Refactoring (CRITICAL)

### Task 1: Create `PortalContextResolver` port + `resolvePortalContext` use case

**Files:**

- Create: `src/contexts/guest/application/ports/portal-context-resolver.port.ts`
- Create: `src/contexts/guest/application/use-cases/resolve-portal-context.ts`

**Context:** Both `submitRatingFn` and `submitFeedbackFn` in `src/contexts/guest/server/public.ts` do a direct `db.query.portals.findFirst()` to resolve a portalId into `{ organizationId, propertyId }`. This violates "no direct DB access in server functions". We create a port and a thin use case so the server function calls a use case instead of querying the DB directly.

- [ ] **Step 1: Create the port interface**

Create `src/contexts/guest/application/ports/portal-context-resolver.port.ts`:

```ts
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

/** Resolved portal context — the org and property a portal belongs to. */
export type PortalContext = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

/** Port for resolving portal context without coupling to Drizzle. */
export type PortalContextResolver = Readonly<{
  resolve: (portalId: PortalId) => Promise<PortalContext | null>
}>
```

- [ ] **Step 2: Create the thin use case**

Create `src/contexts/guest/application/use-cases/resolve-portal-context.ts`:

```ts
import type { PortalId } from '#/shared/domain/ids'
import type { PortalContextResolver } from '../ports/portal-context-resolver.port'
import { guestError } from '../../domain/errors'

export type ResolvePortalContextDeps = Readonly<{
  portalContextResolver: PortalContextResolver
}>

export type ResolvePortalContextInput = Readonly<{
  portalId: PortalId
}>

export const resolvePortalContext =
  (deps: ResolvePortalContextDeps) => async (input: ResolvePortalContextInput) => {
    const ctx = await deps.portalContextResolver.resolve(input.portalId)
    if (!ctx) {
      throw guestError('portal_not_found', 'Portal not found')
    }
    return ctx
  }

export type ResolvePortalContext = ReturnType<typeof resolvePortalContext>
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: No type errors for the new files.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/guest/application/ports/portal-context-resolver.port.ts src/contexts/guest/application/use-cases/resolve-portal-context.ts
git commit -m "feat(guest): add PortalContextResolver port and resolvePortalContext use case"
```

---

### Task 2: Implement `PortalContextResolver` in infrastructure + wire in build.ts

**Files:**

- Create: `src/contexts/guest/infrastructure/resolvers/portal-context-resolver.ts`
- Modify: `src/contexts/guest/build.ts`
- Modify: `src/composition.ts`

**Context:** The port from Task 1 needs a Drizzle implementation. The resolver queries the `portals` table (which lives in `shared/db/schema/portal.schema.ts`) to map portalId → organizationId + propertyId.

- [ ] **Step 1: Create the infrastructure implementation**

Create `src/contexts/guest/infrastructure/resolvers/portal-context-resolver.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portals } from '#/shared/db/schema/portal.schema'
import type { PortalContextResolver } from '../../application/ports/portal-context-resolver.port'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

export const createPortalContextResolver = (db: Database): PortalContextResolver => ({
  resolve: async (portalId: PortalId) => {
    const row = await db
      .select({
        organizationId: portals.organizationId,
        propertyId: portals.propertyId,
      })
      .from(portals)
      .where(eq(portals.id, portalId as string))
      .limit(1)

    if (row.length === 0) return null

    return {
      organizationId: row[0].organizationId as OrganizationId,
      propertyId: row[0].propertyId as PropertyId,
    }
  },
})
```

- [ ] **Step 2: Wire in `src/contexts/guest/build.ts`**

Add the new port to the build function. Read the current file first, then:

Add import:

```ts
import { createPortalContextResolver } from './infrastructure/resolvers/portal-context-resolver'
import { resolvePortalContext } from './application/use-cases/resolve-portal-context'
```

In `buildGuestContext`, after creating `guestRepo`, create the resolver and use case:

```ts
const portalContextResolver = createPortalContextResolver(deps.db)

const resolvePortalContextUseCase = resolvePortalContext({
  portalContextResolver,
})
```

Add `resolvePortalContext: resolvePortalContextUseCase` to the `useCases` object.

Return `portalContextResolver` from the build function alongside `guestRepo`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/guest/infrastructure/resolvers/portal-context-resolver.ts src/contexts/guest/build.ts
git commit -m "feat(guest): implement PortalContextResolver and wire in build"
```

---

### Task 3: Create `getPublicPortal` use case + port + infrastructure

**Files:**

- Create: `src/contexts/guest/application/ports/public-portal-lookup.port.ts`
- Create: `src/contexts/guest/application/use-cases/get-public-portal.ts`
- Create: `src/contexts/guest/infrastructure/resolvers/public-portal-lookup.ts`
- Modify: `src/contexts/guest/build.ts`

**Context:** The `getPublicPortal` server function currently has ~40 lines of direct Drizzle queries joining properties, portals, organizations, categories, and links tables. This is the most severe violation — an entire read operation with no use case. The existing `PublicPortalLoaderData` type at `src/contexts/guest/application/dto/public-portal.dto.ts` already defines the return shape.

- [ ] **Step 1: Create the port**

Create `src/contexts/guest/application/ports/public-portal-lookup.port.ts`:

```ts
import type { PublicPortalLoaderData } from '../dto/public-portal.dto'

export type PublicPortalLookup = Readonly<{
  findBySlug: (
    orgSlug: string,
    portalSlug: string,
  ) => Promise<PublicPortalLoaderData | null>
}>
```

- [ ] **Step 2: Create the use case**

Create `src/contexts/guest/application/use-cases/get-public-portal.ts`:

```ts
import type { PublicPortalLookup } from '../ports/public-portal-lookup.port'
import { guestError } from '../../domain/errors'

export type GetPublicPortalDeps = Readonly<{
  publicPortalLookup: PublicPortalLookup
}>

export type GetPublicPortalInput = Readonly<{
  orgSlug: string
  portalSlug: string
}>

export const getPublicPortal =
  (deps: GetPublicPortalDeps) => async (input: GetPublicPortalInput) => {
    const result = await deps.publicPortalLookup.findBySlug(
      input.orgSlug,
      input.portalSlug,
    )
    if (!result) {
      throw guestError('portal_not_found', 'Portal not found')
    }
    return result
  }

export type GetPublicPortal = ReturnType<typeof getPublicPortal>
```

- [ ] **Step 3: Create the infrastructure implementation**

Create `src/contexts/guest/infrastructure/resolvers/public-portal-lookup.ts`.

This file moves the Drizzle queries from the server function into infrastructure. Read the current `getPublicPortal` handler in `src/contexts/guest/server/public.ts` to get the exact query logic, then replicate it here. The implementation should:

1. Query `properties` table by slug to get propertyId
2. Query `portals` table by slug + propertyId
3. Query `organization` table by portal's organizationId
4. Query `portalLinkCategories` by portalId
5. Query `portalLinks` by portalId
6. Return data in `PublicPortalLoaderData` shape (from `src/contexts/guest/application/dto/public-portal.dto.ts`)

The factory signature: `createPublicPortalLookup(db: Database): PublicPortalLookup`

- [ ] **Step 4: Wire in build.ts**

Add imports and create the lookup + use case in `buildGuestContext`. Add `getPublicPortal` to the `useCases` object.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/contexts/guest/application/ports/public-portal-lookup.port.ts src/contexts/guest/application/use-cases/get-public-portal.ts src/contexts/guest/infrastructure/resolvers/public-portal-lookup.ts src/contexts/guest/build.ts
git commit -m "feat(guest): add getPublicPortal use case with port and infrastructure"
```

---

### Task 4: Refactor `server/public.ts` to use the new use cases

**Files:**

- Modify: `src/contexts/guest/server/public.ts`

**Context:** Now that the use cases exist, slim down the server functions. Each server function should only: validate input, extract HTTP-specific context (cookies, headers), call use cases, translate errors. No direct DB queries, no `db` import.

- [ ] **Step 1: Refactor `getPublicPortal`**

Replace the entire handler body. The new handler should be:

```ts
export const getPublicPortal = createServerFn({ method: 'GET' })
  .inputValidator(publicPortalSchema)
  .handler(async ({ data }) => {
    const { useCases } = getContainer()
    return useCases.getPublicPortal({
      orgSlug: data.orgSlug,
      portalSlug: data.portalSlug,
    })
  })
```

Remove all Drizzle imports (`portals`, `portalLinkCategories`, `portalLinks`, `properties`, `eq`, `and`, `sql`) that were only used by `getPublicPortal`. Keep any that are still needed by other functions.

- [ ] **Step 2: Refactor `submitRatingFn`**

Replace the direct DB query with the new `resolvePortalContext` use case. The handler becomes:

```ts
.handler(async ({ data }) => {
    const { useCases, rateLimiter } = getContainer()
    const headers = headersFromContext()

    // HTTP concerns: extract session, check rate limit, hash IP
    const cookieHeader = headers?.get('cookie') ?? ''
    const sessionId = cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? crypto.randomUUID()

    const rateResult = await rateLimiter.check(`rating:${sessionId}`)
    if (!rateResult.allowed) {
      throw guestError('rate_limit_exceeded', 'Too many requests')
    }

    const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipHash = hashIp(ip)

    // Resolve portal context via use case (no direct DB query)
    const ctx = await useCases.resolvePortalContext({ portalId: portalId(data.portalId) })

    // Call existing use case
    const rating = await useCases.submitRating({
      organizationId: ctx.organizationId,
      portalId: portalId(data.portalId),
      propertyId: ctx.propertyId,
      sessionId,
      value: data.value,
      source: data.source,
      ipHash,
    })
    return { success: true, ratingId: rating.id }
  })
```

- [ ] **Step 3: Refactor `submitFeedbackFn`**

Same pattern as submitRatingFn. Replace the direct DB query with `useCases.resolvePortalContext(...)`.

- [ ] **Step 4: Remove unused imports**

After refactoring, remove:

- `import { organizationId, propertyId, portalId, ratingId } from '#/shared/domain/ids'` — keep only `portalId` if still used in the DTO schema. Remove `organizationId` and `propertyId` since they're no longer constructed here.
- Remove the `db` destructuring from `getContainer()` calls (no longer needed).
- Remove any Drizzle schema imports that are no longer used.

Keep:

- `import { getContainer } from '#/composition'`
- `import { headersFromContext } from '#/shared/auth/headers'`
- `import { ratingInputSchema } from '../application/dto/rating.dto'`
- `import { feedbackInputSchema } from '../application/dto/feedback.dto'`
- `import { isGuestError, guestError } from '../domain/errors'`
- `import { portalId } from '#/shared/domain/ids'` (if still used)
- `hashIp` function (stays for now — it's pure, just in the wrong file; moving it is a separate cleanup)

- [ ] **Step 5: Verify typecheck and tests**

Run: `pnpm tsc --noEmit`
Expected: No type errors.

Run: `pnpm vitest run src/contexts/guest/ --reporter=verbose`
Expected: All existing tests pass (use case tests are unchanged; server function tests, if any, may need the mock container updated with the new use cases).

- [ ] **Step 6: Commit**

```bash
git add src/contexts/guest/server/public.ts
git commit -m "refactor(guest): remove direct DB queries from server functions, delegate to use cases"
```

---

## Phase 2: Form Schema Derivation (HIGH)

### Task 5: CreatePortalForm — derive schema from DTO

**Files:**

- Modify: `src/components/features/portal/CreatePortalForm.tsx`

**Context:** The current inline schema duplicates `name` (min 1, max 100) and `description` (max 500) rules that already exist in `createPortalInputSchema` at `src/contexts/portal/application/dto/create-portal.dto.ts`.

Current:

```ts
const createFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().max(64, 'Slug must be at most 64 characters'),
  description: z.string().max(500, 'Description must be at most 500 characters'),
  primaryColor: z.string().min(1, 'Color is required'),
})
```

- [ ] **Step 1: Add DTO import and replace schema**

```ts
import { createPortalInputSchema } from '#/contexts/portal/application/dto/create-portal.dto'
```

Replace the inline schema with:

```ts
const createFormSchema = createPortalInputSchema
  .pick({ name: true, slug: true, description: true })
  .extend({
    slug: z.string().max(64, 'Slug must be at most 64 characters'),
    primaryColor: z.string().min(1, 'Color is required'),
  })
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm tsc --noEmit` — no errors.
Commit: `git commit -m "fix: derive CreatePortalForm schema from DTO"`

---

### Task 6: EditPortalForm — derive schema from DTO

**Files:**

- Modify: `src/components/features/portal/EditPortalForm.tsx`

**Context:** Same pattern. DTO at `src/contexts/portal/application/dto/update-portal.dto.ts`.

- [ ] **Step 1: Add DTO import and replace schema**

```ts
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'
```

Replace inline schema with:

```ts
const editFormSchema = updatePortalInputSchema
  .pick({ name: true, slug: true, description: true })
  .required()
  .extend({ description: z.string().max(500) })
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm tsc --noEmit` — no errors.
Commit: `git commit -m "fix: derive EditPortalForm schema from DTO"`

---

### Task 7: EditTeamForm — derive schema from DTO

**Files:**

- Modify: `src/components/features/team/EditTeamForm.tsx`

**Context:** DTO at `src/contexts/team/application/dto/update-team.dto.ts`. Already imports `UpdateTeamInput` type.

- [ ] **Step 1: Add schema import and replace**

```ts
import { updateTeamInputSchema } from '#/contexts/team/application/dto/update-team.dto'
```

Replace inline schema with:

```ts
const formSchema = updateTeamInputSchema.required().extend({
  description: z.string().max(500),
  teamLeadId: z.string(),
})
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm tsc --noEmit` — no errors.
Commit: `git commit -m "fix: derive EditTeamForm schema from DTO"`

---

### Task 8: AssignStaffForm — derive schema from DTO

**Files:**

- Modify: `src/components/features/staff/AssignStaffForm.tsx`

**Context:** DTO at `src/contexts/staff/application/dto/staff-assignment.dto.ts`. Form shape differs (multi-select `userIds` vs single `userId`), so use `.pick()` + `.extend()`.

- [ ] **Step 1: Add schema import and replace**

```ts
import { createStaffAssignmentInputSchema } from '#/contexts/staff/application/dto/staff-assignment.dto'
```

Replace inline schema with:

```ts
const formSchema = createStaffAssignmentInputSchema.pick({ propertyId: true }).extend({
  userIds: z.array(z.string()).min(1, 'Select at least one staff member'),
  teamId: z.string().nullable(),
})
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm tsc --noEmit` — no errors.
Commit: `git commit -m "fix: derive AssignStaffForm schema from DTO"`

---

## Phase 3: Tagged Errors (HIGH)

### Task 9: Portal infrastructure — replace plain Error throws

**Files:**

- Modify: `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts`
- Modify: `src/contexts/portal/infrastructure/mappers/portal.mapper.ts`
- Modify: `src/contexts/portal/infrastructure/adapters/r2-storage.adapter.ts`

**Context:** The portal domain has tagged errors at `src/contexts/portal/domain/errors.ts` with `portalError(code, message)`. Infrastructure throws plain `new Error(...)`.

- [ ] **Step 1: Fix portal-link.repository.ts**

Add import: `import { portalError } from '../../domain/errors'`

Replace each `throw new Error(...)`:

- `throw new Error('Tenant mismatch on ...')` → `throw portalError('forbidden', 'Tenant mismatch on ...')`

- [ ] **Step 2: Fix portal.mapper.ts**

Add import: `import { portalError } from '../../domain/errors'`

Replace `throw new Error('Missing required portal fields')` → `throw portalError('portal_not_found', 'Missing required portal fields in row')`
Replace `throw new Error('Invalid portal data for row conversion')` → `throw portalError('portal_not_found', 'Invalid portal data for row conversion')`

- [ ] **Step 3: Fix r2-storage.adapter.ts**

Add import: `import { portalError } from '../../domain/errors'`

Replace each `throw new Error('S3 storage is not configured')` → `throw portalError('upload_failed', 'S3 storage is not configured')`
Replace `throw new Error('Invalid ... URL')` → `throw portalError('invalid_url', ...)`

- [ ] **Step 4: Verify and commit**

Run: `pnpm tsc --noEmit && pnpm vitest run src/contexts/portal/`
Expected: No errors, tests pass.

Commit: `git commit -m "fix: replace plain Error throws with tagged portalError in infrastructure"`

---

## Phase 4: Documentation (MEDIUM)

### Task 10: Document public-api cross-context exception in conventions.md

**Files:**

- Modify: `docs/conventions.md`

- [ ] **Step 1: Add exception to dependency rules section**

After the "Forbidden:" list in "Dependency rules (enforced by lint)", add:

```markdown
**Exception — cross-context public API:**
Contexts may import from another context's `application/public-api.ts` file. This file acts as a bounded-context facade — it exposes only the operations and types that the owning context makes available to other contexts. It is the approved mechanism for cross-context communication at the application layer.

This exception does NOT allow importing from another context's `domain/`, `infrastructure/`, `server/`, or non-public-api `application/` files.
```

- [ ] **Step 2: Commit**

Commit: `git commit -m "docs: document public-api cross-context exception in dependency rules"`

---

## Phase 5: Final Verification

### Task 11: Full typecheck + test suite

- [ ] **Step 1: Run `pnpm tsc --noEmit`** — zero errors
- [ ] **Step 2: Run `pnpm vitest run`** — all tests pass
- [ ] **Step 3: Verify no direct DB imports remain in server/public.ts**

```bash
grep -n 'db\.' src/contexts/guest/server/public.ts
```

Expected: No matches (all direct DB queries removed).

---

## Self-Review

**Spec coverage:**

- CRITICAL #1 (guest server functions) → Tasks 1-4
- HIGH #3 (form schemas, 5 forms) → Tasks 5-8
- HIGH #5 (plain Error throws) → Task 9
- CRITICAL #2 (public-api undocumented) → Task 10
- ResetPasswordForm → NOT a violation (no server function / no DTO)
- OrganizationSettingsForm → Deferred (needs new DTO first)

**Placeholder scan:** No TBD, TODO, "implement later". Task 3 Step 3 instructs implementer to read the server file and replicate the exact query logic.

**Type consistency:**

- `PortalContextResolver.resolve(portalId)` → returns `PortalContext | null`
- `resolvePortalContext` use case → throws `GuestError` on null, returns `PortalContext`
- `PublicPortalLookup.findBySlug(orgSlug, portalSlug)` → returns `PublicPortalLoaderData | null`
- `getPublicPortal` use case → throws `GuestError` on null, returns `PublicPortalLoaderData`
- Server functions call `useCases.resolvePortalContext()` and `useCases.getPublicPortal()`
- Form schemas derive from the exact DTO schemas named in each task
