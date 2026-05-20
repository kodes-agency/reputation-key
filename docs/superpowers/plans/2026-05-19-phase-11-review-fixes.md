# Phase 11 Code Review Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all code review findings from phase 11 — add role-scoped property access to mutation use cases, fix `'AccountAdmin' as Role` type assertion, add error handling to catch blocks, extract magic number, and reduce inbox page size.

**Architecture:** The mutation use cases (`updateInboxStatus`, `bulkUpdateInboxStatus`, `assignInboxItem`, `addInboxNote`) need the same property access enforcement pattern already used in the read use cases. The pattern: after finding the item, check `hasRole(role, 'AccountAdmin')` — if not admin, fetch accessible property IDs via `staffPublicApi.getAccessiblePropertyIds()` and throw `inboxError('forbidden', ...)` if the item's property isn't in the list. This requires adding `staffPublicApi` and `role`/`userId` to each mutation's deps and input types.

**Tech Stack:** TypeScript, Vitest, React, TanStack Router

---

### Task 1: Add property access check to `updateInboxStatus` use case

**Files:**

- Modify: `src/contexts/inbox/application/use-cases/update-inbox-status.ts`
- Test: `src/contexts/inbox/application/use-cases/update-inbox-status.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/contexts/inbox/application/use-cases/update-inbox-status.test.ts`. Add the `staffPublicApi` mock and the forbidden test after the existing tests:

```typescript
// Add these imports at the top (after existing imports):
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'

// Add this after the `decrements` setup, replacing the existing `setup` function:

const staffApiAllAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
}

const setup = (staffApi = staffApiAllAccess) => {
  const repo = createInmemoryInboxRepo()
  const events = createCapturingEventBus()
  const decrements: Array<{ orgId: string; userId: string }> = []
  const unreadCounter: UnreadCounterPort = {
    getCount: async () => 0,
    setCount: async () => {},
    increment: async () => {},
    decrement: async (orgId, uId) => {
      decrements.push({ orgId: orgId as string, userId: uId as string })
    },
    invalidate: async () => {},
  }
  const deps = {
    repo,
    events,
    unreadCounter,
    clock: () => FIXED_TIME,
    staffPublicApi: staffApi,
  }
  const useCase = updateInboxStatus(deps)
  return { useCase, repo, events, decrements }
}
```

Then add these test cases at the end of the describe block:

```typescript
it('allows update when user has access to the property', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => [propertyId('prop-1')],
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew())

  const updated = await useCase({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    newStatus: 'read',
    userId: USER_ID,
    role: 'PropertyManager' as Role,
  })

  expect(updated.status).toBe('read')
})

it('throws forbidden when non-admin user cannot access the property', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => [propertyId('prop-other')],
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew())

  await expect(
    useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
      role: 'PropertyManager' as Role,
    }),
  ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
})

it('skips property check for AccountAdmin role', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => {
      throw new Error('should not be called')
    },
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew())

  const updated = await useCase({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    newStatus: 'read',
    userId: USER_ID,
    role: 'AccountAdmin' as Role,
  })

  expect(updated.status).toBe('read')
})
```

Note: The existing tests will fail after this because `setup()` now requires `staffPublicApi` in deps and the `useCase` call needs `role`. Update all existing `useCase(...)` calls in the test to include `role: 'AccountAdmin' as Role`. The existing `seedNew()` stays unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/contexts/inbox/application/use-cases/update-inbox-status.test.ts`
Expected: FAIL — type errors because `UpdateInboxStatusDeps` doesn't include `staffPublicApi` and `UpdateInboxStatusInput` doesn't include `role`.

- [ ] **Step 3: Update `updateInboxStatus` use case**

In `src/contexts/inbox/application/use-cases/update-inbox-status.ts`, apply these changes:

Add imports:

```typescript
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { hasRole } from '#/shared/domain/roles'
```

Update `UpdateInboxStatusInput` — add `role`:

```typescript
export type UpdateInboxStatusInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  newStatus: InboxStatus
  userId: UserId
  role: Role
}>
```

Update `UpdateInboxStatusDeps` — add `staffPublicApi`:

```typescript
export type UpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  unreadCounter: UnreadCounterPort
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>
```

Add property access check after finding the item (after step "1. Find item", before step "2. Validate transition"):

```typescript
// 1b. Enforce role-scoped property access
if (!hasRole(input.role, 'AccountAdmin')) {
  const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
    input.organizationId,
    input.userId,
    input.role,
  )
  if (
    accessible !== null &&
    !accessible.includes(
      item.propertyId as ReturnType<typeof import('#/shared/domain/ids').propertyId>,
    )
  ) {
    throw inboxError('forbidden', 'No access to this property', {
      propertyId: item.propertyId,
    })
  }
}
```

- [ ] **Step 4: Update build.ts wiring**

In `src/contexts/inbox/build.ts`, update the `updateInboxStatus` wiring to pass `staffPublicApi`:

```typescript
    updateInboxStatus: updateInboxStatus({
      repo: inboxRepo,
      events: input.events,
      unreadCounter,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
```

- [ ] **Step 5: Update server function to pass `role`**

In `src/contexts/inbox/server/inbox.ts`, update `updateInboxStatusFn` handler to pass `role`:

```typescript
return await useCases.updateInboxStatus({
  inboxItemId: inboxItemId(data.inboxItemId),
  organizationId: ctx.organizationId,
  newStatus: data.status,
  userId: ctx.userId,
  role: ctx.role,
})
```

Note: `ctx.role` is already a `Role` type from `resolveTenantContext`. Remove the `import type { Role } from '#/shared/domain/roles'` if it was added from the diff — the server function doesn't need it since `ctx.role` is already typed.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/contexts/inbox/application/use-cases/update-inbox-status.test.ts`
Expected: PASS — all existing tests and new property access tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/contexts/inbox/application/use-cases/update-inbox-status.ts src/contexts/inbox/application/use-cases/update-inbox-status.test.ts src/contexts/inbox/build.ts src/contexts/inbox/server/inbox.ts
git commit -m "fix(inbox): add role-scoped property access to updateInboxStatus use case"
```

---

### Task 2: Add property access check to `bulkUpdateInboxStatus` use case

**Files:**

- Modify: `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts`
- Test: `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts`:

Add imports:

```typescript
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
```

Update the `setup` function to include `staffPublicApi` in deps and add `role` to the use case input. Add `role: 'AccountAdmin' as Role` to all existing `useCase(...)` calls.

Add test cases:

```typescript
it('filters out items from inaccessible properties for non-admin', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => [propertyId('prop-1')],
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew({ id: inboxItemId('ii-1'), propertyId: propertyId('prop-1') }))
  repo.items.push(seedNew({ id: inboxItemId('ii-2'), propertyId: propertyId('prop-2') }))

  const result = await useCase({
    inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
    organizationId: ORG_ID,
    newStatus: 'read',
    userId: USER_ID,
    role: 'PropertyManager' as Role,
  })

  expect(result.updated).toBe(1)
})

it('processes all items for AccountAdmin', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => {
      throw new Error('should not be called')
    },
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew({ id: inboxItemId('ii-1') }))
  repo.items.push(seedNew({ id: inboxItemId('ii-2') }))

  const result = await useCase({
    inboxItemIds: [inboxItemId('ii-1'), inboxItemId('ii-2')],
    organizationId: ORG_ID,
    newStatus: 'read',
    userId: USER_ID,
    role: 'AccountAdmin' as Role,
  })

  expect(result.updated).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts`
Expected: FAIL — type errors.

- [ ] **Step 3: Update `bulkUpdateInboxStatus` use case**

In `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts`:

Add imports:

```typescript
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { hasRole } from '#/shared/domain/roles'
```

Update `BulkUpdateInboxStatusInput` — add `role`:

```typescript
export type BulkUpdateInboxStatusInput = Readonly<{
  inboxItemIds: ReadonlyArray<InboxItemId>
  organizationId: OrganizationId
  newStatus: InboxStatus
  userId: UserId
  role: Role
}>
```

Update `BulkUpdateInboxStatusDeps` — add `staffPublicApi`:

```typescript
export type BulkUpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  unreadCounter: UnreadCounterPort
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>
```

Inside the `for` loop that validates each item, after `if (!item) continue`, add the access check:

```typescript
// Enforce role-scoped property access
if (!hasRole(input.role, 'AccountAdmin')) {
  let accessible: Awaited<ReturnType<StaffPublicApi['getAccessiblePropertyIds']>> = null
  try {
    accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
      input.organizationId,
      input.userId,
      input.role,
    )
  } catch {
    continue // If access check fails, skip this item
  }
  if (
    accessible !== null &&
    !accessible.includes(
      item.propertyId as ReturnType<typeof import('#/shared/domain/ids').propertyId>,
    )
  ) {
    continue // Skip items from inaccessible properties
  }
}
```

Note: For bulk operations, we skip inaccessible items rather than throwing. This matches the existing pattern of filtering out invalid items.

- [ ] **Step 4: Update build.ts wiring**

In `src/contexts/inbox/build.ts`, update `bulkUpdateInboxStatus` wiring:

```typescript
    bulkUpdateInboxStatus: bulkUpdateInboxStatus({
      repo: inboxRepo,
      events: input.events,
      unreadCounter,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
```

- [ ] **Step 5: Update server function**

In `src/contexts/inbox/server/inbox.ts`, update `bulkUpdateInboxStatusFn`:

```typescript
return await useCases.bulkUpdateInboxStatus({
  inboxItemIds: data.inboxItemIds.map((id) => inboxItemId(id)),
  organizationId: ctx.organizationId,
  newStatus: data.status,
  userId: ctx.userId,
  role: ctx.role,
})
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts src/contexts/inbox/build.ts src/contexts/inbox/server/inbox.ts
git commit -m "fix(inbox): add role-scoped property access to bulkUpdateInboxStatus use case"
```

---

### Task 3: Add property access check to `assignInboxItem` use case

**Files:**

- Modify: `src/contexts/inbox/application/use-cases/assign-inbox-item.ts`
- Test: `src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts`:

Add imports:

```typescript
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
```

Update the `setup` function to include `staffPublicApi` in deps. Add `role: 'AccountAdmin' as Role` to all existing `useCase(...)` calls (add `userId` too if not present — the current signature uses `role` but not `userId`; both are needed for the access check).

Add test cases:

```typescript
it('throws forbidden when non-admin assigns item for inaccessible property', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => [propertyId('prop-other')],
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew())

  await expect(
    useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      assignedToUserId: userId('user-2'),
      role: 'PropertyManager' as Role,
      userId: USER_ID,
    }),
  ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
})

it('allows assignment when user has access to the property', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => [propertyId('prop-1')],
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew())

  const updated = await useCase({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    assignedToUserId: userId('user-2'),
    role: 'PropertyManager' as Role,
    userId: USER_ID,
  })

  expect(updated.assignedTo).toBe(userId('user-2') as string)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `assignInboxItem` use case**

In `src/contexts/inbox/application/use-cases/assign-inbox-item.ts`:

Add imports:

```typescript
import type { Role } from '#/shared/domain/roles'
import type { UserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { hasRole } from '#/shared/domain/roles'
```

Update `AssignInboxItemInput` — change `role: string` to `role: Role` and add `userId`:

```typescript
export type AssignInboxItemInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  assignedToUserId: UserId | null
  role: Role
  userId: UserId
}>
```

Update `AssignInboxItemDeps` — add `staffPublicApi`:

```typescript
export type AssignInboxItemDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>
```

After step "2. Find item" (after the `not_found` throw), add:

```typescript
// 2b. Enforce role-scoped property access
if (!hasRole(input.role, 'AccountAdmin')) {
  const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
    input.organizationId,
    input.userId,
    input.role,
  )
  if (
    accessible !== null &&
    !accessible.includes(
      item.propertyId as ReturnType<typeof import('#/shared/domain/ids').propertyId>,
    )
  ) {
    throw inboxError('forbidden', 'No access to this property', {
      propertyId: item.propertyId,
    })
  }
}
```

- [ ] **Step 4: Update build.ts wiring**

In `src/contexts/inbox/build.ts`, update `assignInboxItem` wiring:

```typescript
    assignInboxItem: assignInboxItem({
      repo: inboxRepo,
      events: input.events,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
```

- [ ] **Step 5: Update server function**

In `src/contexts/inbox/server/inbox.ts`, update `assignInboxItemFn` — add `userId` to the call:

```typescript
return await useCases.assignInboxItem({
  inboxItemId: inboxItemId(data.inboxItemId),
  organizationId: ctx.organizationId,
  assignedToUserId: data.assignedToUserId ? toUserId(data.assignedToUserId) : null,
  role: ctx.role,
  userId: ctx.userId,
})
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/contexts/inbox/application/use-cases/assign-inbox-item.ts src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts src/contexts/inbox/build.ts src/contexts/inbox/server/inbox.ts
git commit -m "fix(inbox): add role-scoped property access to assignInboxItem use case"
```

---

### Task 4: Add property access check to `addInboxNote` use case

**Files:**

- Modify: `src/contexts/inbox/application/use-cases/add-inbox-note.ts`
- Test: `src/contexts/inbox/application/use-cases/add-inbox-note.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/contexts/inbox/application/use-cases/add-inbox-note.test.ts`:

Add imports:

```typescript
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Role } from '#/shared/domain/roles'
```

Update the `setup` function to include `staffPublicApi` in deps. Add `role: 'AccountAdmin' as Role` to all existing `useCase(...)` calls.

Add test cases:

```typescript
it('throws forbidden when non-admin adds note for inaccessible property', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => [propertyId('prop-other')],
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew())

  await expect(
    useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      authorUserId: USER_ID,
      text: 'test note',
      role: 'Staff' as Role,
    }),
  ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
})

it('allows note when user has access to the property', async () => {
  const staffApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => [propertyId('prop-1')],
  }
  const { useCase, repo } = setup(staffApi)
  repo.items.push(seedNew())

  const note = await useCase({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    authorUserId: USER_ID,
    text: 'test note',
    role: 'Staff' as Role,
  })

  expect(note.text).toBe('test note')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/contexts/inbox/application/use-cases/add-inbox-note.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `addInboxNote` use case**

In `src/contexts/inbox/application/use-cases/add-inbox-note.ts`:

Add imports:

```typescript
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { hasRole } from '#/shared/domain/roles'
```

Update `AddInboxNoteInput` — add `role`:

```typescript
export type AddInboxNoteInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  authorUserId: UserId
  text: string
  role: Role
}>
```

Update `AddInboxNoteDeps` — add `staffPublicApi`:

```typescript
export type AddInboxNoteDeps = Readonly<{
  repo: InboxRepository
  noteRepo: InboxNoteRepository
  idGen: () => InboxNoteId
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>
```

After step "1. Find item" (after the `not_found` throw), add:

```typescript
// 1b. Enforce role-scoped property access
if (!hasRole(input.role, 'AccountAdmin')) {
  const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
    input.organizationId,
    input.authorUserId,
    input.role,
  )
  if (
    accessible !== null &&
    !accessible.includes(
      item.propertyId as ReturnType<typeof import('#/shared/domain/ids').propertyId>,
    )
  ) {
    throw inboxError('forbidden', 'No access to this property', {
      propertyId: item.propertyId,
    })
  }
}
```

- [ ] **Step 4: Update build.ts wiring**

In `src/contexts/inbox/build.ts`, update `addInboxNote` wiring:

```typescript
    addInboxNote: addInboxNote({
      repo: inboxRepo,
      noteRepo: inboxNoteRepo,
      idGen: () => inboxNoteId(crypto.randomUUID()),
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
```

- [ ] **Step 5: Update server function**

In `src/contexts/inbox/server/inbox.ts`, update `addInboxNoteFn` — add `role`:

```typescript
return await useCases.addInboxNote({
  inboxItemId: inboxItemId(data.inboxItemId),
  organizationId: ctx.organizationId,
  authorUserId: ctx.userId,
  text: data.text,
  role: ctx.role,
})
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/contexts/inbox/application/use-cases/add-inbox-note.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/contexts/inbox/application/use-cases/add-inbox-note.ts src/contexts/inbox/application/use-cases/add-inbox-note.test.ts src/contexts/inbox/build.ts src/contexts/inbox/server/inbox.ts
git commit -m "fix(inbox): add role-scoped property access to addInboxNote use case"
```

---

### Task 5: Fix `'AccountAdmin' as Role` type assertion across use cases

**Files:**

- Modify: `src/contexts/inbox/application/use-cases/get-inbox-items.ts:34`
- Modify: `src/contexts/inbox/application/use-cases/get-inbox-item-detail.ts:36`
- Modify: `src/contexts/inbox/application/use-cases/get-inbox-notes.ts:38`

- [ ] **Step 1: Add a Role constant and use it everywhere**

The `hasRole` function accepts `(userRole: Role, requiredRole: Role)`. The `'AccountAdmin' as Role` cast is needed because the string literal isn't narrowed by TypeScript. Add a constant to the roles module instead.

In `src/shared/domain/roles.ts`, add:

```typescript
export const ADMIN_ROLE: Role = 'AccountAdmin'
```

Then replace all `'AccountAdmin' as Role` in the inbox use cases with just `ADMIN_ROLE`:

In `get-inbox-items.ts`:

```typescript
import { hasRole, ADMIN_ROLE } from '#/shared/domain/roles'
// ...
    if (!hasRole(input.role, ADMIN_ROLE)) {
```

In `get-inbox-item-detail.ts`:

```typescript
import { hasRole, ADMIN_ROLE } from '#/shared/domain/roles'
// ...
    if (!hasRole(input.role, ADMIN_ROLE)) {
```

In `get-inbox-notes.ts`:

```typescript
import { hasRole, ADMIN_ROLE } from '#/shared/domain/roles'
// ...
    if (!hasRole(input.role, ADMIN_ROLE)) {
```

The new use cases from Tasks 1-4 should also use `ADMIN_ROLE` instead of `'AccountAdmin'`.

- [ ] **Step 2: Run all inbox tests**

Run: `npx vitest run src/contexts/inbox/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/domain/roles.ts src/contexts/inbox/application/use-cases/
git commit -m "refactor(inbox): replace 'AccountAdmin' as Role with ADMIN_ROLE constant"
```

---

### Task 6: Add error state to empty catch blocks

**Files:**

- Modify: `src/components/inbox/use-inbox-detail.ts`
- Modify: `src/components/inbox/inbox-filters.tsx`

- [ ] **Step 1: Add error state to `useInboxDetail` hook**

In `src/components/inbox/use-inbox-detail.ts`, add an error state and expose it:

Add to state declarations:

```typescript
const [error, setError] = useState<string | null>(null)
```

Update `InboxDetailState` type to include `error`:

```typescript
export type InboxDetailState = Readonly<{
  detail: InboxItemDetail | null
  notes: ReadonlyArray<InboxNote>
  isLoading: boolean
  error: string | null
  currentItem: InboxItem | null
  updateStatus: ReturnType<typeof useMutationAction<typeof updateInboxStatusFn>>
  refresh: () => void
}>
```

In `loadDetail`, set `setError(null)` at start, and in the catch block:

```typescript
    } catch {
      if (!abortRef.current) {
        setError('Failed to load detail. Try again.')
      }
```

Return `error` from the hook:

```typescript
return {
  detail,
  notes,
  isLoading: isLoadingDetail,
  error,
  currentItem: detail?.item ?? item,
  updateStatus,
  refresh: loadDetail,
}
```

- [ ] **Step 2: Show error in `InboxDetailSheet` and desktop panel**

In `src/components/inbox/inbox-detail-sheet.tsx`, after the loading skeleton, add error display:

```tsx
        {detailState.error ? (
          <div className="space-y-4 p-4">
            <p className="text-sm text-destructive">{detailState.error}</p>
            <Button variant="outline" size="sm" onClick={detailState.refresh}>
              Retry
            </Button>
          </div>
        ) : detailState.isLoading || !detailState.currentItem ? (
```

Add `Button` import from `#/components/ui/button` to `inbox-detail-sheet.tsx`.

In `src/routes/_authenticated/inbox/index.tsx`, do the same for the desktop detail panel — after the loading skeleton in the detail content section, add the error state:

```tsx
            {detailState.error ? (
              <div className="space-y-4 p-4">
                <p className="text-sm text-destructive">{detailState.error}</p>
                <Button variant="outline" size="sm" onClick={() => { void detailState.refresh() }}>
                  Retry
                </Button>
              </div>
            ) : detailState.isLoading || !currentItem ? (
```

- [ ] **Step 3: Add error handling for property filter**

In `src/components/inbox/inbox-filters.tsx`, add error state for properties:

```typescript
const [propertiesError, setPropertiesError] = useState(false)
```

In `loadProperties`, update the catch:

```typescript
    } catch {
      setPropertiesError(true)
    }
```

Show a small error indicator when properties fail to load:

```tsx
      {propertiesError && (
        <span className="text-xs text-muted-foreground">Properties unavailable</span>
      )}
      {properties.length > 1 && (
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/use-inbox-detail.ts src/components/inbox/inbox-detail-sheet.tsx src/components/inbox/inbox-filters.tsx src/routes/_authenticated/inbox/index.tsx
git commit -m "fix(inbox): add error states to catch blocks in detail hook and filters"
```

---

### Task 7: Extract page size constant and reduce inbox page complexity

**Files:**

- Modify: `src/routes/_authenticated/inbox/index.tsx`

- [ ] **Step 1: Extract `INBOX_PAGE_SIZE` constant**

In `src/routes/_authenticated/inbox/index.tsx`, add at the top (after imports):

```typescript
const INBOX_PAGE_SIZE = 50
```

Replace `limit: 50` with `limit: INBOX_PAGE_SIZE` in the `loadItems` callback.

- [ ] **Step 2: Extract `useInboxMarkRead` into the detail hook**

The auto-mark-read logic (debounce timer + `lastMarkedRef`) adds complexity to the page. Move it into `useInboxDetail` as an option.

In `src/components/inbox/use-inbox-detail.ts`, add an optional `autoMarkRead` parameter:

```typescript
export type UseInboxDetailOptions = Readonly<{
  autoMarkRead?: boolean
}>

export function useInboxDetail(
  item: InboxItem | null,
  active: boolean,
  options?: UseInboxDetailOptions,
): InboxDetailState {
```

Inside the hook, add the auto-mark-read effect:

```typescript
// Auto-mark as read (debounced 500ms) when item is selected
const markReadMutation = useMutationAction(updateInboxStatusFn, {
  onSuccess: () => {
    // Optimistic update handled by the page — no-op here
  },
})
const markReadRef = useRef(markReadMutation)
markReadRef.current = markReadMutation
const lastMarkedRef = useRef<string | null>(null)

useEffect(() => {
  if (!options?.autoMarkRead || !active || !item) return
  if (lastMarkedRef.current === item.id) return
  if (item.status !== 'new') return

  const timer = setTimeout(() => {
    lastMarkedRef.current = item.id
    markReadRef.current({ data: { inboxItemId: item.id, status: 'read' } })
  }, 500)
  return () => clearTimeout(timer)
}, [options?.autoMarkRead, active, item])
```

Expose `markReadMutation` in the return type if the page needs the `onSuccess` callback, or move the optimistic items update into the hook itself. The simpler approach: return `markItemId` from the hook so the page can do the optimistic update.

Add to `InboxDetailState`:

```typescript
lastMarkedId: string | null
```

Return:

```typescript
    lastMarkedId: lastMarkedRef.current,
```

Then in `index.tsx`, remove the `markReadMutation`, `markReadRef`, `lastMarkedRef`, and the `useEffect` for auto-mark-read. Instead, pass `autoMarkRead: true` to the hook and use `detailState.lastMarkedId` for the optimistic update:

```typescript
const detailState = useInboxDetail(selectedItem, !!selectedItem, { autoMarkRead: true })

// Optimistic UI: mark item as read in local list
useEffect(() => {
  if (detailState.lastMarkedId) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === detailState.lastMarkedId
          ? { ...i, status: 'read' as const, readAt: new Date() }
          : i,
      ),
    )
  }
}, [detailState.lastMarkedId])
```

This reduces the inbox page by ~20 lines and keeps the mark-read concern in the hook.

- [ ] **Step 3: Run type check and tests**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/inbox/use-inbox-detail.ts src/components/inbox/index.ts src/routes/_authenticated/inbox/index.tsx
git commit -m "refactor(inbox): extract page size constant, move auto-mark-read into useInboxDetail hook"
```

---

### Task 8: Run full inbox test suite and type check

**Files:**

- No new files

- [ ] **Step 1: Run all inbox tests**

Run: `npx vitest run src/contexts/inbox/`
Expected: ALL PASS

- [ ] **Step 2: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run dev server and verify inbox page loads**

Run: `npx vite dev` (or the project's dev command)

Open the inbox page and verify:

- List loads with items
- Clicking an item opens the detail panel (desktop) or sheet (mobile)
- Filters work (status, source type, property)
- Status update buttons work
- Load more button appears for paginated results

- [ ] **Step 4: Final commit (if any test fixes needed)**

```bash
git add -u
git commit -m "fix(inbox): final test and type check adjustments"
```
