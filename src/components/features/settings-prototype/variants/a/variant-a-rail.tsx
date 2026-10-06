// PROTOTYPE — variant A. The 288 px settings rail, built like the Portal editor's: a
// head (the business, or the property chip from two properties; the setup meter),
// the groups with their status lines in a column that scrolls on its own, and the
// footer (+ Add another location, Danger zone) pinned under it. Below `lg` it is the
// Settings index: the same rows, full width, the footer at the end of the list.
import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { BackLink } from '#/components/ui/back-link'
import { cn } from '#/lib/utils'
import { SettingsPrototypeLink } from '../../settings-prototype-nav'
import { SECTION_LABEL } from '../../settings-prototype-shape'
import type {
  RailGroup,
  SettingsPrototypeContext,
  SettingsRail,
} from '../../settings-prototype-types'
import { RailRowLink } from './variant-a-rail-row'
import { IdentityTile, PropertyChip } from './variant-a-switcher'

type Setup = NonNullable<SettingsRail['setup']>

/** "Setup 5 of 7", one segment per step, and the way to the next unfinished one. */
function SetupMeter({ setup }: Readonly<{ setup: Setup }>) {
  const next = setup.nextKey === null ? null : SECTION_LABEL[setup.nextKey]
  return (
    <div className="space-y-2 rounded-lg bg-muted/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">
          Setup {setup.done} of {setup.total}
        </span>
        {setup.nextHref === null ? null : (
          <SettingsPrototypeLink
            href={setup.nextHref}
            aria-label={`Next step: ${next ?? 'continue'}`}
            className="focus-ring -my-1 inline-flex items-center gap-0.5 rounded px-1 py-1 font-medium text-link hover:underline"
          >
            Next
            <ChevronRight className="size-3.5" aria-hidden />
          </SettingsPrototypeLink>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={setup.total}
        aria-valuenow={setup.done}
        className="flex gap-1"
      >
        {Array.from({ length: setup.total }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              i < setup.done ? 'bg-primary' : 'bg-border',
            )}
          />
        ))}
      </div>
    </div>
  )
}

function RailHead({
  ctx,
  isIndex,
}: Readonly<{ ctx: SettingsPrototypeContext; isIndex: boolean }>) {
  const { rail, property, data } = ctx
  const switcher = rail.switcher
  return (
    <div className="space-y-3 px-3 pt-4 pb-4 max-lg:mx-auto max-lg:w-full max-lg:max-w-xl max-lg:px-4">
      <div className="flex items-center justify-between gap-2 max-lg:flex-col-reverse max-lg:items-start max-lg:gap-1">
        <h1 className="text-base font-semibold tracking-tight max-lg:text-xl">
          Settings
        </h1>
        <BackLink
          to="/properties"
          label="Back to app"
          flush
          className="lg:-mr-2 lg:ml-0"
        />
      </div>
      {switcher === null ? (
        <div className="flex items-center gap-3 px-1">
          <IdentityTile name={property?.name ?? null} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{property?.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {property === null ? '' : `${property.city}, ${property.country}`}
            </span>
          </span>
        </div>
      ) : (
        <PropertyChip
          switcher={switcher}
          title={property?.name ?? 'All properties'}
          subtitle={
            property === null
              ? `${data.properties.length} properties`
              : `${property.city}, ${property.country}`
          }
          tileName={property?.name ?? null}
          keepSection={!isIndex}
        />
      )}
      {rail.setup === null || rail.setup.isComplete ? null : (
        <SetupMeter setup={rail.setup} />
      )}
    </div>
  )
}

function Group({
  group,
  currentKey,
}: Readonly<{ group: RailGroup; currentKey: string }>) {
  const headingId = useId()
  return (
    <div>
      {group.label === '' ? null : (
        <p id={headingId} className="px-3 pb-1 text-xs font-medium text-muted-foreground">
          {group.label}
        </p>
      )}
      <ul
        {...(group.label === ''
          ? { 'aria-label': 'More' }
          : { 'aria-labelledby': headingId })}
        className="flex flex-col gap-1"
      >
        {group.rows.map((row) => (
          <li key={row.key}>
            <RailRowLink row={row} current={row.key === currentKey} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function VariantARail({
  ctx,
  isIndex,
}: Readonly<{
  ctx: SettingsPrototypeContext
  /** A phone's Settings index: no section is open, so no row is current and a property switch stays on the index. */
  isIndex: boolean
}>) {
  const footer = ctx.rail.groups.find((group) => group.key === 'footer')
  const body = ctx.rail.groups.filter((group) => group.key !== 'footer')
  const currentKey = isIndex ? '' : ctx.current.key
  const nav = useRef<HTMLElement>(null)
  // The rail scrolls on its own: bring the open row into view, the rail's only (a
  // row far down the list is otherwise out of sight on a short screen).
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current=page]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [currentKey, ctx.state.propertyId, ctx.state.scope])
  return (
    <aside
      aria-label="Settings"
      className="flex min-h-0 flex-col bg-background max-lg:flex-1 max-lg:overflow-y-auto lg:w-72 lg:shrink-0 lg:border-r"
    >
      <RailHead ctx={ctx} isIndex={isIndex} />
      <nav
        ref={nav}
        aria-label="Settings sections"
        className="flex flex-col gap-5 px-3 max-lg:mx-auto max-lg:w-full max-lg:max-w-xl max-lg:px-4 max-lg:pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
      >
        {body.map((group) => (
          <Group key={group.key} group={group} currentKey={currentKey} />
        ))}
        {/* Fades the rows that continue below the edge; blank space once scrolled to the end. */}
        <div
          aria-hidden
          className="pointer-events-none sticky bottom-0 -mt-5 h-8 shrink-0 bg-linear-to-t from-background to-transparent max-lg:hidden"
        />
      </nav>
      {footer === undefined ? null : (
        <nav
          aria-label="More settings"
          className="border-t px-3 py-3 max-lg:mx-auto max-lg:w-full max-lg:max-w-xl max-lg:px-4 max-lg:pb-24"
        >
          <Group group={footer} currentKey={currentKey} />
        </nav>
      )}
    </aside>
  )
}
