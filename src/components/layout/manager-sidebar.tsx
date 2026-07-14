import { useRouterState, useNavigate } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { Link } from '@tanstack/react-router'
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
import { usePropertyId } from '#/components/hooks/use-property-id'
import { ManagerNavItems } from './manager-nav-items'
import { ManagerPropertySwitcher } from './manager-property-switcher'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'

type Props = Readonly<{
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
  getLastVisitCount: typeof getLastVisitCountFn
}>

function useActiveSection(): string {
  return useRouterState({
    select: (s) => {
      if (s.location.pathname.startsWith('/settings')) return 'settings'
      if (s.location.pathname === '/inbox' || s.location.pathname.startsWith('/inbox'))
        return 'inbox'
      if (s.location.pathname.startsWith('/leaderboard')) return 'leaderboard'
      if (
        s.location.pathname === '/properties' ||
        s.location.pathname.startsWith('/import')
      )
        return ''
      const m = s.location.pathname.match(/\/properties\/[^/]+(?:\/([^/]+))?/)
      if (!m) return 'dashboard'
      if (m[1] === 'portals') return 'portals'
      if (m[1] === 'reviews') return 'reviews'
      if (m[1] === 'people') return 'people'
      if (m[1] === 'goals') return 'goals'
      return 'dashboard'
    },
  })
}

export function ManagerSidebar({ properties, getLastVisitCount }: Props) {
  const propertyId = usePropertyId()
  const activeSection = useActiveSection()
  const navigate = useNavigate()

  function handlePropertySwitch(newPropertyId: string) {
    navigate({
      to: '/properties/$propertyId',
      params: { propertyId: newPropertyId },
    })
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ManagerPropertySwitcher
          properties={properties}
          propertyId={propertyId ?? undefined}
          onSwitch={handlePropertySwitch}
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <ManagerNavItems
              propertyId={propertyId ?? undefined}
              activeSection={activeSection}
              getLastVisitCount={getLastVisitCount}
            />
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
