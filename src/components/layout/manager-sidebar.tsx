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
      if (
        s.location.pathname === '/properties' ||
        s.location.pathname.startsWith('/properties/import-google')
      )
        return ''
      // eslint-disable-next-line security/detect-unsafe-regex -- BQC-7.7 (owner: platform): char-class-only pattern, no nested quantifiers; safe-regex star-height false positive
      const m = s.location.pathname.match(/\/properties\/[^/]+(?:\/([^/]+))?/)
      if (!m) return 'dashboard'
      if (m[1] === 'portals') return 'portals'
      if (m[1] === 'reviews') return 'reviews'
      if (m[1] === 'people') return 'people'
      if (m[1] === 'goals') return 'goals'
      if (m[1] === 'settings') return 'property-settings'
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
      {/*
        BQC-6.8: the app sidebar IS the primary navigation — give it the nav
        landmark so its links don't fail axe's region rule (all page content
        must be inside a landmark). flex-col h-full replicates the
        sidebar-inner layout so rendering is unchanged.
      */}
      <nav aria-label="Primary navigation" className="flex h-full w-full flex-col">
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
      </nav>
    </Sidebar>
  )
}
