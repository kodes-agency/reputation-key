import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { ProgressBar } from './progress-bar'
import { InstanceHistoryTable } from './instance-history-table'
import {
  statusBadgeVariant,
  statusLabel,
  scopeLabel,
  goalTypeLabel,
  aggregationLabel,
  formatPeriodDates,
  formatDate,
  daysRemaining,
} from '#/contexts/goal/ui/helpers'
import { deriveEntityScope } from '#/contexts/goal/application/dto/goal.dto'
import type { Goal, GoalProgress } from '#/contexts/goal/application/dto/goal.dto'

export type GoalWithProgress = { goal: Goal; progress: GoalProgress | null }

type Props = Readonly<{
  goal: Goal
  progress: GoalProgress | null
  instances: readonly GoalWithProgress[]
  propertyId: string
  onCancel: () => void
  isCancelling: boolean
}>

export function GoalDetailPage({
  goal,
  progress,
  instances,
  propertyId,
  onCancel,
  isCancelling,
}: Props) {
  const scope = deriveEntityScope(goal)
  const isRecurringTemplate = goal.goalType === 'recurring' && !goal.parentGoalId
  const hasPeriod = goal.periodStart && goal.periodEnd

  return (
    <div className="space-y-6">
      <Link
        to="/properties/$propertyId/goals"
        params={{ propertyId }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Goals
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{goal.name}</h1>
          {goal.description && (
            <p className="text-sm text-muted-foreground">{goal.description}</p>
          )}
        </div>
        <Badge variant={statusBadgeVariant(goal.status)}>
          {statusLabel(goal.status)}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Detail label="Scope" value={scopeLabel(scope)} />
            <Detail
              label="Type"
              value={<Badge variant="outline">{goalTypeLabel(goal.goalType)}</Badge>}
            />
            <Detail
              label="Aggregation"
              value={
                <Badge variant="outline">
                  {aggregationLabel(goal.aggregationFunction)}
                </Badge>
              }
            />
            <Detail label="Metric Key" value={goal.metricKey} />
            <Detail label="Target Value" value={goal.targetValue.toLocaleString()} />
            {hasPeriod && (
              <>
                <Detail
                  label="Period"
                  value={formatPeriodDates(goal.periodStart, goal.periodEnd)}
                />
                <Detail
                  label="Days Remaining"
                  value={
                    goal.periodEnd ? `${daysRemaining(goal.periodEnd) ?? 0} days` : '—'
                  }
                />
              </>
            )}
            {goal.completedAt && (
              <Detail label="Completed At" value={formatDate(goal.completedAt)} />
            )}
          </div>
          <Separator />
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Progress</h3>
            <ProgressBar
              currentValue={progress?.currentValue ?? 0}
              targetValue={goal.targetValue}
              aggregation={goal.aggregationFunction}
              status={goal.status}
            />
            {progress && (
              <p className="text-xs text-muted-foreground">
                Last computed: {formatDate(progress.lastComputedAt)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {goal.status === 'active' && (
        <div className="flex justify-end">
          <Button variant="destructive" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? 'Cancelling...' : 'Cancel Goal'}
          </Button>
        </div>
      )}

      {isRecurringTemplate && <InstanceHistoryTable instances={instances} />}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}
