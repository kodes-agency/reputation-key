# Session 3: Pages & Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real manager dashboard, consolidate staff/members/teams into a tabbed People page, add staff-facing pages (home, progress, leaderboard, team), and clean up old routes.

**Architecture:** Manager routes remain property-scoped (`/properties/$propertyId/...`). Staff routes are user-scoped (`/home`, `/progress`, etc.) nested under `_authenticated`. The People page uses client-side tabs within a single route. Dashboard replaces the current property overview with a summary view; property editing moves to a settings sub-page.

**Tech Stack:** React 19, TanStack Router/Start, Radix UI (shadcn Tabs), Lucide icons

**Prerequisites:** Session 1 (visual design) and Session 2 (navigation structure) completed. ManagerSidebar and StaffSidebar are wired in.

**Reference:** CONTEXT.md (Navigation & Layout glossary), docs/adr/0002-section-based-navigation.md (route structure, dashboard spec), DESIGN.md (component specs)

---

## File Structure

### Files to create

| File                                                          | Responsibility                              |
| ------------------------------------------------------------- | ------------------------------------------- |
| `src/routes/_authenticated/properties/$propertyId/people.tsx` | Tabbed People page: Directory, Staff, Teams |
| `src/routes/_authenticated/home.tsx`                          | Staff home — personal summary stub          |
| `src/routes/_authenticated/progress.tsx`                      | Staff progress — stats + goals stub         |
| `src/routes/_authenticated/leaderboard.tsx`                   | Staff leaderboard — rankings stub           |
| `src/routes/_authenticated/team.tsx`                          | Staff team — team view stub                 |

### Files to modify

| File                                                         | What changes                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/routes/_authenticated/dashboard.tsx`                    | Rewrite: single-property auto-redirect to dashboard, multi-property shows property picker |
| `src/routes/_authenticated/properties/$propertyId/index.tsx` | Rewrite from property edit form to dashboard summary view                                 |
| `src/routes/_authenticated/properties/$propertyId.tsx`       | Add reviews count to loader (for dashboard)                                               |

### Files to delete

| File                                                                         | Reason                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/routes/_authenticated/properties/$propertyId/members.tsx`               | Absorbed into People page (Directory tab)                                          |
| `src/routes/_authenticated/properties/$propertyId/staff/index.tsx`           | Absorbed into People page (Staff tab)                                              |
| `src/routes/_authenticated/properties/$propertyId/teams/index.tsx`           | Absorbed into People page (Teams tab)                                              |
| `src/routes/_authenticated/staff/index.tsx`                                  | Org-level staff page replaced by People Directory                                  |
| `src/routes/_authenticated/properties/$propertyId/settings/property.tsx`     | Property settings moved to `/settings/properties/$id` (Session 2 settings route)   |
| `src/routes/_authenticated/properties/$propertyId/settings/organization.tsx` | Organization settings moved to `/settings/organization` (Session 2 settings route) |
| `src/components/layout/AppSidebar.tsx`                                       | Replaced by ManagerSidebar + StaffSidebar (Session 2)                              |

---

### Task 1: Rewrite property overview as dashboard summary

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/index.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId.tsx`

The current `$propertyId/index.tsx` shows a property edit form. This becomes the dashboard summary view — a teaser/router that shows metric highlights, recent reviews, and team snapshot. Property editing moves to settings.

- [ ] **Step 1: Read current files**

Read `src/routes/_authenticated/properties/$propertyId.tsx` (the layout route with the property loader) and `src/routes/_authenticated/properties/$propertyId/index.tsx` (the current overview). Note the loader returns `{ property }`.

- [ ] **Step 2: Add staff/team counts to property layout loader**

In `src/routes/_authenticated/properties/$propertyId.tsx`, add counts to the loader that the dashboard needs. Read the file first to see the exact loader structure.

Add these imports at the top:

```typescript
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listTeams } from '#/contexts/team/server/teams'
```

Add to the existing loader's `Promise.all`:

```typescript
const [{ assignments }, { teams }] = await Promise.all([
  listStaffAssignments({ data: { propertyId: params.propertyId } }),
  listTeams({ data: { propertyId: params.propertyId } }),
  // ...existing loader calls...
])
```

Return `staffCount: assignments.length` and `teamCount: teams.length` alongside the existing return values.

- [ ] **Step 3: Rewrite `$propertyId/index.tsx` as dashboard**

Replace the property edit form with a dashboard summary. Read `src/routes/_authenticated/properties/$propertyId.tsx` to see the exact parent route path for `getRouteApi`.

```tsx
import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { MessageSquare, Users, Globe, TrendingUp } from 'lucide-react'
import { Button } from '#/components/ui/button'

const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  component: PropertyDashboard,
})

function PropertyDashboard() {
  const { property, staffCount, teamCount } = propertyRoute.useLoaderData()

  if (!property) return null

  const metrics = [
    { label: 'Reviews', value: '—', icon: MessageSquare, href: '../reviews' },
    { label: 'Staff', value: String(staffCount), icon: Users, href: '../people' },
    { label: 'Teams', value: String(teamCount), icon: TrendingUp, href: '../people' },
    { label: 'Portals', value: '—', icon: Globe, href: '../portals' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{property.name}</p>
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {metrics.map((m) => (
          <Link
            key={m.label}
            to={m.href as any}
            className="group rounded-lg border p-4 transition-colors hover:border-border-strong hover:bg-surface-elevated"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <m.icon className="size-4" />
              <span className="text-xs font-medium uppercase tracking-wide">
                {m.label}
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{m.value}</p>
          </Link>
        ))}
      </div>

      {/* Recent reviews — placeholder until review server functions exist */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Recent Reviews
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="../reviews">View all</Link>
          </Button>
        </div>
        <div className="mt-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Review data will appear here once the reviews context is connected.
        </div>
      </div>
    </div>
  )
}
```

Note: Reviews and portal counts show "—" because there's no reviews aggregation server function yet. This is a known gap — the dashboard becomes fully populated when the reviews context gets a `countReviews` server function.

- [ ] **Step 4: Verify build**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId.tsx src/routes/_authenticated/properties/\$propertyId/index.tsx
git commit -m "feat: property dashboard with metric strip and summary view

Replace property edit form with dashboard. Shows staff/team counts,
placeholder for reviews/portals. Metric cards link to sections."
```

---

### Task 2: Create tabbed People page

**Files:**

- Create: `src/routes/_authenticated/properties/$propertyId/people.tsx`

This replaces three separate routes (staff, members, teams) with a single tabbed page.

- [ ] **Step 1: Create the People page with three tabs**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  listStaffAssignments,
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { listTeams, createTeam, deleteTeam } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { OrgStaffTable } from '#/components/features/staff/OrgStaffTable'
import { StaffAssignmentList } from '#/components/features/staff/StaffAssignmentList'
import { AssignStaffForm } from '#/components/features/staff/AssignStaffForm'
import { CreateTeamForm } from '#/components/features/team/CreateTeamForm'
import { MemberTable } from '#/components/features/organization/MemberTable'
import {
  useMutationAction,
  useMutationActionSilent,
} from '#/components/hooks/use-mutation-action'
import { toMemberOptions, toTeamOptions } from '#/lib/lookups'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Plus } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/people')({
  staleTime: 30_000,
  loader: async ({ params: { propertyId } }) => {
    const [{ assignments }, { members }, { teams }] = await Promise.all([
      listStaffAssignments({ data: { propertyId } }),
      listMembers(),
      listTeams({ data: { propertyId } }),
    ])
    return { assignments, members, teams }
  },
  component: PeoplePage,
})

function PeoplePage() {
  const { propertyId } = Route.useParams()
  const { assignments, members, teams } = Route.useLoaderData()
  const { can } = usePermissions()
  const [tab, setTab] = useState('staff')
  const [assignOpen, setAssignOpen] = useState(false)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)

  const memberOptions = toMemberOptions(members)
  const teamOptions = toTeamOptions(teams)
  const assignedUserIds = new Set(assignments.map((a: { userId: string }) => a.userId))

  const assignMutation = useMutationActionSilent(createStaffAssignment)
  const removeMutation = useMutationAction(removeStaffAssignment, {
    successMessage: 'Staff member unassigned',
  })
  const createTeamMutation = useMutationAction(createTeam, {
    successMessage: 'Team created',
    onSuccess: async () => {
      setCreateTeamOpen(false)
    },
  })
  const deleteTeamMutation = useMutationAction(deleteTeam, {
    successMessage: 'Team deleted',
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage staff assignments, team members, and organization directory.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="directory">Directory</TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus />
                  Assign Staff
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Staff</DialogTitle>
                  <DialogDescription>
                    Select staff members to assign to this property.
                  </DialogDescription>
                </DialogHeader>
                <AssignStaffForm
                  propertyId={propertyId}
                  mutation={assignMutation}
                  members={memberOptions}
                  teams={teamOptions}
                  assignedUserIds={assignedUserIds}
                />
              </DialogContent>
            </Dialog>
          </div>
          <StaffAssignmentList
            assignments={assignments}
            members={memberOptions}
            removeAction={removeMutation}
          />
        </TabsContent>

        <TabsContent value="teams" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus />
                  Create Team
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create a new team</DialogTitle>
                  <DialogDescription>
                    Group staff members into teams for this property.
                  </DialogDescription>
                </DialogHeader>
                <CreateTeamForm
                  propertyId={propertyId}
                  mutation={createTeamMutation}
                  members={memberOptions}
                />
              </DialogContent>
            </Dialog>
          </div>
          {teams.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No teams yet. Create a team to group staff members.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {teams.map((team: any) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="font-semibold">{team.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {
                        assignments.filter(
                          (a: { teamId: string | null }) => a.teamId === team.id,
                        ).length
                      }{' '}
                      members
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="directory" className="mt-4">
          <OrgStaffTable assignments={assignments} members={memberOptions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

Note: This reuses existing components (`StaffAssignmentList`, `AssignStaffForm`, `OrgStaffTable`, `CreateTeamForm`). The Directory tab shows org-wide member list via `OrgStaffTable`. The Staff tab shows property-scoped assignments. The Teams tab shows teams with member counts.

- [ ] **Step 2: Verify build**

Run: `pnpm typecheck`
Expected: No type errors. If `Tabs` component doesn't exist, check `src/components/ui/tabs.tsx` — it should be available from shadcn. If missing, run `npx shadcn@latest add tabs`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/people.tsx
git commit -m "feat: tabbed People page consolidating staff, teams, directory

Single /people route with three tabs. Staff tab shows assignments.
Teams tab shows teams with member counts. Directory tab shows org members."
```

---

### Task 3: Create staff-facing page stubs

**Files:**

- Create: `src/routes/_authenticated/home.tsx`
- Create: `src/routes/_authenticated/progress.tsx`
- Create: `src/routes/_authenticated/leaderboard.tsx`
- Create: `src/routes/_authenticated/team.tsx`

These are user-scoped pages for staff. They're stubs with real headings and empty states. The data layer (stats, goals, rankings) doesn't exist yet — these will be built out as features.

- [ ] **Step 1: Create all four pages**

`src/routes/_authenticated/home.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/home')({
  component: StaffHomePage,
})

function StaffHomePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your performance at a glance.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Your stats, badges, and goal progress will appear here.
      </div>
    </div>
  )
}
```

`src/routes/_authenticated/progress.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/progress')({
  component: StaffProgressPage,
})

function StaffProgressPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where you are and where you're going.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Stats and goals will appear here.
      </div>
    </div>
  )
}
```

`src/routes/_authenticated/leaderboard.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/leaderboard')({
  component: StaffLeaderboardPage,
})

function StaffLeaderboardPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See how you rank among your peers.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Rankings will appear here.
      </div>
    </div>
  )
}
```

`src/routes/_authenticated/team.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/team')({
  component: StaffTeamPage,
})

function StaffTeamPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your team members and goals.</p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Team details will appear here when you're assigned to a team.
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm typecheck`
Expected: No type errors. All four routes register with TanStack Router.

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/home.tsx src/routes/_authenticated/progress.tsx src/routes/_authenticated/leaderboard.tsx src/routes/_authenticated/team.tsx
git commit -m "feat: add staff-facing page stubs

Home, Progress, Leaderboard, Team pages with empty states.
Data layer for these features will be built separately."
```

---

### Task 4: Update dashboard redirect and delete old routes

**Files:**

- Modify: `src/routes/_authenticated/dashboard.tsx`
- Delete: `src/routes/_authenticated/properties/$propertyId/members.tsx`
- Delete: `src/routes/_authenticated/properties/$propertyId/staff/index.tsx`
- Delete: `src/routes/_authenticated/properties/$propertyId/teams/index.tsx`
- Delete: `src/routes/_authenticated/staff/index.tsx`
- Delete: `src/routes/_authenticated/properties/$propertyId/settings/property.tsx`
- Delete: `src/routes/_authenticated/properties/$propertyId/settings/organization.tsx`
- Delete: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Update dashboard.tsx redirect**

Read `src/routes/_authenticated/dashboard.tsx`. Currently it auto-redirects to the first property or shows a property list. Update the redirect target — single property should redirect to the property dashboard (which is now the summary view), not the property edit form.

The current logic is correct: redirect to `/properties/$propertyId` which now renders the dashboard summary. No change needed to the redirect target.

But update the property list page heading for consistency — the multi-property case should still work as a property picker.

Read the file. If it already redirects to `/properties/$propertyId` for single properties and shows a list for multiple, it's fine. The heading says "Properties" which is correct.

No changes needed to this file.

- [ ] **Step 2: Delete old route files**

```bash
git rm src/routes/_authenticated/properties/\$propertyId/members.tsx
git rm src/routes/_authenticated/properties/\$propertyId/staff/index.tsx
git rm src/routes/_authenticated/properties/\$propertyId/teams/index.tsx
git rm src/routes/_authenticated/staff/index.tsx
git rm src/routes/_authenticated/properties/\$propertyId/settings/property.tsx
git rm src/routes/_authenticated/properties/\$propertyId/settings/organization.tsx
git rm src/components/layout/AppSidebar.tsx
```

Note: Before deleting `members.tsx`, check if its components (`MemberTable`, invitation handling) are reused in the People page. If they are, the People page imports them from the feature component files, not the route file, so deletion is safe.

Note: `teams/$teamId.tsx`, `teams/$teamId/index.tsx`, and `teams/$teamId/members.tsx` are kept — they're detail pages linked from the Teams tab's team items. The People page lists teams but team detail/edit still needs these routes.

Note: `staff/index.tsx` (org-level) is deleted because the People Directory tab replaces it. `AppSidebar.tsx` is deleted because Session 2 replaced it with ManagerSidebar and StaffSidebar.

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: Build succeeds. All deleted routes are no longer referenced.

If build fails with import errors, find which files still import the deleted modules and update them:

- Search for `AppSidebar` imports — should have been removed in Session 2
- Search for references to old route paths — ManagerSidebar navItems were updated in Session 2 fix

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete old routes replaced by People page and Session 2 sidebars

Remove members, staff, teams index routes (absorbed into People tabs).
Remove old settings routes (moved to /settings in Session 2).
Remove AppSidebar (replaced by ManagerSidebar + StaffSidebar)."
```

---

### Task 5: Fix layout widths across pages

**Files:**

- Modify: various route files for width consistency

Per CONTEXT.md layout width rules: lists `max-w-4xl`, forms/settings `max-w-2xl`, data pages full-width with `px-8`.

- [ ] **Step 1: Audit current page widths**

Run: `grep -r 'max-w-' src/routes/_authenticated/ --include='*.tsx'`

Note which pages use which widths. Check against the rules:

- Dashboard (summary) — `max-w-4xl` or no constraint (data page)
- People (list) — `max-w-4xl`
- Reviews (list) — `max-w-4xl`
- Portals (list) — `max-w-4xl`
- Staff pages (home, progress, etc.) — `max-w-2xl`
- Property edit/detail — `max-w-2xl`

- [ ] **Step 2: Apply consistent widths**

For each route file that needs a width fix, add the appropriate container:

List pages (add `max-w-4xl`):

- `properties/$propertyId/reviews.tsx`
- `properties/$propertyId/portals/index.tsx`
- `properties/$propertyId/people.tsx`

Form/detail pages (add `max-w-2xl`):

- `properties/new.tsx`
- `properties/$propertyId/portals/new.tsx`
- `properties/$propertyId/portals/$portalId.tsx`

The dashboard (`properties/$propertyId/index.tsx`) uses full width — no constraint needed.

Wrap each page's root content div. Example pattern:

```tsx
// List page
<div className="mx-auto max-w-4xl space-y-6">

// Form page
<div className="mx-auto max-w-2xl space-y-6">
```

- [ ] **Step 3: Verify build**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/
git commit -m "fix: apply consistent layout widths per page type

Lists max-w-4xl, forms max-w-2xl, dashboard full-width."
```

---

## Self-Review

### Spec coverage (ADR 0002 + CONTEXT.md)

| Decision                                                | Task                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Dashboard as property-scoped summary                    | Task 1 (metric strip, recent reviews placeholder)           |
| People section absorbs Staff/Members/Teams              | Task 2 (tabbed page with 3 tabs)                            |
| Staff sidebar pages (Home, Progress, Leaderboard, Team) | Task 3 (stub pages)                                         |
| Layout width per page                                   | Task 5 (consistent max-w rules)                             |
| Property-scoped manager routes                          | All tasks (routes stay under `/properties/$propertyId/...`) |
| User-scoped staff routes                                | Task 3 (routes at `/home`, `/progress`, etc.)               |

### Placeholder scan

- Dashboard reviews show "—" — this is intentional (no reviews aggregation server function exists yet). The placeholder text says "Review data will appear here once the reviews context is connected." This is an explicit gap, not a TODO.
- Staff page stubs have descriptive empty states. Data layer is out of scope for this session.
- No TBD/TODO patterns in code.

### Type consistency

- `propertyRoute.useLoaderData()` returns `{ property, staffCount, teamCount }` — matches Task 1 Step 2 additions
- `Route.useLoaderData()` in People page returns `{ assignments, members, teams }` — matches existing server function return types
- Staff page stubs have no loader dependencies — purely static

### Gaps

1. **No reviews aggregation**: Dashboard shows "—" for reviews count and a placeholder for recent reviews. A `countReviews` or `listRecentReviews` server function needs to be built when the reviews context is developed.
2. **No portal count**: Same gap — needs a portal count query.
3. **Staff page data layer**: Home, Progress, Leaderboard, Team are stubs. The server functions for stats, goals, rankings don't exist yet. These are future features.
4. **Team detail pages kept**: `teams/$teamId/index.tsx` and `teams/$teamId/members.tsx` are kept as-is. The People page Teams tab could link to these for team detail/edit. Navigation from the tab to team detail is a future enhancement.
5. **hasTeam still hardcoded**: Session 2 gap. The StaffSidebar `hasTeam` prop is still `false`. Needs a loader query to check team assignment. Can be added when the Team page gets real data.
