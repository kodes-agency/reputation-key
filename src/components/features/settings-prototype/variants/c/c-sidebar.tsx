// PROTOTYPE — variant C. The app sidebar with Settings expanded in place: the one
// navigation there is on this page. There is no second column and no Settings home.
//
// How it is drawn (the least invasive way for a prototype): the authenticated shell
// asks `usePrototypeShell({ sidebar })` for a page's own sidebar, so the real
// ManagerSidebar is simply not mounted on this route and nothing in it changes. This
// is a replica built from the same `ui/sidebar` primitives and the same rows
// (`LinkNavItem`, the tile's look, the 16 rem width, the icon rail, the phone sheet).
// The shell's `SidebarProvider` is above it, so `useSidebar` and the sheet on a phone
// work as they do for the real one.
//
//   tile            the workspace (static: the chip below is the property switcher)
//   App             the app's main places, collapsed to an icon strip
//   Settings        Business / Property (a chip from two properties), Team, You
//   footer          Add another location, Danger zone (in the scroll, at the bottom when short)
import { Settings } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '#/components/ui/sidebar'
import type { RailGroup, SettingsPrototypeContext } from '../../settings-prototype-types'
import { AppNavGroup, AppNavItems } from './c-app-nav'
import { initialsOf, PropertyChip } from './c-property-chip'
import { GroupLabel, SettingsRow, SetupMeter } from './c-sidebar-rows'

type Props = Readonly<{ ctx: SettingsPrototypeContext }>

function WorkspaceTile({ ctx }: Props) {
  const { name } = ctx.data.workspace
  return (
    <div className="flex h-12 items-center gap-2 rounded-md p-2 group-data-[collapsible=icon]:p-0">
      <div
        aria-hidden="true"
        className="flex aspect-square size-8 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-(--accent)"
      >
        {initialsOf(name)}
      </div>
      <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-semibold">{name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {ctx.data.viewer.role === 'aa' ? 'Account admin' : 'Property manager'}
        </span>
      </div>
    </div>
  )
}

function Rows({
  group,
  ctx,
}: Readonly<{ group: RailGroup; ctx: SettingsPrototypeContext }>) {
  return (
    <SidebarMenu className="gap-0.5">
      {group.rows.map((row) => (
        <SettingsRow key={row.key} row={row} current={row.key === ctx.current.key} />
      ))}
    </SidebarMenu>
  )
}

/** The first group is the property's (or All properties'): a chip from two properties. */
function BusinessHead({
  group,
  ctx,
}: Readonly<{ group: RailGroup; ctx: SettingsPrototypeContext }>) {
  return ctx.shape.showPropertySwitcher ? (
    <div className="px-0 pb-1">
      <PropertyChip ctx={ctx} />
    </div>
  ) : (
    <GroupLabel label={group.label} />
  )
}

function SettingsBlock({ ctx }: Props) {
  const groups = ctx.rail.groups.filter((group) => group.key !== 'footer')
  const footer = ctx.rail.groups.find((group) => group.key === 'footer')
  return (
    <div role="group" aria-label="Settings sections" className="flex flex-1 flex-col">
      <div className="flex h-8 items-center gap-2 px-4 text-sm font-semibold">
        <Settings aria-hidden="true" className="size-4 text-(--accent)" />
        Settings
      </div>
      {groups.map((group, index) => (
        <SidebarGroup key={group.key} className="py-1">
          {index === 0 ? (
            <BusinessHead group={group} ctx={ctx} />
          ) : (
            <GroupLabel label={group.label} />
          )}
          <SidebarGroupContent>
            {index === 0 ? <SetupMeter setup={ctx.rail.setup} /> : null}
            <Rows group={group} ctx={ctx} />
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
      {footer === undefined ? null : (
        <SidebarGroup className="mt-auto border-t border-sidebar-border">
          <Rows group={footer} ctx={ctx} />
        </SidebarGroup>
      )}
    </div>
  )
}

/** The icon rail: the app's places, and Settings as a button that opens the sidebar. */
function CollapsedRail({ ctx }: Props) {
  const { toggleSidebar } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarMenu>
        <AppNavItems ctx={ctx} />
        <SidebarMenuItem>
          <SidebarMenuButton isActive tooltip="Settings sections" onClick={toggleSidebar}>
            <Settings />
            <span>Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

export function InAppSidebar({ ctx }: Props) {
  const { state, isMobile } = useSidebar()
  const isRail = state === 'collapsed' && !isMobile
  return (
    <Sidebar>
      <nav aria-label="Primary navigation" className="flex h-full w-full flex-col">
        <SidebarHeader>
          <WorkspaceTile ctx={ctx} />
        </SidebarHeader>
        {/* max-md:pb-14 clears the prototype switcher bar, which floats over the sheet. */}
        <SidebarContent className="gap-0 max-md:pb-14">
          {isRail ? (
            <CollapsedRail ctx={ctx} />
          ) : (
            <>
              <AppNavGroup ctx={ctx} />
              <SettingsBlock ctx={ctx} />
            </>
          )}
        </SidebarContent>
        <SidebarRail />
      </nav>
    </Sidebar>
  )
}
