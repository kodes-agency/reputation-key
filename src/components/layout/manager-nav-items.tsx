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
  type NavLinkTarget,
} from './nav-items-shared'
import type { Capability } from '#/shared/auth/beta-capabilities'
import { REFUSAL_COPY } from '#/shared/auth/capability-refusal-category'
import { NAV_LABEL } from './nav-labels'

type Props = Readonly<{
  propertyId: string | undefined
  activeSection: string
  getLastVisitCount: typeof getLastVisitCountFn
}>

/**
 * `capability` is the one the destination route already gates on (see
 * `gateControlledRoute`); keep them in lockstep so the nav never links to the
 * unavailable page. Dashboard and Reviews carry none. See `nav-items-shared`.
 */
type ManagerNavItem = Readonly<{
  capability?: Capability
  key: string
  label: string
  icon: typeof LayoutDashboard
  to: string
}>

/**
 * The dashboard's sub-pages. Overview leads because it is also the category's
 * landing page. No entry carries a capability: none of these routes gates on one
 * (Guest voice checks the `dashboard.read` permission, which every role that sees
 * this sidebar holds), so an inert row would be a phantom.
 */
const dashboardSubItems: ReadonlyArray<
  Readonly<{ key: string; label: string; to: string }>
> = [
  { key: 'dashboard', label: NAV_LABEL.overview, to: '/properties/$propertyId' },
  { key: 'ratings', label: NAV_LABEL.ratings, to: '/properties/$propertyId/ratings' },
  { key: 'google', label: NAV_LABEL.google, to: '/properties/$propertyId/google' },
  { key: 'guests', label: NAV_LABEL.guests, to: '/properties/$propertyId/guests' },
]

const DASHBOARD_SECTIONS: ReadonlySet<string> = new Set(
  dashboardSubItems.map((item) => item.key),
)

/** Entries below the Dashboard category, in sidebar order. */
const navItems: ReadonlyArray<ManagerNavItem> = [
  {
    key: 'reviews',
    label: NAV_LABEL.reviews,
    icon: MessageSquare,
    to: '/properties/$propertyId/reviews',
  },
  {
    key: 'people',
    label: NAV_LABEL.staff,
    icon: Users,
    to: '/properties/$propertyId/people',
    capability: 'staff.use',
  },
  {
    key: 'portals',
    label: NAV_LABEL.portals,
    icon: Globe,
    to: '/properties/$propertyId/portals',
    capability: 'portal.read',
  },
  {
    key: 'goals',
    label: NAV_LABEL.goals,
    icon: Target,
    to: '/properties/$propertyId/goals',
    capability: 'goal.use',
  },
  {
    key: 'property-settings',
    label: NAV_LABEL.propertySettings,
    icon: SlidersHorizontal,
    to: '/properties/$propertyId/settings',
  },
]

// Reviews opens the Inbox at the scope you are in: a property's pages open
// that property; a page without one (the properties list) opens All properties.
// Portals does the same: a page without a Property opens All properties, the
// Portals of the whole Organization, grouped by Property.
function navLinkFor(
  item: ManagerNavItem,
  propertyId: string | undefined,
  activeSection: string,
): NavLinkTarget | null {
  if (item.key === 'reviews' && (activeSection === 'inbox' || !propertyId)) {
    return { to: '/inbox' }
  }
  if (item.key === 'portals' && !propertyId) return { to: '/portals' }
  return propertyId ? { to: item.to, params: { propertyId } } : null
}

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
  const isOrganizationInbox = item.key === 'reviews' && activeSection === 'inbox'
  const link = navLinkFor(item, propertyId, activeSection)

  // Same disabled affordance as the no-property case: the manager sees why the
  // destination is inert instead of landing on the unavailable page.
  if (link === null || isUnavailable) {
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
      isActive={activeSection === item.key || isOrganizationInbox}
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

/** The Dashboard category and its sub-pages; without a property the whole category is inert. */
function DashboardCategory({
  propertyId,
  activeSection,
}: Readonly<{
  propertyId: string | undefined
  activeSection: string
}>) {
  if (!propertyId) {
    return (
      <InertNavItem
        icon={LayoutDashboard}
        label={NAV_LABEL.dashboard}
        tooltip={NAV_LABEL.dashboard}
      />
    )
  }

  return (
    <CategoryNavItem
      icon={LayoutDashboard}
      label={NAV_LABEL.dashboard}
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
