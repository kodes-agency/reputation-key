import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Globe,
  Target,
  SlidersHorizontal,
} from 'lucide-react'
import { SidebarMenu, SidebarMenuBadge } from '#/components/ui/sidebar'
import { InboxVisitBadge } from '#/components/inbox/inbox-visit-badge'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type { Capabilities } from '#/shared/hooks/useCapabilities'
import { InertNavItem, LinkNavItem } from './nav-items-shared'
import type { Capability } from '#/shared/auth/beta-capabilities'
import { REFUSAL_COPY } from '#/shared/auth/capability-refusal-category'

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
 */
type ManagerNavItem = Readonly<{
  capability?: Capability
  key: string
  label: string
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
    key: 'property-settings',
    label: 'Property settings',
    icon: SlidersHorizontal,
    to: '/properties/$propertyId/settings',
  },
]

function ManagerNavRow({
  item,
  propertyId,
  activeSection,
  has,
  refusal,
  getLastVisitCount,
}: Readonly<{
  item: ManagerNavItem
  propertyId: string | undefined
  activeSection: string
  has: Capabilities['has']
  refusal: Capabilities['refusal']
  getLastVisitCount: typeof getLastVisitCountFn
}>) {
  const isUnavailable = item.capability !== undefined && !has(item.capability)
  const category = item.capability === undefined ? null : refusal(item.capability)

  // Same disabled affordance the no-property case already uses — an
  // eligible-by-role manager sees why the destination is inert instead
  // of navigating into /unavailable.
  if (!propertyId || isUnavailable) {
    return (
      <InertNavItem
        icon={item.icon}
        label={item.label}
        tooltip={
          isUnavailable ? REFUSAL_COPY[category ?? 'not_in_beta'].tooltip : item.label
        }
      />
    )
  }

  return (
    <LinkNavItem
      icon={item.icon}
      label={item.label}
      isActive={activeSection === item.key}
      link={{ to: item.to, params: { propertyId } }}
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
  const { has, refusal } = useCapabilities()

  return (
    <SidebarMenu>
      {navItems.map((item) => (
        <ManagerNavRow
          key={item.key}
          item={item}
          propertyId={propertyId}
          activeSection={activeSection}
          has={has}
          refusal={refusal}
          getLastVisitCount={getLastVisitCount}
        />
      ))}
    </SidebarMenu>
  )
}
