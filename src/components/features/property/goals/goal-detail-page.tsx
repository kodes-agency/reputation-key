import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
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
import { deriveEntityScope } from '#/contexts/goal/application/public-api'
import type { Goal, GoalProgress } from '#/contexts/goal/application/public-api'
import { type GoalWithProgress } from '#/contexts/goal/ui/helpers'

type Props = Readonly<{
  goal: Goal
  progress: GoalProgress | null
  instances: readonly GoalWithProgress[]
  propertyId: string
  propertyName: string
  onCancel: () => void
  isCancelling: boolean
}>

export function GoalDetailPage({
  goal,
  progress,
  instances,
  propertyId,
  propertyName,
  onCancel,
  isCancelling,
}: Props) {
  const scope = deriveEntityScope(goal)
  const isRecurringTemplate = goal.goalType === 'recurring' && !goal.parentGoalId
  const hasPeriod = goal.periodStart && goal.periodEnd

  return (
    <PageShell>
      <PageHeader
        title={goal.name}
        description={goal.description ?? undefined}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'Goals', to: `/properties/${propertyId}/goals` },
          { label: goal.name },
        ]}
        backTo={{ to: `/properties/${propertyId}/goals`, label: 'Back to Goals' }}
        actions={
          <Badge variant={statusBadgeVariant(goal.status)}>
            {statusLabel(goal.status)}
          </Badge>
        }
      />

      <Card>
        <CardHeader>
          <h2 className="font-semibold leading-none">Details</h2>
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
    </PageShell>
  )
}

function Detail({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}
