// PROTOTYPE — the Settings home: the page the sidebar's Settings entry lands on. Header,
// then (2+ properties) the property switcher and the all-properties block, then one
// property's identity and setup meter, and its tiles grouped Business / Team / You.
import { Lock } from 'lucide-react'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { Button } from '#/components/ui/button'
import type { RailGroup, SettingsPrototypeContext } from '../../settings-prototype-types'
import { AllPropertiesBlock } from './b-all-properties'
import { HeaderRow } from './b-header-row'
import { IdentityBand } from './b-identity'
import { SECTION_ICON } from './b-icons'
import { BLink } from './b-links'
import { targetOf, type SettingsHome } from './b-model'
import { PropertySwitcher } from './b-property-switcher'
import { TileGroup, type TileRow } from './b-tiles'

function descriptionOf(ctx: SettingsPrototypeContext): string {
  if (ctx.shape.role === 'pm') {
    const what = ctx.shape.showPropertySwitcher ? 'your properties' : 'your business'
    return `The settings for ${what}. Locked ones are managed by ${ctx.data.workspace.adminName}.`
  }
  return ctx.shape.showPropertySwitcher
    ? 'Work across all your properties, or choose one to change its settings.'
    : 'Your business, your team and your own preferences, in one place.'
}

function tilesOf(group: RailGroup, home: SettingsHome): readonly TileRow[] {
  return group.rows.map((row) => ({ row, target: targetOf(row, home, home.ctx) }))
}

/** Add another location and the danger zone: reachable, and out of the way. */
function FooterLinks({
  group,
  home,
}: Readonly<{ group: RailGroup | undefined; home: SettingsHome }>) {
  if (group === undefined) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-5">
      {group.rows.map((row) => {
        const Icon = SECTION_ICON[row.key]
        return (
          <Button
            key={row.key}
            asChild
            variant="outline"
            size="sm"
            className={row.key === 'danger' ? '[&_svg]:text-negative' : undefined}
          >
            <BLink go={targetOf(row, home, home.ctx)}>
              <Icon aria-hidden />
              {row.label}
            </BLink>
          </Button>
        )
      })}
    </div>
  )
}

export function SettingsHomePage({ home }: Readonly<{ home: SettingsHome }>) {
  const { ctx, property, all } = home
  const tileGroups = ctx.rail.groups.filter((group) => group.key !== 'footer')
  const footer = ctx.rail.groups.find((group) => group.key === 'footer')
  const hasLock = ctx.rows.some((row) => row.locked)
  return (
    <PageShell className="pb-20">
      <HeaderRow
        header={<PageHeader title="Settings" description={descriptionOf(ctx)} />}
        controls={
          ctx.shape.showPropertySwitcher && property !== null ? (
            <PropertySwitcher ctx={ctx} property={property} />
          ) : null
        }
      />
      {all === null ? null : <AllPropertiesBlock all={all} home={home} />}
      <IdentityBand ctx={ctx} property={property} />
      {tileGroups.map((group) => (
        <TileGroup
          key={group.key}
          id={`settings-home-${group.key}`}
          label={group.label}
          tiles={tilesOf(group, home)}
        />
      ))}
      {hasLock ? (
        <p className="flex items-center gap-1.5 px-1 text-sm text-muted-foreground">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          Tiles with a lock are read only for managers. Ask {
            ctx.data.workspace.adminName
          }{' '}
          to change them.
        </p>
      ) : null}
      <FooterLinks group={footer} home={home} />
    </PageShell>
  )
}
