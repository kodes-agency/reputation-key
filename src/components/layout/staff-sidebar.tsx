import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
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
import { useAction } from '#/components/hooks/use-action'
import { StaffNavItems } from './staff-nav-items'
import { StaffOrgSwitcher } from './staff-org-switcher'

type Props = Readonly<{
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganization: { id: string; name: string } | null
  setActiveOrganization: (input: { data: { organizationId: string } }) => Promise<void>
  hasTeam: boolean
}>

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
        <StaffOrgSwitcher
          organizations={organizations}
          activeOrganization={activeOrganization}
          onSwitch={handleOrgSwitch}
        />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <StaffNavItems activeSection={activeSection} hasTeam={hasTeam} />
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
