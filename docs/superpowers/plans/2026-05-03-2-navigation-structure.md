# Session 2: Navigation Structure Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the property-centric sidebar with section-based navigation. Create role-distinct sidebars (Manager vs Staff). Add a separate `/settings` route with its own sidebar. Wire everything into the authenticated layout.

**Architecture:** ManagerSidebar renders flat section items (Dashboard, Reviews, People, Portals) with a property switcher in the sidebar header. StaffSidebar renders personal items (Home, Progress, Leaderboard, Team). SettingsSidebar renders config items (Profile, Security, Preferences, Organization). The authenticated layout selects the correct sidebar based on user role.

**Tech Stack:** React 19, TanStack Router/Start, Radix UI (shadcn sidebar), Lucide icons

**Prerequisites:** Session 1 (visual design) completed. New design tokens in styles.css.

**Reference:** CONTEXT.md (Navigation & Layout glossary), docs/adr/0002-section-based-navigation.md (route structure, decisions)

---

## File Structure

### Files to create

| File                                        | Responsibility                                         |
| ------------------------------------------- | ------------------------------------------------------ |
| `src/components/layout/ManagerSidebar.tsx`  | Section-based sidebar for PropertyManager/AccountAdmin |
| `src/components/layout/StaffSidebar.tsx`    | Role-specific sidebar for Staff users                  |
| `src/components/layout/SettingsSidebar.tsx` | Sidebar for the `/settings` route                      |
| `src/routes/_settings.tsx`                  | Settings layout route with its own sidebar             |
| `src/routes/_settings/profile.tsx`          | Profile settings page                                  |
| `src/routes/_settings/security.tsx`         | Security settings page                                 |
| `src/routes/_settings/preferences.tsx`      | Theme/notification preferences                         |
| `src/routes/_settings/organization.tsx`     | Org settings (admin only)                              |

### Files to modify

| File                                  | What changes                                         |
| ------------------------------------- | ---------------------------------------------------- |
| `src/routes/_authenticated.tsx`       | Import new sidebars, select by role, pass properties |
| `src/components/layout/AppTopBar.tsx` | Remove property switcher (moved to sidebar)          |

### Files unchanged (for now)

All existing route files under `_authenticated/properties/` remain functional. They're cleaned up in Session 3.

---

### Task 1: Create ManagerSidebar component

**Files:**

- Create: `src/components/layout/ManagerSidebar.tsx`

- [ ] **Step 1: Read AppSidebar.tsx to understand existing patterns**

Read `src/components/layout/AppSidebar.tsx`. Note: org switcher pattern, sidebar component imports, usePropertyId hook, CreateOrganizationDialog usage, hasRole import, setActiveOrganization server function import.

- [ ] **Step 2: Create ManagerSidebar.tsx**

```tsx
import { useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Globe,
  Settings,
  Building2,
  ChevronsUpDown,
  Plus,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '#/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useAction } from '#/components/hooks/use-action'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { setActiveOrganization } from '#/contexts/identity/server/organizations'
import { CreateOrganizationDialog } from '#/components/features/organization/CreateOrganizationDialog'
import type { Role } from '#/shared/domain/roles'

type Props = Readonly<{
  role: Role
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganization: { id: string; name: string } | null
  setActiveOrganization: (input: { data: { organizationId: string } }) => Promise<void>
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
}>

const navItems = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: '/properties/$propertyId' as const,
  },
  {
    key: 'reviews',
    label: 'Reviews',
    icon: MessageSquare,
    to: '/properties/$propertyId/reviews' as const,
  },
  {
    key: 'people',
    label: 'People',
    icon: Users,
    to: '/properties/$propertyId/people' as const,
  },
  {
    key: 'portals',
    label: 'Portals',
    icon: Globe,
    to: '/properties/$propertyId/portals' as const,
  },
]

function useActiveSection(): string {
  return useRouterState({
    select: (s) => {
      const m = s.location.pathname.match(/\/properties\/[^/]+(?:\/([^/]+))?/)
      if (!m) return 'dashboard'
      if (m[1] === 'portals') return 'portals'
      if (m[1] === 'reviews') return 'reviews'
      if (m[1] === 'people') return 'people'
      if (s.location.pathname.startsWith('/settings')) return 'settings'
      return 'dashboard'
    },
  })
}

export function ManagerSidebar({
  role: _role,
  organizations,
  activeOrganization,
  setActiveOrganization: _setActiveOrganization,
  properties,
}: Props) {
  const propertyId = usePropertyId()
  const activeSection = useActiveSection()
  const navigate = useNavigate()
  const [createOrgOpen, setCreateOrgOpen] = useState(false)
  const setOrg = useAction(setActiveOrganization)

  function handleOrgSwitch(orgId: string) {
    void setOrg({ data: { organizationId: orgId } }).then(() => {
      // Redirect to first property or property list
      if (properties.length > 0) {
        navigate({
          to: '/properties/$propertyId',
          params: { propertyId: properties[0].id },
        })
      } else {
        navigate({ to: '/properties' })
      }
    })
  }

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          {/* Org switcher */}
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="gap-3">
                    <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
                      {activeOrganization?.name?.charAt(0) ?? 'R'}
                    </div>
                    <div className="flex flex-col gap-0.5 leading-none">
                      <span className="font-semibold">
                        {activeOrganization?.name ?? 'Select org'}
                      </span>
                      <span className="text-xs text-muted-foreground">Organization</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {organizations.map((org) => (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => handleOrgSwitch(org.id)}
                    >
                      {org.name}
                      {org.id === activeOrganization?.id && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          Active
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setCreateOrgOpen(true)}>
                    <Plus className="mr-2 size-4" />
                    Create organization
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* Property switcher — shown only when multiple properties */}
          {properties.length > 1 && (
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton className="gap-2">
                      <Building2 className="size-4" />
                      <span className="truncate text-sm">
                        {properties.find((p) => p.id === propertyId)?.name ??
                          'Select property'}
                      </span>
                      <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {properties.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() =>
                          navigate({
                            to: '/properties/$propertyId',
                            params: { propertyId: p.id },
                          })
                        }
                      >
                        {p.name}
                        {p.id === propertyId && (
                          <span className="ml-auto text-xs text-accent">Active</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive = activeSection === item.key

                  if (!propertyId) {
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton disabled tooltip={item.label}>
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  }

                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                        <Link to={item.to} params={{ propertyId }}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={activeSection === 'settings'}
                tooltip="Settings"
              >
                <Link to="/settings/profile">
                  <Settings />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <CreateOrganizationDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
    </>
  )
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/ManagerSidebar.tsx
git commit -m "feat: add ManagerSidebar with section-based navigation

Dashboard, Reviews, People, Portals as flat sections. Property
switcher in sidebar header for multi-property orgs. Org switcher
retained. Settings as footer gear icon."
```

---

### Task 2: Create StaffSidebar component

**Files:**

- Create: `src/components/layout/StaffSidebar.tsx`

- [ ] **Step 1: Create StaffSidebar.tsx**

```tsx
import { Link, useRouterState } from '@tanstack/react-router'
import { Home, TrendingUp, Trophy, Users, Settings, ChevronsUpDown } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '#/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { Role } from '#/shared/domain/roles'

type Props = Readonly<{
  role: Role
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganization: { id: string; name: string } | null
  hasTeam: boolean
}>

const staffNavItems = [
  { key: 'home', label: 'Home', icon: Home, href: '/home' },
  { key: 'progress', label: 'Progress', icon: TrendingUp, href: '/progress' },
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy, href: '/leaderboard' },
]

function useActiveSection(): string {
  return useRouterState({
    select: (s) => {
      const path = s.location.pathname
      if (path === '/home' || path === '/') return 'home'
      if (path.startsWith('/progress')) return 'progress'
      if (path.startsWith('/leaderboard')) return 'leaderboard'
      if (path.startsWith('/team')) return 'team'
      if (path.startsWith('/settings')) return 'settings'
      return 'home'
    },
  })
}

export function StaffSidebar({
  role: _role,
  organizations,
  activeOrganization,
  hasTeam,
}: Props) {
  const activeSection = useActiveSection()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="gap-3">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
                    {activeOrganization?.name?.charAt(0) ?? 'R'}
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold">
                      {activeOrganization?.name ?? 'Organization'}
                    </span>
                    <span className="text-xs text-muted-foreground">Staff view</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {organizations.map((org) => (
                  <DropdownMenuItem key={org.id}>
                    {org.name}
                    {org.id === activeOrganization?.id && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        Active
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {staffNavItems.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    asChild
                    isActive={activeSection === item.key}
                    tooltip={item.label}
                  >
                    <Link to={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {hasTeam && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={activeSection === 'team'}
                    tooltip="Team"
                  >
                    <Link to="/team">
                      <Users />
                      <span>Team</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={activeSection === 'settings'}
              tooltip="Settings"
            >
              <Link to="/settings/profile">
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/StaffSidebar.tsx
git commit -m "feat: add StaffSidebar with personal navigation

Home, Progress, Leaderboard. Team shown only when hasTeam is true.
Settings in footer. No org switcher (staff don't switch orgs)."
```

---

### Task 3: Create Settings layout route and sidebar

**Files:**

- Create: `src/components/layout/SettingsSidebar.tsx`
- Create: `src/routes/_settings.tsx`

- [ ] **Step 1: Create SettingsSidebar.tsx**

```tsx
import { Link, useRouterState } from '@tanstack/react-router'
import { User, Shield, Palette, Building2, ArrowLeft } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '#/components/ui/sidebar'
import { usePermissions } from '#/shared/hooks/usePermissions'

function useActiveSettingsSection(): string {
  return useRouterState({
    select: (s) => {
      const match = s.location.pathname.match(/\/settings\/([^/]+)/)
      return match?.[1] ?? 'profile'
    },
  })
}

export function SettingsSidebar() {
  const activeSection = useActiveSettingsSection()
  const { can } = usePermissions()

  const items = [
    { key: 'profile', label: 'Profile', icon: User, href: '/settings/profile' },
    { key: 'security', label: 'Security', icon: Shield, href: '/settings/security' },
    {
      key: 'preferences',
      label: 'Preferences',
      icon: Palette,
      href: '/settings/preferences',
    },
    ...(can('organization.update')
      ? [
          {
            key: 'organization',
            label: 'Organization',
            icon: Building2,
            href: '/settings/organization',
          },
        ]
      : []),
  ]

  return (
    <Sidebar collapsible="offcanvas" className="border-r">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link to="/properties">
                <ArrowLeft className="size-4" />
                <span className="font-semibold">Back to app</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    asChild
                    isActive={activeSection === item.key}
                    tooltip={item.label}
                  >
                    <Link to={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
```

- [ ] **Step 2: Create \_settings.tsx layout route**

```tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { SidebarProvider, SidebarInset } from '#/components/ui/sidebar'
import { SettingsSidebar } from '#/components/layout/SettingsSidebar'
import { getSession } from '#/shared/auth/auth.server'

export const Route = createFileRoute('/_settings')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: '/login' })
    }
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <SidebarProvider>
      <SettingsSidebar />
      <SidebarInset>
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-2xl space-y-8 px-6 py-8">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 3: Create settings page stubs**

Create four files following this pattern. Each has a real heading, description, and empty state area.

`src/routes/_settings/profile.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_settings/profile')({
  component: ProfileSettings,
})

function ProfileSettings() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your name, email, and avatar.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Profile settings form will appear here.
      </div>
    </>
  )
}
```

`src/routes/_settings/security.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_settings/security')({
  component: SecuritySettings,
})

function SecuritySettings() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Security</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your password and two-factor authentication.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Security settings form will appear here.
      </div>
    </>
  )
}
```

`src/routes/_settings/preferences.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_settings/preferences')({
  component: PreferencesSettings,
})

function PreferencesSettings() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Preferences</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Theme, notifications, and display settings.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Preference options will appear here.
      </div>
    </>
  )
}
```

`src/routes/_settings/organization.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'

export const Route = createFileRoute('/_settings/organization')({
  beforeLoad: ({ context }) => {
    const role = (context as any).role
    if (role !== 'AccountAdmin' && role !== 'PropertyManager') {
      throw redirect({ to: '/settings/profile' })
    }
  },
  component: OrganizationSettings,
})

function OrganizationSettings() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Organization</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Organization name, slug, and billing information.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Organization settings form will appear here.
      </div>
    </>
  )
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm typecheck && pnpm build`
Expected: Both pass. Settings pages accessible at `/settings/profile`, `/settings/security`, etc.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/SettingsSidebar.tsx src/routes/_settings.tsx src/routes/_settings/
git commit -m "feat: add settings layout with dedicated sidebar

Settings route at /_settings with its own sidebar. Back-to-app
link. Profile, Security, Preferences, Organization pages with
empty states. Organization gated to admin/manager roles."
```

---

### Task 4: Wire role-based sidebars into authenticated layout

**Files:**

- Modify: `src/routes/_authenticated.tsx`

- [ ] **Step 1: Read current \_authenticated.tsx**

Read `src/routes/_authenticated.tsx`. Note the imports, the loader, and the `AuthenticatedLayout` component that renders `<AppSidebar>`.

- [ ] **Step 2: Update imports**

Replace:

```typescript
import { AppSidebar } from '#/components/layout/AppSidebar'
```

with:

```typescript
import { ManagerSidebar } from '#/components/layout/ManagerSidebar'
import { StaffSidebar } from '#/components/layout/StaffSidebar'
```

Add:

```typescript
import { hasRole } from '#/shared/domain/roles'
```

- [ ] **Step 3: Update AuthenticatedLayout component**

Replace the `<AppSidebar>` usage:

```tsx
<AppSidebar
  role={ctx.role}
  organizations={organizations}
  activeOrganization={ctx.activeOrganization}
  setActiveOrganization={setActiveOrganizationFn}
/>
```

with:

```tsx
{
  hasRole(ctx.role, 'PropertyManager') ? (
    <ManagerSidebar
      role={ctx.role}
      organizations={organizations}
      activeOrganization={ctx.activeOrganization}
      setActiveOrganization={setActiveOrganizationFn}
      properties={properties}
    />
  ) : (
    <StaffSidebar
      role={ctx.role}
      organizations={organizations}
      activeOrganization={ctx.activeOrganization}
      hasTeam={false}
    />
  )
}
```

Note: `hasTeam` is hardcoded to `false` for now. A real implementation would query the user's team assignment. This is a known gap — the field can be added to the loader in a follow-up.

- [ ] **Step 4: Simplify AppTopBar — remove property switcher**

In `src/components/layout/AppTopBar.tsx`, remove the property switcher dropdown (the `<DropdownMenu>` block that shows property names and calls `handlePropertySwitch`). Keep: sidebar trigger, user menu with theme toggle and sign out. Remove the `handlePropertySwitch` function and `currentProperty` variable since property switching now lives in the sidebar.

The simplified top bar:

```tsx
export function AppTopBar({
  user,
}: {
  user: { id: string; name: string; email: string; image: string | null }
}) {
  const navigate = useNavigate()
  const { mode, applyMode } = useThemeMode()
  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor
  const initials = user.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U'

  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full">
            {user.image ? (
              <img src={user.image} alt="" className="size-7 rounded-full object-cover" />
            ) : (
              <div className="flex size-7 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {initials}
              </div>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              applyMode(mode === 'dark' ? 'light' : mode === 'light' ? 'auto' : 'dark')
            }
          >
            <ThemeIcon className="size-4" />
            {mode === 'dark'
              ? 'Light mode'
              : mode === 'light'
                ? 'System theme'
                : 'Dark mode'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await authClient.signOut()
              await navigate({ to: '/login' })
            }}
          >
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
```

Update the Props type accordingly — remove `properties`.

- [ ] **Step 5: Verify build and dev server**

Run: `pnpm build`
Expected: Build succeeds.

Run: `pnpm dev`
Test:

1. Login as manager — ManagerSidebar shows with Dashboard, Reviews, People, Portals (all links point to `/properties/$propertyId/...`)
2. Settings gear — navigates to `/settings/profile` with own sidebar
3. Back to app — returns to property dashboard

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authenticated.tsx src/components/layout/AppTopBar.tsx
git commit -m "feat: wire role-based sidebars in authenticated layout

ManagerSidebar for PropertyManager/AccountAdmin. StaffSidebar for
Staff. AppTopBar simplified — property switcher moved to sidebar."
```

---

## Self-Review

### Spec coverage (ADR 0002)

| Decision                          | Task                                                      |
| --------------------------------- | --------------------------------------------------------- |
| Section-based navigation          | Task 1 (ManagerSidebar navItems)                          |
| Property switcher as scope filter | Task 1 (in sidebar header, shown only for multi-property) |
| Distinct staff sidebar            | Task 2 (StaffSidebar)                                     |
| Settings as separate route        | Task 3 (\_settings.tsx + SettingsSidebar)                 |
| Team is conditional               | Task 2 (hasTeam prop)                                     |
| Flat sidebar                      | Task 1 (flat navItems, no section headers)                |
| Role-based sidebar selection      | Task 4 (hasRole check in \_authenticated.tsx)             |

### Placeholder scan

No TBD/TODO patterns. All components render real UI. Settings pages have proper headings and descriptive empty states.

### Type consistency

- `ManagerSidebar` receives `properties` array; `StaffSidebar` does not
- Both sidebars receive `organizations` and `activeOrganization`
- `StaffSidebar` receives `hasTeam: boolean`
- `_authenticated.tsx` passes correct props based on role check

### Gaps

1. **hasTeam hardcoded to `false`**: Needs a loader query to check user's team assignment. Document for follow-up.
2. **Dashboard page**: ManagerSidebar "Dashboard" links to `/properties/$propertyId` which currently shows the property overview/edit form. A real dashboard with metrics needs to be built in Session 3.
3. **People page**: `/properties/$propertyId/people` route doesn't exist yet. Will be created in Session 3 as a tabbed view replacing separate staff/members/teams routes.
4. **Staff pages not created yet** (`/home`, `/progress`, `/leaderboard`, `/team`): Staff users clicking sidebar items will get 404 until Session 3 creates these pages. Acceptable for now — staff features aren't built yet.
