import { Link } from '@tanstack/react-router'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Globe,
  Target,
  Trophy,
} from 'lucide-react'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
} from '#/components/ui/sidebar'
import { InboxVisitBadge } from '#/components/inbox/inbox-visit-badge'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
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
 * carry no capability gate.
 *
 * Disabling here is a UI affordance, not a security boundary — the route gate
 * and every server function still authorize independently (ADR 0049, mirroring
 * the note in `controlled-route-gate.ts`).
 */
const NOT_IN_BETA_TOOLTIP = 'Not available in this beta'

const navItems: ReadonlyArray<{
  capability?: Capability
  key: string
  label: string
  useSearch?: boolean
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

export function ManagerNavItems({ propertyId, activeSection, getLastVisitCount }: Props) {
  const { has } = useCapabilities()

  return (
    <SidebarMenu>
      {navItems.map((item) => {
        const isActive = !!propertyId && activeSection === item.key
        const isUnavailable = item.capability !== undefined && !has(item.capability)

        // Same disabled affordance the no-property case already uses — an
        // eligible-by-role manager sees why the destination is inert instead
        // of navigating into /unavailable.
        if (!propertyId || isUnavailable) {
          return (
            <SidebarMenuItem key={item.key}>
              <SidebarMenuButton
                disabled
                tooltip={isUnavailable ? NOT_IN_BETA_TOOLTIP : item.label}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        }

        return (
          <SidebarMenuItem key={item.key}>
            <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
              <Link
                to={item.to}
                {...(item.useSearch
                  ? { search: { propertyId } }
                  : { params: { propertyId } })}
              >
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
            {item.key === 'reviews' && (
              <SidebarMenuBadge>
                <InboxVisitBadge getLastVisitCount={getLastVisitCount} />
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
