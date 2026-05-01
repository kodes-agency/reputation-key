import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  LayoutDashboard,
  Users,
  Globe,
  MessageSquare,
  BarChart3,
  Contact,
  ChevronRight,
  Building2,
  ChevronsUpDown,
  Settings2,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { useServerFn } from '@tanstack/react-start'
// eslint-disable-next-line boundaries/dependencies
import { setActiveOrganization } from '#/contexts/identity/server/organizations'
import { useAction } from '#/components/hooks/use-action'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { hasRole } from '#/shared/domain/roles'
import type { Role } from '#/shared/domain/roles'

type Props = Readonly<{
  role: Role
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganization: { id: string; name: string } | null
}>

const navItems = [
  {
    key: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    to: '/properties/$propertyId' as const,
  },
  {
    key: 'staff',
    label: 'Staff',
    icon: Users,
    to: '/properties/$propertyId/staff' as const,
  },
  {
    key: 'teams',
    label: 'Teams',
    icon: Users,
    to: '/properties/$propertyId/teams' as const,
  },
  {
    key: 'portals',
    label: 'Portals',
    icon: Globe,
    to: '/properties/$propertyId/portals' as const,
  },
  {
    key: 'reviews',
    label: 'Reviews',
    icon: MessageSquare,
    to: '/properties/$propertyId/reviews' as const,
    disabled: true,
  },
  {
    key: 'metrics',
    label: 'Metrics',
    icon: BarChart3,
    to: '/properties/$propertyId/metrics' as const,
    disabled: true,
  },
  {
    key: 'members',
    label: 'Members',
    icon: Contact,
    to: '/properties/$propertyId/members' as const,
  },
]

const settingsItems = [
  {
    key: 'property-settings',
    label: 'Property',
    to: '/properties/$propertyId/settings/property' as const,
  },
  {
    key: 'org-settings',
    label: 'Organization',
    to: '/properties/$propertyId/settings/organization' as const,
    managerOnly: true,
  },
]

function useActiveSection(): string {
  return useRouterState({
    select: (s) => {
      const m = s.location.pathname.match(
        /\/properties\/[^/]+(?:\/([^/]+))(?:\/([^/]+))?/,
      )
      if (!m) return 'overview'
      if (m[1] === 'settings') return m[2] ? `settings/${m[2]}` : 'settings'
      return m[1]
    },
  })
}

export function AppSidebar({ role, organizations, activeOrganization }: Props) {
  const propertyId = usePropertyId()
  const activeSection = useActiveSection()
  const navigate = useNavigate()
  const setOrg = useAction(useServerFn(setActiveOrganization))

  const isManager = hasRole(role, 'PropertyManager')

  function handleOrgSwitch(orgId: string) {
    setOrg({ data: { organizationId: orgId } }).then(() => {
      navigate({ to: '/' })
    })
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <span className="text-xs font-bold">RK</span>
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Reputation Key</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = !!propertyId && activeSection === item.key

                if (item.disabled) {
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton disabled tooltip={item.label}>
                        <item.icon />
                        <span>{item.label}</span>
                        <span className="ml-auto text-[10px] font-medium text-muted-foreground">
                          Soon
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                }

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

        <SidebarSeparator />

        <SidebarGroup>
          <Collapsible
            defaultOpen={activeSection.startsWith('settings')}
            className="group/collapsible"
          >
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer select-none">
                <Settings2 className="size-4" />
                <span>Settings</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {settingsItems.map((item) => {
                    if (item.managerOnly && !isManager) return null

                    const isActive = !!propertyId && activeSection === item.key

                    if (!propertyId) {
                      return (
                        <SidebarMenuSubItem key={item.key}>
                          <div className="flex h-7 -translate-x-px items-center gap-2 rounded-md px-2 text-sm opacity-50">
                            <span>{item.label}</span>
                          </div>
                        </SidebarMenuSubItem>
                      )
                    }

                    return (
                      <SidebarMenuSubItem key={item.key}>
                        <SidebarMenuSubButton asChild isActive={isActive}>
                          <Link
                            to={item.to}
                            params={{
                              propertyId,
                            }}
                          >
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
                    <Building2 className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {activeOrganization?.name ?? 'No organization'}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {organizations.length > 1
                        ? `${organizations.length} organizations`
                        : 'Organization'}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-64">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Organizations
                </div>
                <DropdownMenuSeparator />
                {organizations.map((org) => (
                  <DropdownMenuItem key={org.id} onClick={() => handleOrgSwitch(org.id)}>
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
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
