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
import {
  CategoryNavItem,
  CategoryNavSubItem,
  InertNavItem,
  LinkNavItem,
} from './nav-items-shared'
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

/**
 * The dashboard's sub-pages (redesign rows 1, 2). Overview leads because it is
 * also the category's own landing page; the other three answer one question
 * each — how are we rated, how are we found, what do guests say.
 *
 * No entry carries a capability: like the overview they were split out of, none
 * of these routes gates on one. Guest voice checks the `dashboard.read`
 * *permission* in its own `beforeLoad`, which every role that can see this
 * sidebar already holds, so an inert row here would be a phantom.
 */
const dashboardSubItems: ReadonlyArray<
  Readonly<{ key: string; label: string; to: string }>
> = [
  { key: 'dashboard', label: 'Overview', to: '/properties/$propertyId' },
  { key: 'ratings', label: 'Ratings', to: '/properties/$propertyId/ratings' },
  { key: 'google', label: 'Google', to: '/properties/$propertyId/google' },
  { key: 'guests', label: 'Guest voice', to: '/properties/$propertyId/guests' },
]

const DASHBOARD_SECTIONS: ReadonlySet<string> = new Set(
  dashboardSubItems.map((item) => item.key),
)

/** Entries below the Dashboard category, in sidebar order. */
const navItems: ReadonlyArray<ManagerNavItem> = [
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

/**
 * The Dashboard category and its four sub-pages. Without a property — the
 * properties list, the import flow — the whole category is inert, exactly as
 * every property-scoped entry already was: there is nothing for Ratings or
 * Google to be about yet.
 */
function DashboardCategory({
  propertyId,
  activeSection,
}: Readonly<{
  propertyId: string | undefined
  activeSection: string
}>) {
  if (!propertyId) {
    return <InertNavItem icon={LayoutDashboard} label="Dashboard" tooltip="Dashboard" />
  }

  return (
    <CategoryNavItem
      icon={LayoutDashboard}
      label="Dashboard"
      isActive={DASHBOARD_SECTIONS.has(activeSection)}
      link={{ to: '/properties/$propertyId', params: { propertyId } }}
    >
      {dashboardSubItems.map((item) => (
        <CategoryNavSubItem
          key={item.key}
          label={item.label}
          isActive={activeSection === item.key}
          link={{ to: item.to, params: { propertyId } }}
        />
      ))}
    </CategoryNavItem>
  )
}

export function ManagerNavItems({ propertyId, activeSection, getLastVisitCount }: Props) {
  const { has, refusal } = useCapabilities()

  return (
    <SidebarMenu>
      <DashboardCategory propertyId={propertyId} activeSection={activeSection} />
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
