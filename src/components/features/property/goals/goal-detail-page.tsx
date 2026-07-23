import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { InstanceHistoryTable } from './instance-history-table'
import { GoalProgressTrack } from './goal-progress-track'
import {
  CancelGoalDialog,
  Detail,
  SummaryMetric,
  formatValue,
  sentenceCase,
} from './goal-detail-parts'
import {
  aggregationLabel,
  formatDate,
  formatPeriodDates,
  getGoalPresentation,
  goalTypeLabel,
  measureLabel,
  metricLabel,
  scopeLabel,
  statusBadgeVariant,
  statusLabel,
  targetUnit,
  type GoalWithProgress,
} from '#/contexts/goal/ui/helpers'
import { deriveEntityScope } from '#/contexts/goal/application/public-api'
import type { Goal, GoalProgress } from '#/contexts/goal/application/public-api'

type Props = Readonly<{
  goal: Goal
  progress: GoalProgress | null
  instances: readonly GoalWithProgress[]
  propertyId: string
  propertyName: string
  onCancel: () => void
  isCancelling: boolean
  canCancelGoal?: boolean
  /** BQC-5.3: the render edge owns the wall clock — inject a fixed value in stories/tests for deterministic pace. */
  now?: Date
}>

export function GoalDetailPage({
  goal,
  progress,
  instances,
  propertyId,
  propertyName,
  onCancel,
  isCancelling,
  canCancelGoal = true,
  now = new Date(),
}: Props) {
  const scope = deriveEntityScope(goal)
  const presentation = getGoalPresentation(goal, progress, now)
  const isRecurringTemplate = goal.goalType === 'recurring' && !goal.parentGoalId
  const canCancel = goal.status === 'active' && canCancelGoal

  return (
    <PageShell className="flex flex-col gap-5 md:gap-6">
      <PageHeader
        title={goal.name}
        description={goal.description ?? undefined}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'Goals', to: `/properties/${propertyId}/goals` },
          { label: goal.name },
        ]}
        actions={
          <Badge variant={statusBadgeVariant(goal.status)}>
            {statusLabel(goal.status)}
          </Badge>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle>Progress</CardTitle>
              <CardDescription>{presentation.statusMessage}</CardDescription>
            </div>
            <Badge variant="outline">{presentation.remainingLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
            <div className="flex min-w-0 flex-col gap-3">
              <GoalProgressTrack
                currentValue={presentation.currentValue}
                targetValue={presentation.targetValue}
                percent={presentation.progressPercent}
                label={presentation.progressLabel}
                status={goal.status}
                attention={presentation.attention}
                expectedPercent={presentation.expectedPercent}
                showExpectedMarker={presentation.showExpectedMarker}
              />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="tabular-nums text-foreground">
                  {presentation.progressLabel}
                </span>
                <span>{presentation.timeframeLabel}</span>
                {presentation.showExpectedMarker && (
                  <span>Marker shows expected progress for elapsed time</span>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <SummaryMetric
                term="Current"
                value={formatValue(presentation.currentValue, presentation.unit)}
              />
              <SummaryMetric
                term="Target"
                value={formatValue(goal.targetValue, presentation.unit)}
              />
              <SummaryMetric
                term="Pace"
                value={presentation.paceLabel || presentation.remainingLabel}
              />
              {progress && (
                <SummaryMetric
                  term="Last update"
                  value={formatDate(progress.lastComputedAt)}
                />
              )}
            </dl>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Goal settings</h2>
          <p className="text-sm text-muted-foreground">
            The rule used to measure and group this target.
          </p>
        </div>
        <dl className="grid rounded-lg border sm:grid-cols-2 lg:grid-cols-3">
          <Detail term="Scope">{scopeLabel(scope)}</Detail>
          <Detail term="Type">{goalTypeLabel(goal.goalType)}</Detail>
          <Detail term="Measured as">
            {sentenceCase(measureLabel(goal.metricKey, goal.aggregationFunction))}
          </Detail>
          <Detail term="Metric">{metricLabel(goal.metricKey)}</Detail>
          <Detail term="Aggregation">{aggregationLabel(goal.aggregationFunction)}</Detail>
          <Detail term="Target">
            {goal.targetValue.toLocaleString()}{' '}
            {targetUnit(goal.metricKey, goal.aggregationFunction)}
          </Detail>
          <Detail term="Timeframe">{presentation.timeframeLabel}</Detail>
          <Detail term="Status">{statusLabel(goal.status)}</Detail>
          {goal.completedAt && (
            <Detail term="Completed">{formatDate(goal.completedAt)}</Detail>
          )}
          {goal.periodStart || goal.periodEnd ? (
            <Detail term="Period">
              {formatPeriodDates(goal.periodStart, goal.periodEnd)}
            </Detail>
          ) : null}
        </dl>
      </section>

      {canCancel && (
        <section className="flex flex-col gap-3 rounded-lg border border-destructive/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Cancel this goal</h2>
            <p className="text-sm text-muted-foreground">
              Cancelling stops tracking this target and keeps the final progress in
              History.
            </p>
          </div>
          <CancelGoalDialog
            goalName={goal.name}
            onCancel={onCancel}
            isCancelling={isCancelling}
          />
        </section>
      )}

      {isRecurringTemplate && <InstanceHistoryTable instances={instances} />}
    </PageShell>
  )
}
