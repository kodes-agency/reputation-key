// PROTOTYPE — the "All properties" block that sits above one property's tiles for an
// AccountAdmin with 2+ properties. Up to ten properties it is the overview table itself
// (a compact list on a phone); beyond that the matrix is too long for a home page, so the
// block is the headline counts and the next few properties to finish, and the matrix is
// one tile away. The default response targets are a tile either way.
import { Badge } from '#/components/ui/badge'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { SectionTitle } from '#/components/ui/section-title'
import { hrefOf } from '../../settings-prototype-model'
import { SECTION_OF_STEP, propertiesNeedingSetup } from '../../settings-prototype-status'
import { setupProgressOf } from '../../settings-prototype-fixtures'
import {
  OverviewSection,
  OverviewSummary,
} from '../../sections/prototype-overview-section'
import type {
  PropertyFixture,
  RailRow,
  SettingsPrototypeContext,
} from '../../settings-prototype-types'
import { BLink } from './b-links'
import {
  STEP_SENTENCE,
  allRowsOf,
  nextStepOf,
  targetOf,
  type SettingsHome,
} from './b-model'
import { GROUP_TITLE, TileGrid, type TileRow } from './b-tiles'

const TITLE_ID = 'settings-home-all'

/** "Followed by 3 of 5": the default response targets are the tile's one number. */
function targetsTile(
  row: RailRow,
  all: SettingsPrototypeContext,
  home: SettingsHome,
): TileRow {
  const total = all.data.allProperties.length
  const followers = all.data.allProperties.filter(
    (p) => p.targets.mode === 'default',
  ).length
  return {
    row,
    target: targetOf(row, home, all),
    label: 'Default response targets',
    statusText: `Followed by ${followers} of ${total}`,
  }
}

function tilesOf(all: SettingsPrototypeContext, home: SettingsHome): readonly TileRow[] {
  const rows = allRowsOf(all)
  const showOverview = all.shape.showMatrix
  return rows.flatMap((row): TileRow[] => {
    if (row.key === 'default-targets') return [targetsTile(row, all, home)]
    return showOverview && row.key === 'overview'
      ? [{ row, target: targetOf(row, home, all), label: 'Overview matrix' }]
      : []
  })
}

function SetupBadge({
  p,
  all,
}: Readonly<{ p: PropertyFixture; all: SettingsPrototypeContext }>) {
  const progress = setupProgressOf(p, all.data.viewer.role)
  return (
    <Badge variant={progress.nextStep === null ? 'positive' : 'warn'}>
      {progress.done}/{progress.total}
    </Badge>
  )
}

const ROW_LINK =
  'flex items-center justify-between gap-3 px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted/40 focus-ring max-md:min-h-14'

/** A phone's overview: one row per property, its setup count at the end. */
function CompactProperties({ all }: Readonly<{ all: SettingsPrototypeContext }>) {
  return (
    <div className="space-y-3 md:hidden">
      <OverviewSummary ctx={all} />
      <ul className="m-0 list-none divide-y overflow-hidden rounded-xl border bg-card p-0">
        {all.data.properties.map((p) => (
          <li key={p.id}>
            <BLink
              go={hrefOf(all.shape, 'details', 'property', p.id)}
              className={ROW_LINK}
            >
              <span className="min-w-0 truncate font-medium">{p.name}</span>
              <SetupBadge p={p} all={all} />
            </BLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The headline counts a person with sixty properties wants before any table. */
function CountsStrip({ all }: Readonly<{ all: SettingsPrototypeContext }>) {
  const list = all.data.properties
  const count = (test: (p: PropertyFixture) => boolean) => list.filter(test).length
  const cells = [
    { label: 'Need setup', value: propertiesNeedingSetup(all.data).length },
    { label: 'Google not linked', value: count((p) => p.google.state !== 'linked') },
    { label: 'AI undecided', value: count((p) => p.ai === 'undecided') },
    { label: 'Custom targets', value: count((p) => p.targets.mode === 'custom') },
  ]
  return (
    <MetricStrip aria-label="Properties at a glance" variant="tiles" columns={4}>
      {cells.map((cell) => (
        <Metric key={cell.label} label={cell.label}>
          <MetricValue value={cell.value} detail={`of ${list.length}`} />
        </Metric>
      ))}
    </MetricStrip>
  )
}

const WORKLIST_SIZE = 4

/** The next few properties to finish, each with the step it is waiting on. */
function Worklist({ all }: Readonly<{ all: SettingsPrototypeContext }>) {
  const waiting = propertiesNeedingSetup(all.data).slice(0, WORKLIST_SIZE)
  if (waiting.length === 0) return null
  return (
    <div className="space-y-2">
      <SectionTitle level={3} className="px-1 text-muted-foreground">
        Next to finish
      </SectionTitle>
      <ul className="m-0 list-none divide-y overflow-hidden rounded-xl border bg-card p-0">
        {waiting.map((p) => {
          const step = nextStepOf(p, all)
          if (step === null) return null
          return (
            <li key={p.id}>
              <BLink
                go={hrefOf(all.shape, SECTION_OF_STEP[step], 'property', p.id)}
                className={ROW_LINK}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-muted-foreground">
                    Next: {STEP_SENTENCE[step]}
                  </span>
                </span>
                <SetupBadge p={p} all={all} />
              </BLink>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AllPropertiesBlock({
  all,
  home,
}: Readonly<{ all: SettingsPrototypeContext; home: SettingsHome }>) {
  const many = all.shape.showMatrix
  return (
    <section aria-labelledby={TITLE_ID} className="space-y-4">
      <SectionTitle id={TITLE_ID} className={GROUP_TITLE}>
        All properties
      </SectionTitle>
      {many ? (
        <div className="space-y-4">
          <OverviewSummary ctx={all} />
          <CountsStrip all={all} />
          <Worklist all={all} />
        </div>
      ) : (
        <>
          <div className="max-md:hidden">
            <OverviewSection ctx={all} />
          </div>
          <CompactProperties all={all} />
        </>
      )}
      <TileGrid tiles={tilesOf(all, home)} />
    </section>
  )
}
