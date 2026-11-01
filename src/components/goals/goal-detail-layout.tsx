// The page every goal's detail is laid out in (ADR 0068, amended 2026-10-19: one
// goal design system): a column of blocks, where a goal stands in a card of its
// own, and the tiles that read "so far" in a strip of three. A goal's page brings its blocks in the order
// it wants them: the layout is the column and the gap, not a fixed order, so the
// order is decided where the page is written. The tiles arrive finished; the
// strip only lays them out: stacked until there is room for all three, never two
// and one.
import type { ReactNode } from 'react'
import { Card, CardContent } from '#/components/ui/card'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { SectionTitle } from '#/components/ui/section-title'

type LayoutProps = Readonly<{
  /** The page's `data-slot`. */
  slot: string
  children: ReactNode
}>

export function GoalDetailLayout({ slot, children }: LayoutProps) {
  return (
    // Its own container: a check-in band and a chart lay out against the page, not the screen.
    <div data-slot={slot} className="@container flex flex-col gap-4">
      {children}
    </div>
  )
}

/** Where the goal stands, first on its page: what is left, the lines under it and the ruler. */
export function GoalWhere({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Card data-slot="goal-where">
      <CardContent className="flex flex-col gap-1.5">{children}</CardContent>
    </Card>
  )
}

/** One tile: what is measured, its figure (none prints the detail alone), and a line of context. */
type GoalTile = Readonly<{
  key: string
  label: string
  value: string | null
  detail: string | null
}>

type TilesProps = Readonly<{
  /** The section's title, an h2. */
  title: string
  /** The title's id: the section is named by it. */
  headingId: string
  /** Names the strip of numbers for a screen reader. */
  label: string
  tiles: readonly GoalTile[]
}>

/** A titled strip of tiles; none to show draws nothing, not an empty section. */
export function GoalTiles({ title, headingId, label, tiles }: TilesProps) {
  if (tiles.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionTitle id={headingId}>{title}</SectionTitle>
      <MetricStrip
        aria-label={label}
        variant="tiles"
        columns={3}
        className="@max-2xl:grid-cols-1"
      >
        {tiles.map((tile) => (
          <Metric key={tile.key} label={tile.label}>
            <MetricValue value={tile.value} detail={tile.detail} />
          </Metric>
        ))}
      </MetricStrip>
    </section>
  )
}
