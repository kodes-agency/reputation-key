import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { useNavigate } from '@tanstack/react-router'
import { QrCode, Settings } from 'lucide-react'
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
import { NavLink } from '#/components/ui/nav-link'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { useInboxScopeNavigation } from '#/components/inbox/use-inbox-scope-navigation'
import { useRenderedPathname } from './rendered-location'
import { ManagerNavItems } from './manager-nav-items'
import { ManagerPropertySwitcher } from './manager-property-switcher'
import { isOrganisationView, organisationViewFor } from './organisation-scope'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'

type Props = Readonly<{
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
  organizationName?: string | undefined
  hasPersonalPortal?: boolean | undefined
  getLastVisitCount: typeof getLastVisitCountFn
}>

// The section a pathname belongs to; asked of the page ON SCREEN (`rendered-location`).
function sectionForPathname(pathname: string): string {
  if (pathname.startsWith('/settings')) return 'settings'
  if (pathname === '/inbox' || pathname.startsWith('/inbox')) return 'inbox'
  // The All properties page: Portals across the Organization, no Property in scope.
  if (pathname === '/portals' || pathname.startsWith('/portals/')) return 'portals'
  if (pathname === '/properties' || pathname.startsWith('/properties/import-google'))
    return ''
  // eslint-disable-next-line security/detect-unsafe-regex -- BQC-7.7 (owner: platform): char-class-only pattern, no nested quantifiers; safe-regex star-height false positive
  const m = pathname.match(/\/properties\/[^/]+(?:\/([^/]+))?/)
  if (!m) return 'dashboard'
  if (m[1] === 'portals') return 'portals'
  if (m[1] === 'ratings') return 'ratings'
  if (m[1] === 'google') return 'google'
  if (m[1] === 'guests') return 'guests'
  if (m[1] === 'reviews') return 'reviews'
  if (m[1] === 'people') return 'people'
  if (m[1] === 'goals') return 'goals'
  if (m[1] === 'settings') return 'property-settings'
  return 'dashboard'
}

export function ManagerSidebar({
  properties,
  organizationName,
  hasPersonalPortal = false,
  getLastVisitCount,
}: Props) {
  const capabilities = useCapabilities()
  const propertyId = usePropertyId()
  const pathname = useRenderedPathname()
  const activeSection = sectionForPathname(pathname)
  const navigate = useNavigate()
  const selectInboxScope = useInboxScopeNavigation()
  const isInboxSection = activeSection === 'inbox' || activeSection === 'reviews'
  const allPropertiesPath = organisationViewFor(activeSection)
  const isAllProperties = isOrganisationView(pathname, propertyId)

  // Inside the Inbox, switching property keeps you in the Inbox; the rail offers All properties.
  function handlePropertySwitch(newPropertyId: string) {
    if (isInboxSection) {
      selectInboxScope(newPropertyId)
      return
    }

    navigate({
      to: '/properties/$propertyId',
      params: { propertyId: newPropertyId },
    })
  }

  // The Inbox goes through its scope hook so queue and filters survive the move.
  function handleSelectAllProperties() {
    // Already over the whole Organization: keep the open page's own state.
    if (isAllProperties) return
    if (isInboxSection) {
      selectInboxScope(null)
      return
    }
    void navigate({ to: allPropertiesPath })
  }

  return (
    <Sidebar>
      {/* BQC-6.8: the nav landmark keeps the links inside a landmark for axe's region rule. */}
      <nav aria-label="Primary navigation" className="flex h-full w-full flex-col">
        <SidebarHeader>
          <ManagerPropertySwitcher
            properties={properties}
            propertyId={propertyId ?? undefined}
            organizationName={organizationName}
            isAllProperties={isAllProperties}
            allPropertiesIsListed={allPropertiesPath !== '/properties'}
            onSwitch={handlePropertySwitch}
            onSelectAllProperties={handleSelectAllProperties}
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
            {hasPersonalPortal && capabilities.has('staff.accounts') && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === '/my-code'}
                  tooltip="My code"
                >
                  <NavLink to="/my-code" current={pathname === '/my-code'}>
                    <QrCode />
                    <span>My code</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={activeSection === 'settings'}
                tooltip="Settings"
              >
                <NavLink to="/settings/profile" current={activeSection === 'settings'}>
                  <Settings />
                  <span>Settings</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </nav>
    </Sidebar>
  )
}
