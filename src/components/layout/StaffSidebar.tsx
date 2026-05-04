import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
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
import { useAction } from '#/components/hooks/use-action'

type Props = Readonly<{
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganization: { id: string; name: string } | null
  setActiveOrganization: (input: { data: { organizationId: string } }) => Promise<void>
  hasTeam: boolean
}>

const staffNavItems = [
  { key: 'home', label: 'Home', icon: Home, href: '/home' },
  { key: 'progress', label: 'Progress', icon: TrendingUp, href: '/progress' },
  {
    key: 'leaderboard',
    label: 'Leaderboard',
    icon: Trophy,
    href: '/leaderboard',
  },
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
  organizations,
  activeOrganization,
  setActiveOrganization,
  hasTeam,
}: Props) {
  const activeSection = useActiveSection()
  const navigate = useNavigate()
  const setOrg = useAction(setActiveOrganization)

  function handleOrgSwitch(orgId: string) {
    setOrg({ data: { organizationId: orgId } })
      .then(() => {
        navigate({ to: '/' })
      })
      .catch(() => {
        // Error is tracked in setOrg.error via useAction
      })
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          {activeOrganization && (
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg">
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
                      <span className="text-xs font-bold">
                        {activeOrganization.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {activeOrganization.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        Organization
                      </span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="start" className="w-64">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Organizations
                  </div>
                  {organizations.map((org) => (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => handleOrgSwitch(org.id)}
                    >
                      {org.name}
                      {org.id === activeOrganization.id && (
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
