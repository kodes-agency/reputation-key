import { Home, TrendingUp, Trophy, Users } from 'lucide-react'
import { SidebarMenu } from '#/components/ui/sidebar'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type { Capabilities } from '#/shared/hooks/useCapabilities'
import { InertNavItem, LinkNavItem, NOT_IN_BETA_TOOLTIP } from './nav-items-shared'
import type { Capability } from '#/shared/auth/beta-capabilities'

type Props = Readonly<{
  activeSection: string
  hasTeam: boolean
}>

/**
 * `capability` mirrors the gate the destination route's `beforeLoad` already
 * runs (`gateControlledRoute`), so the nav never offers a link that lands on
 * `/unavailable`. `/home` carries no capability gate. See `nav-items-shared`
 * for why disabling here is an affordance rather than a boundary.
 */
type StaffNavItem = Readonly<{
  key: string
  label: string
  icon: typeof Home
  href: string
  capability?: Capability
}>

const staffNavItems: ReadonlyArray<StaffNavItem> = [
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

// `/team` is only reachable for a staff member who belongs to one, so it trails
// the always-present entries rather than living in the list above. Both arrays
// are module constants — neither render path allocates.
const staffNavItemsWithTeam: ReadonlyArray<StaffNavItem> = [
  ...staffNavItems,
  { key: 'team', label: 'Team', icon: Users, href: '/team', capability: 'team.use' },
]

function StaffNavRow({
  item,
  activeSection,
  has,
}: Readonly<{
  item: StaffNavItem
  activeSection: string
  has: Capabilities['has']
}>) {
  if (item.capability !== undefined && !has(item.capability)) {
    return (
      <InertNavItem icon={item.icon} label={item.label} tooltip={NOT_IN_BETA_TOOLTIP} />
    )
  }

  return (
    <LinkNavItem
      icon={item.icon}
      label={item.label}
      isActive={activeSection === item.key}
      link={{ to: item.href }}
    />
  )
}

export function StaffNavItems({ activeSection, hasTeam }: Props) {
  const { has } = useCapabilities()
  const items = hasTeam ? staffNavItemsWithTeam : staffNavItems

  return (
    <SidebarMenu>
      {items.map((item) => (
        <StaffNavRow key={item.key} item={item} activeSection={activeSection} has={has} />
      ))}
    </SidebarMenu>
  )
}
