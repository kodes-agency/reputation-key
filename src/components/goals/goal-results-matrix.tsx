import { useId, type ReactNode } from 'react'
import type {
  GoalResultsMatrix as GoalResultsMatrixModel,
  GoalResultsMatrixEvidence,
  GoalResultsMatrixRow,
} from '#/contexts/reporting/application/public-api'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { AvailabilityLine } from '#/components/features/dashboard/availability-line'
import { formatDate, formatMonthYear, formatNumber, formatShortDate } from '#/lib/format'
import { cn } from '#/lib/utils'
import { goalMetricLabel } from './goal-metric-label'
import { goalTargetMarkerLine } from './goal-target-marker'

type Props = Readonly<{
  matrix: GoalResultsMatrixModel
  /** The instant the page was opened, which decides whether a day prints its year. */
  now: Date
  /** Who changed a month's target, by name; null where the directory cannot say. */
  personName: (userId: string) => string | null
}>

/**
 * Each month's result of the Portal goals, newest month first, on their own
 * page (`/goals/portal-results`), which draws it only once a goal has a month.
 */
export function GoalResultsMatrix({ matrix, now, personName }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Monthly results</CardTitle>
        <p className="text-sm text-muted-foreground">
          Each month’s result for your portal goals.
        </p>
      </CardHeader>
      {/* The query container the months' tables reflow against (`@4xl`). */}
      <CardContent className="@container space-y-6">
        {matrix.months.map((month) => (
          <MatrixMonth
            key={`${month.periodStart.toISOString()}:${month.periodEnd.toISOString()}`}
            month={month}
            now={now}
            personName={personName}
          />
        ))}
      </CardContent>
    </Card>
  )
}

// The five columns need about 56rem. In a narrower card (a phone, a tablet, a
// laptop with the sidebar open) the table reflows into one block per result,
// each fact under its column's name, so nothing is squeezed to a word a line or
// left off-screen in a scroller. The roles are explicit because a changed CSS
// display drops the table's semantics from the accessibility tree.
const TABLE = 'block @4xl:table'
const HEADER = 'hidden @4xl:table-header-group'
const BODY = 'block @4xl:table-row-group'
const ROW = 'block py-3 @4xl:table-row'
const CELL = 'block px-0 py-1 whitespace-normal @4xl:table-cell @4xl:px-2 @4xl:py-2'

/** Each column's name: its header, and each result's own in the reflowed block. */
const COLUMN = {
  subject: 'Subject',
  measure: 'Measure and evidence',
  result: 'Result',
  dataThrough: 'Data through',
  number: 'Number',
} as const

type Month = GoalResultsMatrixModel['months'][number]

function MatrixMonth({
  month,
  now,
  personName,
}: Readonly<{ month: Month } & Pick<Props, 'now' | 'personName'>>) {
  const headingId = useId()
  return (
    <section>
      <h3 id={headingId} className="mb-2 text-sm font-medium">
        {formatMonthYear(month.periodStart, month.propertyTimezone)}
      </h3>
      <Table role="table" aria-labelledby={headingId} className={TABLE}>
        <TableHeader role="rowgroup" className={HEADER}>
          <TableRow role="row">
            <TableHead role="columnheader">{COLUMN.subject}</TableHead>
            <TableHead role="columnheader">{COLUMN.measure}</TableHead>
            <TableHead role="columnheader">{COLUMN.result}</TableHead>
            <TableHead role="columnheader">{COLUMN.dataThrough}</TableHead>
            <TableHead role="columnheader">{COLUMN.number}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody role="rowgroup" className={BODY}>
          {month.rows.map((row) => (
            <MatrixRow
              key={row.resultId}
              row={row}
              timezone={month.propertyTimezone}
              now={now}
              personName={personName}
            />
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

/**
 * A result's fact with its column's name above it, for the reflowed block only:
 * where the columns are drawn their header says it, and the name is not drawn.
 */
function Cell({
  label,
  className,
  children,
}: Readonly<{ label?: string; className?: string; children: ReactNode }>) {
  return (
    <TableCell role="cell" className={cn(CELL, className)}>
      {label === undefined ? null : (
        <span className="block text-xs text-muted-foreground @4xl:hidden">{label}</span>
      )}
      {children}
    </TableCell>
  )
}

function MatrixRow({
  row,
  timezone,
  now,
  personName,
}: Readonly<
  { row: GoalResultsMatrixRow; timezone: string } & Pick<Props, 'now' | 'personName'>
>) {
  return (
    <TableRow role="row" className={ROW}>
      <Cell>
        <span className="block font-medium">{row.subjectName}</span>
        <span className="block text-xs text-muted-foreground">{scopeLabel(row)}</span>
      </Cell>
      <Cell label={COLUMN.measure} className="max-w-72">
        <span className="block font-medium">{goalMetricLabel(row.metric)}</span>
        <span className="block text-xs text-muted-foreground">
          {evidenceLabel(row.evidence, row.metric)}
        </span>
      </Cell>
      <Cell label={COLUMN.result} className="max-w-80">
        {/* It wraps: an Updating month's line is longer than the column. */}
        <Badge variant="outline" className="justify-start text-left whitespace-normal">
          {row.correction ? 'Corrected · ' : ''}
          <AvailabilityLine
            subject={row.metric === 'qualified_scans' ? 'scans' : 'ratings'}
            state={row.availability}
            dataThrough={row.dataThrough}
            reason={null}
            timeZone={timezone}
          />
        </Badge>
        <span className="mt-1 block text-xs text-muted-foreground">
          {row.explanation}
        </span>
      </Cell>
      <Cell label={COLUMN.dataThrough}>
        {(row.dataThrough ? formatDate(row.dataThrough, timezone) : null) ??
          'Not available yet'}
      </Cell>
      <Cell label={COLUMN.number} className="max-w-64">
        <span className="block">
          {row.targetProvenance.programName} · target{' '}
          {formatTarget(row.targetProvenance.targetValue, row.metric)}
        </span>
        <span className="block text-xs text-muted-foreground">
          Effective {formatDate(row.targetProvenance.effectiveFrom, timezone)} · set on{' '}
          {formatShortDate(row.targetProvenance.setAt, timezone, now) ??
            'an unknown date'}
        </span>
        {/* The target above is the month's own once a manager changed it. */}
        {row.monthTarget === null ? null : (
          <span className="block text-xs text-muted-foreground">
            {goalTargetMarkerLine(row.metric, row.monthTarget, {
              timezone,
              now,
              personName,
            })}
          </span>
        )}
      </Cell>
    </TableRow>
  )
}

/**
 * "64 scans", "1 private rating", "1,234 scans", "4.6 from 12 ratings",
 * "6 of 10 ratings so far": one is singular, and a count is grouped.
 */
function evidenceLabel(evidence: GoalResultsMatrixEvidence, metric: string): string {
  if (evidence.kind === 'average') {
    return evidence.value === null
      ? `${evidence.sampleCount} of ${evidence.minimumSample} ratings so far`
      : `${evidence.value.toFixed(1)} from ${evidence.sampleCount} ratings`
  }
  if (evidence.value === null) return 'No verified count available'
  const one = evidence.value === 1
  const noun =
    metric === 'qualified_scans'
      ? one
        ? 'scan'
        : 'scans'
      : one
        ? 'private rating'
        : 'private ratings'
  return `${formatNumber(evidence.value)} ${noun}`
}

function scopeLabel(row: GoalResultsMatrixRow): string {
  if (row.scope === 'property') return 'Property'
  if (row.scope === 'portal_group') return 'Portal group'
  return 'Portal'
}

function formatTarget(value: number, metric: string): string {
  return metric === 'portal_rating_average' ? value.toFixed(1) : formatNumber(value)
}
