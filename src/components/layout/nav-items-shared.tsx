// Sidebar nav row markup used by ManagerNavItems.
//
// The manager nav renders two row shapes over its descriptor list: a live row
// that links to the destination, and an inert row that keeps the icon and label
// but cannot be clicked.
//
// A row goes inert when the destination route's own capability gate
// (`gateControlledRoute` in its `beforeLoad`) would bounce the user to
// `/unavailable`, so the nav never offers a dead link. Disabling here is a UI
// affordance, not a security boundary — the route gate and every server
// function still authorize independently (ADR 0049, mirroring the note in
// `controlled-route-gate.ts`).
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '#/components/ui/sidebar'

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

/**
 * A nav entry that owns sub-pages — the shadcn `NavMain` composition
 * (`Collapsible` + `SidebarMenuSub`), with two deliberate differences.
 *
 * First, the parent is a link to its own landing page and a separate
 * `SidebarMenuAction` chevron toggles the sub-list. The docs' demo makes the
 * parent a pure toggle, but this sidebar is `collapsible="icon"` and
 * `SidebarMenuSub` hides itself in icon mode, so a toggle-only parent would do
 * nothing visible there. A link still works, and the one-click habit survives.
 *
 * Second, `Collapsible` renders `asChild` so its root merges into the
 * `<li>` rather than wrapping it in a `<div>`: `<ul>` may only contain `<li>`,
 * and the demo's nesting fails axe's `list`/`listitem` rules.
 */
export function CategoryNavItem({
  icon: Icon,
  label,
  isActive,
  link,
  children,
}: Readonly<{
  icon: LucideIcon
  label: string
  /** True anywhere inside the category — drives both the parent's active state
   *  and whether the sub-list starts open. */
  isActive: boolean
  link: NavLinkTarget
  children: ReactNode
}>) {
  return (
    <Collapsible asChild defaultOpen={isActive} className="group/collapsible">
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
          <Link {...link}>
            <Icon />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <SidebarMenuAction aria-label={`Toggle ${label} pages`}>
            <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>{children}</SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

export function CategoryNavSubItem({
  label,
  isActive,
  link,
}: Readonly<{ label: string; isActive: boolean; link: NavLinkTarget }>) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={isActive}>
        <Link {...link}>
          <span>{label}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}
