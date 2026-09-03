// Sidebar nav row markup shared by StaffNavItems and ManagerNavItems.
//
// Both navs render the same two row shapes over their own descriptor list: a
// live row that links to the destination, and an inert row that keeps the icon
// and label but cannot be clicked.
//
// A row goes inert when the destination route's own capability gate
// (`gateControlledRoute` in its `beforeLoad`) would bounce the user to
// `/unavailable`, so the nav never offers a dead link. Disabling here is a UI
// affordance, not a security boundary — the route gate and every server
// function still authorize independently (ADR 0049, mirroring the note in
// `controlled-route-gate.ts`).
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { SidebarMenuButton, SidebarMenuItem } from '#/components/ui/sidebar'

/** Destination of a live row: path plus whichever of params/search it needs. */
export type NavLinkTarget = Readonly<{
  to: string
  params?: Readonly<Record<string, string>>
  search?: Readonly<Record<string, string>>
}>

export function InertNavItem({
  icon: Icon,
  label,
  tooltip,
}: Readonly<{ icon: LucideIcon; label: string; tooltip: string }>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton disabled tooltip={tooltip}>
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function LinkNavItem({
  icon: Icon,
  label,
  isActive,
  link,
  badge,
}: Readonly<{
  icon: LucideIcon
  label: string
  isActive: boolean
  link: NavLinkTarget
  /** Optional trailing slot (counts, alerts); omitted renders nothing. */
  badge?: ReactNode
}>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link {...link}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {badge}
    </SidebarMenuItem>
  )
}
