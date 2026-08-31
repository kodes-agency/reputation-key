import { Link, useRouterState } from '@tanstack/react-router'
import {
  User,
  Users,
  Shield,
  Palette,
  Building2,
  ArrowLeft,
  Bell,
  Plug,
  BrainCircuit,
  ShieldAlert,
} from 'lucide-react'
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
import { hasRole } from '#/shared/domain/roles'

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
  const isManager = hasRole(role, 'PropertyManager')

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
    ...(can('member.list')
      ? [
          {
            key: 'members',
            label: 'Members',
            icon: Users,
            href: '/settings/members',
          },
        ]
      : []),
    {
      key: 'notifications',
      label: 'Notifications',
      icon: Bell,
      href: '/settings/notifications',
    },
    ...(can('ai.manage')
      ? [
          {
            key: 'ai',
            label: 'AI & replies',
            icon: BrainCircuit,
            href: '/settings/ai',
          },
        ]
      : []),
    ...(can('integration.manage')
      ? [
          {
            key: 'integrations',
            label: 'Integrations',
            icon: Plug,
            href: '/settings/integrations',
          },
        ]
      : []),
    // LIF-01-T17. Gated on the AccountAdmin ROLE, not on a capability: a
    // closure suspends the Organization, which denies every capability, and
    // the Closure Center is the only surface that can then cancel it or hand
    // the tenant their export. A capability gate would lock them out of it.
    ...(hasRole(role, 'AccountAdmin')
      ? [
          {
            key: 'closure',
            label: 'Closure Center',
            icon: ShieldAlert,
            href: '/settings/closure',
          },
        ]
      : []),
  ]

  return (
    <Sidebar collapsible="offcanvas" className="border-r">
      {/* BQC-6.8: nav landmark for the settings navigation (see manager-sidebar). */}
      <nav aria-label="Settings navigation" className="flex h-full w-full flex-col">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Back to app">
                <Link to={isManager ? '/properties' : '/'}>
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
      </nav>
    </Sidebar>
  )
}
