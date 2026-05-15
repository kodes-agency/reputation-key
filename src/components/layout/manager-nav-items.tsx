import { Link } from '@tanstack/react-router'
import { LayoutDashboard, MessageSquare, Users, Globe } from 'lucide-react'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'

type Props = Readonly<{
  propertyId: string | undefined
  activeSection: string
}>

const navItems: ReadonlyArray<{
  key: string
  label: string
  icon: typeof LayoutDashboard
  to: string
}> = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: '/properties/$propertyId',
  },
  {
    key: 'reviews',
    label: 'Reviews',
    icon: MessageSquare,
    to: '/properties/$propertyId/reviews',
  },
  {
    key: 'people',
    label: 'People',
    icon: Users,
    to: '/properties/$propertyId/people',
  },
  {
    key: 'portals',
    label: 'Portals',
    icon: Globe,
    to: '/properties/$propertyId/portals',
  },
]

export function ManagerNavItems({ propertyId, activeSection }: Props) {
  return (
    <SidebarMenu>
      {navItems.map((item) => {
        const isActive = !!propertyId && activeSection === item.key

        if (!propertyId) {
          return (
            <SidebarMenuItem key={item.key}>
              <SidebarMenuButton disabled tooltip={item.label}>
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        }

        return (
          <SidebarMenuItem key={item.key}>
            <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
              <Link to={item.to} params={{ propertyId }}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
