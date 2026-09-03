import type {
  GoalResultsMatrix as GoalResultsMatrixModel,
  GoalResultsMatrixEvidence,
  GoalResultsMatrixRow,
} from '#/contexts/goal/application/public-api'
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

type Props = Readonly<{ matrix: GoalResultsMatrixModel }>

export function GoalResultsMatrix({ matrix }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Goal Results Matrix</CardTitle>
        <p className="text-sm text-muted-foreground">
          Monthly evidence for Property, Portal Group, and Portal goals. Each result keeps
          its own measure and target.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {matrix.months.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Monthly results will appear after the first assigned period begins.
          </p>
        ) : (
          matrix.months.map((month) => (
            <section
              key={`${month.periodStart.toISOString()}:${month.periodEnd.toISOString()}`}
            >
              <h3 className="mb-2 text-sm font-medium">
                {monthLabel(month.periodStart, month.propertyTimezone)}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Measure and evidence</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Data through</TableHead>
                    <TableHead>Target source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {month.rows.map((row) => (
                    <MatrixRow
                      key={row.resultId}
                      row={row}
                      timezone={month.propertyTimezone}
                    />
                  ))}
                </TableBody>
              </Table>
            </section>
          ))
        )}
        {matrix.unassignedPortals.length > 0 ? (
          <section className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-medium">
              Portals without a Portal-scoped Goal Program
            </h3>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {matrix.unassignedPortals.map((portal) => (
                <li key={portal.portalId} className="rounded-md bg-muted/50 px-3 py-2">
                  <span className="font-medium">{portal.portalName}</span>
                  {portal.groupName ? (
                    <span className="text-muted-foreground"> · {portal.groupName}</span>
                  ) : (
                    <span className="text-muted-foreground"> · Ungrouped Portal</span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {portal.message}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}

function MatrixRow({
  row,
  timezone,
}: Readonly<{ row: GoalResultsMatrixRow; timezone: string }>) {
  return (
    <TableRow>
      <TableCell>
        <span className="block font-medium">{row.subjectName}</span>
        <span className="block text-xs text-muted-foreground">{scopeLabel(row)}</span>
      </TableCell>
      <TableCell className="max-w-72 whitespace-normal">
        <span className="block font-medium">{metricLabel(row.metric)}</span>
        <span className="block text-xs text-muted-foreground">
          {evidenceLabel(row.evidence, row.metric)}
        </span>
      </TableCell>
      <TableCell className="max-w-80 whitespace-normal">
        <Badge variant="outline">
          {row.correction ? 'Corrected · ' : ''}
          <AvailabilityLine
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
        {row.dataThrough ? formatDate(row.dataThrough, timezone) : 'Not available yet'}
      </TableCell>
      <TableCell className="max-w-64 whitespace-normal">
        <span className="block">
          {row.targetProvenance.programName} · target{' '}
          {formatTarget(row.targetProvenance.targetValue, row.metric)}
        </span>
        <span
          className="block text-xs text-muted-foreground"
          title={`Metric definition ${row.targetProvenance.metricDefinitionVersionId}`}
        >
          Program version {row.targetProvenance.programVersion} · Metric rules{' '}
          {shortVersion(row.targetProvenance.metricDefinitionVersionId)}
        </span>
        <span className="block text-xs text-muted-foreground">
          Effective {formatDate(row.targetProvenance.effectiveFrom, timezone)}
        </span>
      </TableCell>
    </TableRow>
  )
}

function evidenceLabel(evidence: GoalResultsMatrixEvidence, metric: string): string {
  if (evidence.kind === 'average') {
    return evidence.value === null
      ? `${evidence.sampleCount} eligible ratings · ${evidence.minimumSample} required`
      : `${evidence.value.toFixed(1)} from ${evidence.sampleCount} eligible ratings`
  }
  if (evidence.value === null) return 'No verified count available'
  return metric === 'qualified_scans'
    ? `${evidence.value} verified qualified scans`
    : `${evidence.value} eligible private ratings`
}

function scopeLabel(row: GoalResultsMatrixRow): string {
  if (row.scope === 'property') return 'Property'
  if (row.scope === 'portal_group') return 'Portal Group'
  return row.ungroupedPortal ? 'Ungrouped Portal' : 'Portal'
}

function metricLabel(metric: string): string {
  if (metric === 'qualified_scans') return 'Qualified scans'
  if (metric === 'portal_rating_count') return 'Private rating count'
  return 'Private rating average'
}

function formatTarget(value: number, metric: string): string {
  return metric === 'portal_rating_average' ? value.toFixed(1) : String(value)
}

function shortVersion(value: string): string {
  return value.length > 12 ? `…${value.slice(-8)}` : value
}

function monthLabel(start: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(start)
}

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: timezone,
  }).format(date)
}
