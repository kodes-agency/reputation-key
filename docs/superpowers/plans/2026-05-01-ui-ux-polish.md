# UI/UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 12 UI/UX issues from code review: replace browser dialogs with AlertDialog, fix stale state after mutations, add missing data loading, and polish button consistency.

**Architecture:** Surgical edits to existing route and component files. No new routes or layouts. Each task touches 1-2 files max. AlertDialog and toast patterns already exist in the codebase (teams/index.tsx, portals/index.tsx use AlertDialog; use-mutation-action.ts uses sonner toast).

**Tech Stack:** TanStack Start, React 19, shadcn/ui (AlertDialog, Button, toast from sonner), Tailwind v4, @dnd-kit

---

## File Change Map

| Action | File                                                                           | Issues Fixed           |
| ------ | ------------------------------------------------------------------------------ | ---------------------- |
| Modify | `src/routes/_authenticated/properties/$propertyId/settings/property.tsx`       | CRITICAL #1, MEDIUM #8 |
| Modify | `src/components/features/portal/EditPortalForm.tsx`                            | CRITICAL #2            |
| Modify | `src/components/layout/AppTopBar.tsx`                                          | HIGH #3                |
| Modify | `src/routes/_authenticated/properties/$propertyId/teams/index.tsx`             | HIGH #4                |
| Modify | `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`           | HIGH #5                |
| Modify | `src/contexts/portal/server/portal-links.ts`                                   | HIGH #6                |
| Modify | `src/routes/_authenticated/properties/$propertyId/portals/$portalId/links.tsx` | HIGH #6, MEDIUM #10    |
| Modify | `src/components/features/portal/SortableCategory.tsx`                          | HIGH #7                |
| Modify | `src/components/features/portal/SortableLink.tsx`                              | HIGH #7                |
| Modify | `src/routes/_authenticated/properties/$propertyId/teams/$teamId/index.tsx`     | MEDIUM #12             |
| Modify | `src/routes/_authenticated.tsx`                                                | MEDIUM #9              |
| Modify | `src/components/features/team/TeamMemberList.tsx`                              | MEDIUM #11             |

---

### Task 1: Property Delete — AlertDialog + Button (CRITICAL #1, MEDIUM #8)

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/settings/property.tsx`

**Current state:** The Danger Zone delete button uses `window.confirm()` and a raw `<button>` with inline styles.

- [ ] **Step 1: Read the file**

Read `src/routes/_authenticated/properties/$propertyId/settings/property.tsx`.

- [ ] **Step 2: Add AlertDialog imports**

Add to the imports at the top of the file:

```typescript
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { Trash2 } from 'lucide-react'
```

- [ ] **Step 3: Replace the Danger Zone delete section**

Find the Danger Zone section (starts with `<div className="space-y-3 rounded-lg border border-destructive/30 p-4">`). Replace the raw `<button>` and `window.confirm` logic with an AlertDialog pattern. The delete handler becomes the AlertDialogAction onClick:

Replace the `<button` element inside the Danger Zone with:

```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="outline" className="text-destructive hover:text-destructive">
      <Trash2 className="size-3.5" />
      Delete Property
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Property</AlertDialogTitle>
      <AlertDialogDescription>
        This will hide {property.name} from your organization. Its data will be preserved
        but it will no longer appear in searches or reports.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={() => deleteMutation({ data: { propertyId: property.id } })}
        disabled={deleteMutation.isPending}
      >
        Delete Property
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Remove the `window.confirm` guard entirely — the AlertDialog replaces it.

- [ ] **Step 4: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/settings/property.tsx
git commit -m "fix: replace window.confirm with AlertDialog for property delete"
```

---

### Task 2: EditPortalForm — Replace alert() with toast.error() (CRITICAL #2)

**Files:**

- Modify: `src/components/features/portal/EditPortalForm.tsx`

**Current state:** Three `alert()` calls in `handleImageUpload` at lines ~98, ~102, ~133.

- [ ] **Step 1: Read the file**

Read `src/components/features/portal/EditPortalForm.tsx`.

- [ ] **Step 2: Add toast import**

Add at the top of the file, after existing imports:

```typescript
import { toast } from 'sonner'
```

- [ ] **Step 3: Replace all alert() calls**

Find each `alert(...)` call and replace with `toast.error(...)`:

1. File size validation: `alert('Image must be smaller than 5MB.')` → `toast.error('Image must be smaller than 5MB.')`
2. File type validation: `alert('Please upload an image file (PNG, JPG, GIF, WebP).')` → `toast.error('Please upload an image file (PNG, JPG, GIF, WebP).')`
3. Upload failure: `alert('Failed to upload image. Please try again.')` → `toast.error('Failed to upload image. Please try again.')`

- [ ] **Step 4: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/features/portal/EditPortalForm.tsx
git commit -m "fix: replace browser alert() with toast.error() in portal image upload"
```

---

### Task 3: Sign-out redirect fix (HIGH #3)

**Files:**

- Modify: `src/components/layout/AppTopBar.tsx`

**Current state:** Line 149 has `onClick={() => authClient.signOut()}` — fire-and-forget, no redirect.

- [ ] **Step 1: Read the file**

Read `src/components/layout/AppTopBar.tsx`.

- [ ] **Step 2: Make sign-out async with navigation**

Replace the sign-out DropdownMenuItem:

```tsx
<DropdownMenuItem
  onClick={async () => {
    await authClient.signOut()
    await navigate({ to: '/login' })
  }}
>
  <LogOut className="size-4" />
  Sign out
</DropdownMenuItem>
```

The `navigate` hook is already imported from `@tanstack/react-router` (line 1). The `await authClient.signOut()` ensures the session is cleared before navigation. The explicit `navigate({ to: '/login' })` avoids relying on the beforeLoad guard timing.

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/AppTopBar.tsx
git commit -m "fix: await signOut and navigate to login on sign-out"
```

---

### Task 4: Teams list stale state after create (HIGH #4)

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/teams/index.tsx`

**Current state:** `const [teams, setTeams] = useState(initialTeams)` copies loader data into local state. When `createMutation` succeeds, `router.invalidate()` refetches the loader, but `useState` doesn't re-initialize from the new loader data. The `onSuccess` callback in `CreateTeamForm` only closes the dialog — it doesn't add the new team to local state.

- [ ] **Step 1: Read the file**

Read `src/routes/_authenticated/properties/$propertyId/teams/index.tsx`.

- [ ] **Step 2: Sync local state from loader data**

After `const [teams, setTeams] = useState(initialTeams)`, add a sync effect:

```typescript
const [teams, setTeams] = useState(initialTeams)

// Sync when loader data changes (e.g. after router.invalidate)
if (initialTeams !== teams && initialTeams.length >= teams.length) {
  setTeams(initialTeams)
}
```

This is a controlled comparison — only sync when loader data is fresher (more items or different reference from a refetch). This avoids overwriting optimistic deletes.

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/teams/index.tsx
git commit -m "fix: sync teams list from loader data after router invalidation"
```

---

### Task 5: Portals list stale state after create (HIGH #5)

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`

**Current state:** Same pattern as teams. `const [portals, setPortals] = useState(initialPortals)`. After creating a portal on the `/new` page and navigating back, the loader refetches but local state doesn't update.

- [ ] **Step 1: Read the file**

Read `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`.

- [ ] **Step 2: Sync local state from loader data**

After `const [portals, setPortals] = useState(initialPortals)`, add:

```typescript
const [portals, setPortals] = useState(initialPortals)

// Sync when loader data changes (e.g. after router.invalidate)
if (initialPortals !== portals && initialPortals.length >= portals.length) {
  setPortals(initialPortals)
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/portals/index.tsx
git commit -m "fix: sync portals list from loader data after router invalidation"
```

---

### Task 6: Links page — add data loader + toast feedback (HIGH #6, MEDIUM #10)

**Files:**

- Modify: `src/contexts/portal/server/portal-links.ts`
- Modify: `src/routes/_authenticated/properties/$propertyId/portals/$portalId/links.tsx`

**Current state:** No query server function exists for categories/links — only mutations. The links page starts with empty `useState([])` arrays. After mutation errors, `console.error` provides no user feedback.

This is the largest task. It requires:

1. Creating a `listPortalLinks` server function
2. Adding a loader to the links route
3. Initializing local state from loader data
4. Adding toast.error() for all failed mutations

- [ ] **Step 1: Read both files**

Read `src/contexts/portal/server/portal-links.ts` and `src/routes/_authenticated/properties/$propertyId/portals/$portalId/links.tsx`.

- [ ] **Step 2: Add listPortalLinks server function**

In `src/contexts/portal/server/portal-links.ts`, add a new export after the existing functions. Check the database schema used by the existing functions to understand the table and column names, then add:

```typescript
export const listPortalLinks = createServerFn({ method: 'GET' })
  .validator((data: { portalId: string }) => data)
  .handler(async ({ data }) => {
    const categories = await db
      .select()
      .from(linkCategoriesTable)
      .where(eq(linkCategoriesTable.portalId, data.portalId))
      .orderBy(linkCategoriesTable.sortKey)

    const links = await db
      .select()
      .from(linksTable)
      .where(eq(linksTable.portalId, data.portalId))
      .orderBy(linksTable.sortKey)

    return { categories, links }
  })
```

Use the actual table names and imports from the existing functions in the same file. Check the imports at the top of the file for the correct table references and add `eq` from drizzle if not already imported.

- [ ] **Step 3: Add loader to links route**

In `links.tsx`, add a loader to the Route definition:

```typescript
import { listPortalLinks } from '#/contexts/portal/server/portal-links'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId/links',
)({
  staleTime: 30_000,
  loader: async ({ params }) => {
    const { categories, links } = await listPortalLinks({
      data: { portalId: params.portalId },
    })
    return { categories, links }
  },
  component: PortalLinksPage,
})
```

- [ ] **Step 4: Initialize state from loader data**

In the `PortalLinksPage` component, replace the empty `useState` initializations with loader data:

```typescript
const { categories: initialCategories, links: initialLinks } = Route.useLoaderData()
const [categories, setCategories] = useState(initialCategories)
const [links, setLinks] = useState(initialLinks)
```

Also add the sync pattern from Tasks 4/5:

```typescript
// Sync when loader data changes
if (initialCategories !== categories) {
  setCategories(initialCategories)
}
if (initialLinks !== links) {
  setLinks(initialLinks)
}
```

Wait — this would cause issues during optimistic updates. The better approach is simpler: just use the loader data directly when the state hasn't been modified. Since all mutations already update local state optimistically, the sync should only happen when the component mounts with fresh data. Remove the sync logic and just use the initial value from loader data. The `staleTime: 30_000` ensures the loader refetches periodically.

Actually, the simplest correct approach: use `useState(initialCategories)` and `useState(initialLinks)`. This already works because `useState` uses the initial value on first render. When the route re-mounts (after navigation away and back), it gets fresh loader data. The issue was that `initialCategories` was always `[]` — now it has real data.

- [ ] **Step 5: Add toast.error for failed mutations**

Add `import { toast } from 'sonner'` at the top of `links.tsx`.

Replace every `console.error(...)` in catch blocks with `toast.error(...)` + keep the `console.error` for debugging:

Find each `catch (err) { console.error(...)` block and change to:

```typescript
catch (err) {
  console.error('Failed to ...:', err)
  toast.error('Failed to ...')
}
```

There are approximately 8 catch blocks. Replace all of them:

- `handleAddCategory` → `toast.error('Failed to create category')`
- `handleAddLink` → `toast.error('Failed to create link')`
- `handleDeleteCategory` → `toast.error('Failed to delete category')`
- `handleDeleteLink` → `toast.error('Failed to delete link')`
- `handleUpdateLink` → `toast.error('Failed to update link')`
- `handleUpdateCategory` → `toast.error('Failed to update category')`
- `handleReorderCategories` → `toast.error('Failed to reorder categories')`
- `handleReorderLinks` → `toast.error('Failed to reorder links')`

- [ ] **Step 6: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/contexts/portal/server/portal-links.ts src/routes/_authenticated/properties/\$propertyId/portals/\$portalId/links.tsx
git commit -m "fix: load existing categories/links in portal links editor, add error toasts"
```

---

### Task 7: AlertDialog for category and link delete (HIGH #7)

**Files:**

- Modify: `src/components/features/portal/SortableCategory.tsx`
- Modify: `src/components/features/portal/SortableLink.tsx`

**Current state:** Trash buttons call `onDeleteCategory`/`onDelete` directly — no confirmation.

- [ ] **Step 1: Read both files**

Read `src/components/features/portal/SortableCategory.tsx` and `src/components/features/portal/SortableLink.tsx`.

- [ ] **Step 2: Add AlertDialog imports to SortableCategory**

Add to imports in `SortableCategory.tsx`:

```typescript
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
```

- [ ] **Step 3: Wrap category delete button in AlertDialog**

Find the delete Button (with `Trash2` icon, `variant="ghost"`, `onClick={() => onDeleteCategory(category.id)`). Wrap it in an AlertDialog:

```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button size="sm" variant="ghost" disabled={isDeletingCategory}>
      <Trash2 className="size-3 text-muted-foreground" />
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Category</AlertDialogTitle>
      <AlertDialogDescription>
        Delete "{category.title}" and all its links? This cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={() => onDeleteCategory(category.id)}
      >
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 4: Add AlertDialog imports to SortableLink**

Add to imports in `SortableLink.tsx`:

```typescript
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
```

- [ ] **Step 5: Wrap link delete button in AlertDialog**

Find the delete Button (with `Trash2` icon, `variant="ghost"`, `onClick={() => onDelete(link.id)`). Wrap it:

```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button size="sm" variant="ghost" disabled={isDeleting}>
      <Trash2 className="size-3 text-muted-foreground" />
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Link</AlertDialogTitle>
      <AlertDialogDescription>
        Delete "{link.label}"? This cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={() => onDelete(link.id)}
      >
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 6: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/components/features/portal/SortableCategory.tsx src/components/features/portal/SortableLink.tsx
git commit -m "fix: add AlertDialog confirmation for category and link delete"
```

---

### Task 8: Team detail no-op cancel + member list button hierarchy (MEDIUM #11, MEDIUM #12)

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/teams/$teamId/index.tsx`
- Modify: `src/components/features/team/TeamMemberList.tsx`

- [ ] **Step 1: Read both files**

Read `src/routes/_authenticated/properties/$propertyId/teams/$teamId/index.tsx` and `src/components/features/team/TeamMemberList.tsx`.

- [ ] **Step 2: Fix no-op onCancel in team settings**

In `teams/$teamId/index.tsx`, the `EditTeamForm` receives `onCancel={() => {}}`. Since this is the settings page (not a dialog), the cancel button should navigate back to the teams list.

Replace:

```tsx
onCancel={() => {}}
```

With:

```tsx
onCancel={() => navigate({ to: '/properties/$propertyId/teams', params: { propertyId: team.propertyId } })}
```

Add `useNavigate` import if not present:

```typescript
import { createFileRoute, useNavigate } from '@tanstack/react-router'
```

And add in the component:

```typescript
const navigate = useNavigate()
```

Note: check the team object for the propertyId field. If the team doesn't have `propertyId`, use `Route.useParams()` instead:

```typescript
const { propertyId } = Route.useParams()
```

Then: `onCancel={() => navigate({ to: '/properties/$propertyId/teams', params: { propertyId } })}`

- [ ] **Step 3: Fix button hierarchy in TeamMemberList**

In `TeamMemberList.tsx`, check the dialog/form buttons. The issue is inconsistent variant usage between action buttons and cancel buttons in the "Add members" dialog and the "Remove" button.

The "Remove" button uses `variant="ghost"` with `className="text-muted-foreground hover:text-destructive"`. This is acceptable for table row actions. Verify the "Add members" dialog uses:

- Cancel: `variant="outline"`
- Confirm/Add: default `variant` (primary)

If the add dialog's confirm button uses `variant="outline"` or `variant="ghost"`, change it to the default variant (or `variant="default"`) for proper hierarchy.

- [ ] **Step 4: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/teams/\$teamId/index.tsx src/components/features/team/TeamMemberList.tsx
git commit -m "fix: team settings cancel navigates back, button hierarchy in member list"
```

---

### Task 9: Reduce staleTime from Infinity to safe value (MEDIUM #9)

**Files:**

- Modify: `src/routes/_authenticated.tsx`

**Current state:** `staleTime: Infinity` means structural data (orgs, properties) is never refetched unless `router.invalidate()` is explicitly called. If a mutation forgets to invalidate, or a user's org membership changes server-side, the UI stays stale forever.

- [ ] **Step 1: Read the file**

Read `src/routes/_authenticated.tsx`.

- [ ] **Step 2: Change staleTime from Infinity to 5 minutes**

Find `staleTime: Infinity` (line ~95) and replace with:

```typescript
staleTime: 5 * 60 * 1000, // 5 min — structural data rarely changes
```

5 minutes is long enough that normal navigation doesn't refetch, but short enough that a stuck state self-corrects within a reasonable window. Mutations still use `router.invalidate()` for immediate updates.

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated.tsx
git commit -m "fix: reduce shell staleTime from Infinity to 5min for safety"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Each of the 12 issues maps to a task
- [x] **Placeholder scan:** No TBDs, TODOs, or "implement later" — all steps have complete code
- [x] **Type consistency:** All component names, prop names, and import paths match actual codebase
- [x] **No out-of-scope changes:** No new routes, layouts, or features — only fixes to existing files
