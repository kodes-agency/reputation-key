import { useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Globe,
  Building2,
  ChevronsUpDown,
  Settings,
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
import { CreateOrganizationDialog } from '#/components/features/organization/CreateOrganizationDialog'
import type { Role } from '#/shared/domain/roles'

type Props = Readonly<{
  role: Role
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganization: { id: string; name: string } | null
  setActiveOrganization: (input: { data: { organizationId: string } }) => Promise<void>
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
}>

const navItems: ReadonlyArray<{
  key: string
  label: string
  icon: typeof LayoutDashboard
  to: string
}> = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: '/properties/$propertyId',
  },
  {
    key: 'reviews',
    label: 'Reviews',
    icon: MessageSquare,
    to: '/properties/$propertyId/reviews',
  },
  {
    key: 'people',
    label: 'People',
    icon: Users,
    to: '/properties/$propertyId/people',
  },
  {
    key: 'portals',
    label: 'Portals',
    icon: Globe,
    to: '/properties/$propertyId/portals',
  },
]

function useActiveSection(): string {
  return useRouterState({
    select: (s) => {
      if (s.location.pathname.startsWith('/settings')) return 'settings'
      if (
        s.location.pathname === '/properties' ||
        s.location.pathname === '/properties/new'
      )
        return ''
      const m = s.location.pathname.match(/\/properties\/[^/]+(?:\/([^/]+))?/)
      if (!m) return 'dashboard'
      if (m[1] === 'portals') return 'portals'
      if (m[1] === 'reviews') return 'reviews'
      if (m[1] === 'people') return 'people'
      return 'dashboard'
    },
  })
}

export function ManagerSidebar({
  role: _role,
  organizations,
  activeOrganization,
  setActiveOrganization,
  properties,
}: Props) {
  void _role
  const propertyId = usePropertyId()
  const activeSection = useActiveSection()
  const navigate = useNavigate()
  const [createOrgOpen, setCreateOrgOpen] = useState(false)

  const setOrg = useAction(setActiveOrganization)

  function handleOrgSwitch(orgId: string) {
    void setOrg({ data: { organizationId: orgId } })
      .then(() => {
        if (properties.length > 0) {
          navigate({
            to: '/properties/$propertyId',
            params: { propertyId: properties[0].id },
          })
        } else {
          navigate({ to: '/properties' })
        }
      })
      .catch(() => {})
  }

  function handlePropertySwitch(newPropertyId: string) {
    navigate({
      to: '/properties/$propertyId',
      params: { propertyId: newPropertyId },
    })
  }

  const activeProperty = properties.find((p) => p.id === propertyId)

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
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
                <DropdownMenuContent side="bottom" align="start" className="w-64">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Organizations
                  </div>
                  <DropdownMenuSeparator />
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
                    <Plus className="size-4 mr-2" />
                    Create Organization
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>

            {properties.length > 1 && (
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton size="sm">
                      <div className="flex aspect-square size-4 items-center justify-center rounded bg-muted">
                        <Building2 className="size-3" />
                      </div>
                      <span className="truncate text-xs">
                        {activeProperty?.name ?? 'Select property'}
                      </span>
                      <ChevronsUpDown className="ml-auto size-3" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="start" className="w-56">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Properties
                    </div>
                    <DropdownMenuSeparator />
                    {properties.map((prop) => (
                      <DropdownMenuItem
                        key={prop.id}
                        onClick={() => handlePropertySwitch(prop.id)}
                      >
                        {prop.name}
                        {prop.id === propertyId && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            Active
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive = !!propertyId && activeSection === item.key

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
      <CreateOrganizationDialog
        open={createOrgOpen}
        onOpenChange={setCreateOrgOpen}
        onSuccess={() => window.location.reload()}
      />
    </>
  )
}
