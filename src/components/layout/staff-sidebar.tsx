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
import {
  useStaffPropertyId,
  setStaffPropertyId,
} from '#/components/hooks/use-staff-property-id'
import { StaffNavItems } from './staff-nav-items'
import { StaffOrgSwitcher } from './staff-org-switcher'
import { StaffPropertySwitcher } from './staff-property-switcher'

type Props = Readonly<{
  organizations: ReadonlyArray<{ id: string; name: string }>
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
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
  properties,
  activeOrganization,
  setActiveOrganization,
  hasTeam,
}: Props) {
  const activeSection = useActiveSection()
  const navigate = useNavigate()
  const setOrg = useAction(setActiveOrganization)
  const rawPropertyId = useStaffPropertyId()

  // Default to the first property if none is stored (e.g., first load).
  const propertyId: string | undefined =
    rawPropertyId ?? (properties.length > 0 ? properties[0].id : undefined)

  function handleOrgSwitch(orgId: string) {
    setOrg({ data: { organizationId: orgId } })
      .then(() => {
        navigate({ to: '/' })
      })
      .catch(() => {
        // Error is tracked in setOrg.error via useAction
      })
  }

  function handlePropertySwitch(newPropertyId: string) {
    setStaffPropertyId(newPropertyId)
    navigate({ to: '/home' })
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <StaffOrgSwitcher
          organizations={organizations}
          activeOrganization={activeOrganization}
          onSwitch={handleOrgSwitch}
        />
        <StaffPropertySwitcher
          properties={properties}
          propertyId={propertyId}
          onSwitch={handlePropertySwitch}
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
