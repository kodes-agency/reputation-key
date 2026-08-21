import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Globe,
  Target,
  Trophy,
} from 'lucide-react'
import { SidebarMenu, SidebarMenuBadge } from '#/components/ui/sidebar'
import { InboxVisitBadge } from '#/components/inbox/inbox-visit-badge'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type { Capabilities } from '#/shared/hooks/useCapabilities'
import { InertNavItem, LinkNavItem, NOT_IN_BETA_TOOLTIP } from './nav-items-shared'
import type { NavLinkTarget } from './nav-items-shared'
import type { Capability } from '#/shared/auth/beta-capabilities'

type Props = Readonly<{
  propertyId: string | undefined
  activeSection: string
  getLastVisitCount: typeof getLastVisitCountFn
}>

/**
 * `capability` is the capability the destination route already gates on
 * (see `gateControlledRoute` in each route's `beforeLoad`). Kept in lockstep
 * with those gates so the nav never offers a link that lands on
 * `/unavailable`. Dashboard and Reviews have no entry because their routes
 * carry no capability gate. See `nav-items-shared` for why disabling here is
 * an affordance rather than a boundary.
 *
 * `useSearch` marks the org-scoped destinations, which take the property in
 * search rather than as a path param.
 */
type ManagerNavItem = Readonly<{
  capability?: Capability
  key: string
  label: string
  useSearch?: boolean
  icon: typeof LayoutDashboard
  to: string
}>

const navItems: ReadonlyArray<ManagerNavItem> = [
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
    capability: 'staff.use',
  },
  {
    key: 'portals',
    label: 'Portals',
    icon: Globe,
    to: '/properties/$propertyId/portals',
    capability: 'portal.read',
  },
  {
    key: 'goals',
    label: 'Goals',
    icon: Target,
    to: '/properties/$propertyId/goals',
    capability: 'goal.use',
  },
  {
    key: 'leaderboard',
    label: 'Leaderboard',
    icon: Trophy,
    to: '/leaderboard',
    capability: 'leaderboard.use',
    useSearch: true,
  },
]

function ManagerNavRow({
  item,
  propertyId,
  activeSection,
  has,
  getLastVisitCount,
}: Readonly<{
  item: ManagerNavItem
  propertyId: string | undefined
  activeSection: string
  has: Capabilities['has']
  getLastVisitCount: typeof getLastVisitCountFn
}>) {
  const isUnavailable = item.capability !== undefined && !has(item.capability)

  // Same disabled affordance the no-property case already uses — an
  // eligible-by-role manager sees why the destination is inert instead
  // of navigating into /unavailable.
  if (!propertyId || isUnavailable) {
    return (
      <InertNavItem
        icon={item.icon}
        label={item.label}
        tooltip={isUnavailable ? NOT_IN_BETA_TOOLTIP : item.label}
      />
    )
  }

  const link: NavLinkTarget = item.useSearch
    ? { to: item.to, search: { propertyId } }
    : { to: item.to, params: { propertyId } }

  return (
    <LinkNavItem
      icon={item.icon}
      label={item.label}
      isActive={activeSection === item.key}
      link={link}
      badge={
        item.key === 'reviews' && (
          <SidebarMenuBadge>
            <InboxVisitBadge getLastVisitCount={getLastVisitCount} />
          </SidebarMenuBadge>
        )
      }
    />
  )
}

export function ManagerNavItems({ propertyId, activeSection, getLastVisitCount }: Props) {
  const { has } = useCapabilities()

  return (
    <SidebarMenu>
      {navItems.map((item) => (
        <ManagerNavRow
          key={item.key}
          item={item}
          propertyId={propertyId}
          activeSection={activeSection}
          has={has}
          getLastVisitCount={getLastVisitCount}
        />
      ))}
    </SidebarMenu>
  )
}
