// PROTOTYPE — the tile grid. Each tile is icon, label and one status line in its tone;
// the whole tile is the link. From a 28rem container the tiles are cards in a grid
// (two, three, four across as the container grows); narrower, they are the rows of one
// grouped list with hairlines between them, the way a phone's settings read.
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { SectionTitle } from '#/components/ui/section-title'
import { cn } from '#/lib/utils'
import type { RailRow } from '../../settings-prototype-types'
import { BLink } from './b-links'
import { SECTION_ICON } from './b-icons'
import { labelOf, type BTarget } from './b-model'
import { ROW_TONE, ToneLine } from './b-tone'

const TILE =
  'relative flex w-full items-center gap-3 bg-card px-4 py-3 text-left text-card-foreground transition-colors hover:bg-muted/40 focus-ring max-md:min-h-14 ' +
  '@md:min-h-32 @md:flex-col @md:items-stretch @md:justify-between @md:gap-5 @md:rounded-xl @md:border @md:p-4 @md:shadow-xs'

export type TileRow = Readonly<{
  row: RailRow
  target: BTarget
  /** Overrides the row's own words, for a tile that stands for something else. */
  label?: string
  statusText?: string
}>

export function SettingTile({ row, target, label, statusText }: TileRow) {
  const look = ROW_TONE[row.tone]
  const Icon = SECTION_ICON[row.key]
  const Arrow = row.isLinkOut ? ArrowUpRight : ChevronRight
  return (
    <BLink
      go={target}
      className={cn(TILE, row.tone === 'needs' && '@md:border-warn-line')}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          look.disc,
        )}
      >
        <Icon className="size-[1.125rem]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-none">
        <span className="truncate font-medium">{label ?? labelOf(row)}</span>
        <ToneLine tone={row.tone} text={statusText ?? row.statusText} />
      </span>
      <Arrow
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground @md:absolute @md:top-4 @md:right-4"
      />
    </BLink>
  )
}

const GRID =
  'm-0 grid list-none grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border p-0 ' +
  '@md:grid-cols-2 @md:gap-3 @md:overflow-visible @md:rounded-none @md:border-0 @md:bg-transparent @2xl:grid-cols-3 @4xl:grid-cols-4'

/** The grid alone, for a block that draws its own heading. */
export function TileGrid({ tiles }: Readonly<{ tiles: readonly TileRow[] }>) {
  if (tiles.length === 0) return null
  return (
    <div className="@container">
      <ul className={GRID}>
        {tiles.map((tile) => (
          <li key={tile.row.key} className="flex">
            <SettingTile {...tile} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export const GROUP_TITLE =
  'px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

/** A named set of tiles: Business, Team, You. */
export function TileGroup({
  id,
  label,
  tiles,
}: Readonly<{ id: string; label: string; tiles: readonly TileRow[] }>) {
  if (tiles.length === 0) return null
  return (
    <section aria-labelledby={id} className="space-y-2.5">
      <SectionTitle id={id} className={GROUP_TITLE}>
        {label}
      </SectionTitle>
      <TileGrid tiles={tiles} />
    </section>
  )
}
