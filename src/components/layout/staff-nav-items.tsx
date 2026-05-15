import { Link } from '@tanstack/react-router'
import { Home, TrendingUp, Trophy, Users } from 'lucide-react'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'

type Props = Readonly<{
  activeSection: string
  hasTeam: boolean
}>

const staffNavItems = [
  { key: 'home', label: 'Home', icon: Home, href: '/home' },
  { key: 'progress', label: 'Progress', icon: TrendingUp, href: '/progress' },
  {
    key: 'leaderboard',
    label: 'Leaderboard',
    icon: Trophy,
    href: '/leaderboard',
  },
]

export function StaffNavItems({ activeSection, hasTeam }: Props) {
  return (
    <SidebarMenu>
      {staffNavItems.map((item) => (
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
      {hasTeam && (
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={activeSection === 'team'} tooltip="Team">
            <Link to="/team">
              <Users />
              <span>Team</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  )
}
