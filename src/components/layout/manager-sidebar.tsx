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
} from '#/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { usePropertyId } from '#/components/hooks/use-property-id'

type Props = Readonly<{
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

export function ManagerSidebar({ properties }: Props) {
  const propertyId = usePropertyId()
  const activeSection = useActiveSection()
  const navigate = useNavigate()

  function handlePropertySwitch(newPropertyId: string) {
    navigate({
      to: '/properties/$propertyId',
      params: { propertyId: newPropertyId },
    })
  }

  const activeProperty = properties.find((p) => p.id === propertyId)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="size-4 text-primary" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {activeProperty?.name ?? 'Select property'}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {activeProperty?.slug ?? 'No property selected'}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="start" className="w-64">
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: '/properties' })}>
                  <Building2 className="mr-2 size-4" />
                  View all properties
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: '/properties/new' })}>
                  <Plus className="mr-2 size-4" />
                  Create property
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

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
  )
}
