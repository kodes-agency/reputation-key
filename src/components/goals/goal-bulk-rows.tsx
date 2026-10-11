// Set goals for several portals — the rows. One per Portal and per Portal
// Group: its name, one number, and what the goals already set or the last save
// say about it. A row whose subject has a goal for the measure takes no number;
// it shows that goal's target and links to the goal.
//
// The number is the shared number field. Its label names the row for a screen
// reader ("Monthly target for Lobby QR") and is never drawn: from the width the
// table has a header, the header shows the column; below it, where the rows
// stack and the header is gone, a caption does. The label itself cannot be the
// one that hides from a width: a field gives its children the full width, which
// outranks a `@4xl:sr-only` width of 1px and would scroll the table sideways.
import { Link } from '@tanstack/react-router'
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import { FormNumberField } from '#/components/forms/form-number-field'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { ROW_FIGURE_LINK } from '#/components/ui/row-link'
import { StatusBadge } from '#/components/ui/status-badge'
import { cn } from '#/lib/utils'
import { goalFigure } from './goal-so-far'
import type { GoalBulkRow } from './goal-bulk-view'

/** The column's name: in the header from the table's width (`4xl`), in a caption below it. */
const TARGET = 'Monthly target'

/** The id of a row's number: the subject key, with nothing a selector must escape. */
const fieldIdOf = (row: GoalBulkRow): string => `goal-target-${row.key.replace(':', '-')}`

type Props = Readonly<{
  propertyId: string
  metric: GoalMetric
  rows: readonly GoalBulkRow[]
  /** The number typed on each open row, by subject key; none or `NaN` is empty. */
  targets: Readonly<Record<string, number>>
  onTargetChange: (key: string, value: number) => void
  /** Hands over each row's element, so the focus can go to a row after a save. */
  rowRef: (key: string, element: HTMLElement | null) => void
}>

function TargetCell({
  row,
  metric,
  value,
  onChange,
}: Readonly<{
  row: GoalBulkRow
  metric: GoalMetric
  value: number
  onChange: (value: number) => void
}>) {
  if (row.goal !== null) {
    return (
      <>
        <p className="text-xs text-muted-foreground @4xl:hidden">{TARGET}</p>
        <p className="tabular-nums">{goalFigure(metric, row.goal.targetValue)}</p>
      </>
    )
  }
  const average = metric === 'portal_rating_average'
  return (
    <>
      {/* The label below already names the field; this is the same words for the eye. */}
      <p aria-hidden="true" className="mb-1.5 text-xs text-muted-foreground @4xl:hidden">
        {TARGET}
      </p>
      <FormNumberField
        id={fieldIdOf(row)}
        label={`${TARGET} for ${row.name}`}
        labelClassName="sr-only"
        className="max-w-40"
        min={1}
        max={average ? 5 : undefined}
        step={average ? 0.1 : undefined}
        field={{
          state: {
            value,
            meta: { errors: row.fault === null ? [] : [{ message: row.fault }] },
          },
          handleBlur: () => undefined,
          handleChange: onChange,
        }}
      />
    </>
  )
}

function StatusCell({
  row,
  propertyId,
}: Readonly<{ row: GoalBulkRow; propertyId: string }>) {
  return (
    <>
      {row.status === null ? null : (
        <StatusBadge tone={row.status.tone} label={row.status.label} />
      )}
      {row.note === null ? null : (
        <p className="mt-1.5 text-sm text-muted-foreground">{row.note}</p>
      )}
      {row.goal === null ? null : (
        <p className="mt-1.5 text-sm">
          <Link
            to="/properties/$propertyId/goals/$goalId"
            params={{ propertyId, goalId: row.goal.id }}
            className={cn(ROW_FIGURE_LINK, 'underline')}
          >
            {row.goal.name ?? 'View goal'}
          </Link>
        </p>
      )}
    </>
  )
}

export function GoalBulkRows({
  propertyId,
  metric,
  rows,
  targets,
  onTargetChange,
  rowRef,
}: Props) {
  return (
    <DataTable label="Portals and portal groups">
      <DataTableHeader>
        <DataTableHead>Portal or group</DataTableHead>
        <DataTableHead className="w-48">{TARGET}</DataTableHead>
        <DataTableHead className="w-80">Status</DataTableHead>
      </DataTableHeader>
      <DataTableBody>
        {rows.map((row) => (
          <DataTableRow key={row.key} ref={(element) => rowRef(row.key, element)}>
            <DataTableCell className="col-span-2 min-w-0 whitespace-normal">
              <p className="font-medium">{row.name}</p>
              <p className="text-xs text-muted-foreground">{row.kind}</p>
            </DataTableCell>
            <DataTableCell className="col-span-2 whitespace-normal">
              <TargetCell
                row={row}
                metric={metric}
                value={targets[row.key] ?? Number.NaN}
                onChange={(value) => onTargetChange(row.key, value)}
              />
            </DataTableCell>
            <DataTableCell className="col-span-2 whitespace-normal">
              <StatusCell row={row} propertyId={propertyId} />
            </DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  )
}
