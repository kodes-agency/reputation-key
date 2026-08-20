import { Link } from '@tanstack/react-router'
import { Home, TrendingUp, Trophy, Users } from 'lucide-react'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type { Capability } from '#/shared/auth/beta-capabilities'

type Props = Readonly<{
  activeSection: string
  hasTeam: boolean
}>

/**
 * `capability` mirrors the gate the destination route's `beforeLoad` already
 * runs (`gateControlledRoute`), so the nav never offers a link that lands on
 * `/unavailable`. `/home` carries no capability gate.
 *
 * Disabling here is a UI affordance, not a security boundary — the route gate
 * and every server function still authorize independently (ADR 0049, mirroring
 * the note in `controlled-route-gate.ts`).
 */
const NOT_IN_BETA_TOOLTIP = 'Not available in this beta'

const staffNavItems: ReadonlyArray<{
  key: string
  label: string
  icon: typeof Home
  href: string
  capability?: Capability
}> = [
  { key: 'home', label: 'Home', icon: Home, href: '/home' },
  {
    key: 'progress',
    label: 'Progress',
    icon: TrendingUp,
    href: '/progress',
    capability: 'goal.use',
  },
  {
    key: 'leaderboard',
    label: 'Leaderboard',
    icon: Trophy,
    href: '/leaderboard',
    capability: 'leaderboard.use',
  },
]

export function StaffNavItems({ activeSection, hasTeam }: Props) {
  const { has } = useCapabilities()

  return (
    <SidebarMenu>
      {staffNavItems.map((item) =>
        item.capability !== undefined && !has(item.capability) ? (
          <SidebarMenuItem key={item.key}>
            <SidebarMenuButton disabled tooltip={NOT_IN_BETA_TOOLTIP}>
              <item.icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
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
        ),
      )}
      {hasTeam &&
        (has('team.use') ? (
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={activeSection === 'team'} tooltip="Team">
              <Link to="/team">
                <Users />
                <span>Team</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          <SidebarMenuItem>
            <SidebarMenuButton disabled tooltip={NOT_IN_BETA_TOOLTIP}>
              <Users />
              <span>Team</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
    </SidebarMenu>
  )
}
