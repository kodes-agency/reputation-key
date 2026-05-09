import { useRouterState } from '@tanstack/react-router'
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

type Props = Readonly<{
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
}>

function useActiveSection(): string {
  return useRouterState({
    select: (s) => {
      if (s.location.pathname.startsWith('/settings')) return 'settings'
      if (
        s.location.pathname === '/properties' ||
        s.location.pathname.startsWith('/properties/import')
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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ManagerPropertySwitcher
          properties={properties}
          propertyId={propertyId}
          onSwitch={handlePropertySwitch}
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <ManagerNavItems propertyId={propertyId} activeSection={activeSection} />
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
