// PROTOTYPE — variant C. The app's own navigation, kept above the Settings block so
// it is never lost. It is a collapsed group: a strip of the five main places as
// icons, and a chevron that opens them as labelled rows. The real manager sidebar
// is not mounted here (see c-sidebar.tsx), so this is the same rows through the
// same LinkNavItem: Dashboard, Reviews, Staff, Portals, Goals.
//
// A fixture property has no real page, so its rows open the lists; the live
// property (`?props=real`) opens its own pages.
import { useState } from 'react'
import {
  ChevronDown,
  Globe,
  LayoutDashboard,
  MessageSquare,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { LinkNavItem, type NavLinkTarget } from '#/components/layout/nav-items-shared'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { IconButton } from '#/components/ui/icon-button'
import { NavLink } from '#/components/ui/nav-link'
import { SidebarGroup, SidebarMenu, useSidebar } from '#/components/ui/sidebar'
import type { SettingsPrototypeContext } from '../../settings-prototype-types'

type AppItem = Readonly<{
  key: string
  label: string
  icon: LucideIcon
  link: NavLinkTarget
}>

export function appItemsFor(ctx: SettingsPrototypeContext): readonly AppItem[] {
  const id = ctx.property?.isReal === true ? ctx.property.id : undefined
  const scoped = (path: string, fallback: string): NavLinkTarget =>
    id === undefined
      ? { to: fallback }
      : { to: `/properties/$propertyId${path}`, params: { propertyId: id } }
  return [
    {
      key: 'dashboard',
      label: NAV_LABEL.dashboard,
      icon: LayoutDashboard,
      link: scoped('', '/properties'),
    },
    {
      key: 'reviews',
      label: NAV_LABEL.reviews,
      icon: MessageSquare,
      link: { to: '/inbox' },
    },
    {
      key: 'staff',
      label: NAV_LABEL.staff,
      icon: Users,
      link: scoped('/people', '/properties'),
    },
    {
      key: 'portals',
      label: NAV_LABEL.portals,
      icon: Globe,
      link: scoped('/portals', '/portals'),
    },
    {
      key: 'goals',
      label: NAV_LABEL.goals,
      icon: Target,
      link: scoped('/goals', '/properties'),
    },
  ]
}

/** The items of the app nav, as the sidebar draws them when it is the whole nav. */
export function AppNavItems({ ctx }: Readonly<{ ctx: SettingsPrototypeContext }>) {
  return (
    <>
      {appItemsFor(ctx).map((item) => (
        <LinkNavItem
          key={item.key}
          icon={item.icon}
          label={item.label}
          isActive={false}
          link={item.link}
        />
      ))}
    </>
  )
}

export function AppNavGroup({ ctx }: Readonly<{ ctx: SettingsPrototypeContext }>) {
  const [open, setOpen] = useState(false)
  // A sheet opens with focus on its first control, and a tooltip on a phone is noise.
  const { isMobile } = useSidebar()
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarGroup className="pt-1 pb-0">
        {/* Closed: the five places as icons and the chevron on one row. Open: "App" and the rows. */}
        <div className="flex items-center justify-between gap-1">
          {open ? (
            <span className="px-2 text-xs font-medium text-sidebar-foreground/70">
              App
            </span>
          ) : (
            <ul className="flex gap-0 md:gap-0.5">
              {appItemsFor(ctx).map((item) => (
                <li key={item.key}>
                  <IconButton
                    asChild
                    label={item.label}
                    size="icon-sm"
                    tooltip={!isMobile}
                    className="text-(--accent) hover:bg-sidebar-accent"
                  >
                    <NavLink {...item.link} current={false}>
                      <item.icon />
                    </NavLink>
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <CollapsibleTrigger asChild>
            <IconButton
              label={open ? 'Hide the app menu' : 'Show the app menu'}
              size="icon-sm"
              tooltip={false}
              className="group/app-nav shrink-0 hover:bg-sidebar-accent"
            >
              <ChevronDown
                aria-hidden="true"
                className="transition-transform duration-200 group-data-[state=open]/app-nav:rotate-180"
              />
            </IconButton>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <SidebarMenu className="gap-0.5">
            <AppNavItems ctx={ctx} />
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
