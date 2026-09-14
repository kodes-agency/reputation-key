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
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '#/components/ui/sidebar'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { hasRole } from '#/shared/domain/roles'

type NavItem = Readonly<{
  key: string
  label: string
  icon: typeof User
  href: string
}>

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

  // Two scopes, labelled, because nothing else says which rows a page
  // changes: "You" is the signed-in account (notification rows included — they
  // belong to the user, filtered by property), "Organization" is shared by
  // every member. Property configuration is not here: it lives on the property.
  const groups: ReadonlyArray<
    Readonly<{ label: string; items: ReadonlyArray<NavItem> }>
  > = [
    {
      label: 'You',
      items: [
        { key: 'profile', label: 'Profile', icon: User, href: '/settings/profile' },
        { key: 'security', label: 'Security', icon: Shield, href: '/settings/security' },
        {
          key: 'preferences',
          label: 'Preferences',
          icon: Palette,
          href: '/settings/preferences',
        },
        {
          key: 'notifications',
          label: 'Notifications',
          icon: Bell,
          href: '/settings/notifications',
        },
      ],
    },
    {
      label: 'Organization',
      items: [
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
          ? [{ key: 'members', label: 'Members', icon: Users, href: '/settings/members' }]
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
        ...(can('ai.manage')
          ? [
              {
                key: 'ai',
                label: 'AI overview',
                icon: BrainCircuit,
                href: '/settings/ai',
              },
            ]
          : []),
      ],
    },
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
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
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
            ))}
        </SidebarContent>
        <SidebarRail />
      </nav>
    </Sidebar>
  )
}
