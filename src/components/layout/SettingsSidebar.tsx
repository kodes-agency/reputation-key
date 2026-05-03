import { Link, useRouterState } from '@tanstack/react-router'
import { User, Shield, Palette, Building2, ArrowLeft } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '#/components/ui/sidebar'
import { usePermissions } from '#/shared/hooks/usePermissions'

function useActiveSettingsSection(): string {
  return useRouterState({
    select: (s) => {
      const match = s.location.pathname.match(/\/settings\/([^/]+)/)
      return match?.[1] ?? 'profile'
    },
  })
}

export function SettingsSidebar() {
  const activeSection = useActiveSettingsSection()
  const { can, role } = usePermissions()
  const returnPath = role === 'Staff' ? '/' : '/properties'

  const items = [
    { key: 'profile', label: 'Profile', icon: User, href: '/settings/profile' },
    { key: 'security', label: 'Security', icon: Shield, href: '/settings/security' },
    {
      key: 'preferences',
      label: 'Preferences',
      icon: Palette,
      href: '/settings/preferences',
    },
    ...(can('organization.update')
      ? [
          {
            key: 'organization',
            label: 'Organization',
            icon: Building2,
            href: '/settings/organization',
          },
        ]
      : []),
  ]

  return (
    <Sidebar collapsible="offcanvas" className="border-r">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to app">
              <Link to={returnPath as never}>
                <ArrowLeft />
                <span>Back to app</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
