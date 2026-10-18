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
      <CardContent className="space-y-6">
        {matrix.months.map((month) => (
          <section
            key={`${month.periodStart.toISOString()}:${month.periodEnd.toISOString()}`}
          >
            <h3 className="mb-2 text-sm font-medium">
              {formatMonthYear(month.periodStart, month.propertyTimezone)}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Measure and evidence</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Data through</TableHead>
                  <TableHead>Number</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
        ))}
      </CardContent>
    </Card>
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
    <TableRow>
      <TableCell>
        <span className="block font-medium">{row.subjectName}</span>
        <span className="block text-xs text-muted-foreground">{scopeLabel(row)}</span>
      </TableCell>
      <TableCell className="max-w-72 whitespace-normal">
        <span className="block font-medium">{goalMetricLabel(row.metric)}</span>
        <span className="block text-xs text-muted-foreground">
          {evidenceLabel(row.evidence, row.metric)}
        </span>
      </TableCell>
      <TableCell className="max-w-80 whitespace-normal">
        <Badge variant="outline">
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
      </TableCell>
      <TableCell>
        {(row.dataThrough ? formatDate(row.dataThrough, timezone) : null) ??
          'Not available yet'}
      </TableCell>
      <TableCell className="max-w-64 whitespace-normal">
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
      </TableCell>
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
