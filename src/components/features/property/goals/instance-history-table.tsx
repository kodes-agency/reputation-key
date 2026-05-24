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
import { ProgressBar } from './progress-bar'
import {
  statusBadgeVariant,
  statusLabel,
  formatPeriodDates,
} from '#/contexts/goal/ui/helpers'
import type { Goal, GoalProgress } from '#/contexts/goal/application/dto/goal.dto'

type InstanceWithProgress = { goal: Goal; progress: GoalProgress | null }

export function InstanceHistoryTable({
  instances,
}: Readonly<{
  instances: readonly InstanceWithProgress[]
}>) {
  if (instances.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instance History</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.map(({ goal: instance, progress: instProgress }) => (
              <TableRow key={instance.id}>
                <TableCell className="font-medium">
                  {formatPeriodDates(instance.periodStart, instance.periodEnd) || '—'}
                </TableCell>
                <TableCell>
                  <ProgressBar
                    currentValue={instProgress?.currentValue ?? 0}
                    targetValue={instance.targetValue}
                    aggregation={instance.aggregationFunction}
                    status={instance.status}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(instance.status)}>
                    {statusLabel(instance.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
