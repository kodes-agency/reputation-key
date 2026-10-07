// PROTOTYPE — All properties > Overview. From 2 properties it is a short table of what
// each one still needs; from 10 (AccountAdmin) it becomes the filterable matrix.
import { Button } from '#/components/ui/button'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { hrefOf } from '../settings-prototype-model'
import { SettingsPrototypeLink } from '../settings-prototype-nav'
import { propertiesNeedingSetup } from '../settings-prototype-status'
import { MatrixOverview } from './prototype-matrix-section'
import { OVERVIEW_COLUMNS, overviewCells } from './prototype-overview-cells'
import type { SectionProps } from './prototype-section-kit'

export function OverviewSection({ ctx }: SectionProps) {
  return ctx.shape.showMatrix ? <MatrixOverview ctx={ctx} /> : <OverviewTable ctx={ctx} />
}

/** "5 properties, 2 need setup" and the way to the next one that does. */
export function OverviewSummary({ ctx }: SectionProps) {
  const needing = propertiesNeedingSetup(ctx.data).length
  const next = ctx.rail.switcher?.nextToFinishHref ?? null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {ctx.data.properties.length} properties, {needing} need setup
      </p>
      {next !== null && needing > 0 ? (
        <Button asChild size="sm">
          <SettingsPrototypeLink href={next}>Next needing setup</SettingsPrototypeLink>
        </Button>
      ) : null}
    </div>
  )
}

function OverviewTable({ ctx }: SectionProps) {
  return (
    <div className="space-y-4">
      <OverviewSummary ctx={ctx} />
      <DataTable label="Properties" layout="scroll">
        <DataTableHeader>
          <DataTableHead>Property</DataTableHead>
          {OVERVIEW_COLUMNS.map((column) => (
            <DataTableHead key={column}>{column}</DataTableHead>
          ))}
        </DataTableHeader>
        <DataTableBody>
          {ctx.data.properties.map((p) => (
            <DataTableRow key={p.id}>
              <DataTableCell className="font-medium">
                <SettingsPrototypeLink
                  href={hrefOf(ctx.shape, 'details', 'property', p.id)}
                  className="text-link hover:underline"
                >
                  {p.name}
                </SettingsPrototypeLink>
              </DataTableCell>
              {overviewCells(p, ctx.data, ctx.state.role).map((cell, i) => (
                <DataTableCell key={OVERVIEW_COLUMNS[i]}>{cell}</DataTableCell>
              ))}
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </div>
  )
}
