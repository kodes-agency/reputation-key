import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
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
import { usePropertyId } from '#/components/hooks/use-property-id'
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
  const rawPropertyId = usePropertyId()

  // The URL ?propertyId= is the single source of truth (ADR 0016). Ensure a
  // valid property is selected: default to the first when absent, reset when
  // the active id is no longer in the user's properties. Done via navigation
  // so the URL — not localStorage — holds the state.
  useEffect(() => {
    if (properties.length === 0) return
    const valid = !!rawPropertyId && properties.some((p) => p.id === rawPropertyId)
    if (!valid) {
      navigate({
        to: '.',
        search: (prev) => ({ ...prev, propertyId: properties[0].id }),
        replace: true,
      })
    }
  }, [rawPropertyId, properties, navigate])

  // Fallback to the first property for switcher display before the URL is set.
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
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, propertyId: newPropertyId }),
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
