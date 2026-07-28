import { AlertTriangle, Ban } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EntityScope } from '#/shared/domain/metric-keys'
import type { Goal } from '#/contexts/goal/application/public-api'
import {
  aggregationLabel,
  formatDate,
  formatPeriodDates,
  goalTypeLabel,
  measureLabel,
  metricLabel,
  scopeLabel,
  statusLabel,
  targetUnit,
} from '#/contexts/goal/ui/helpers'
import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'

export function SummaryMetric({
  term,
  value,
}: Readonly<{ term: string; value: string }>) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="truncate text-sm font-semibold">{value}</dd>
    </div>
  )
}

export function Detail({
  term,
  children,
}: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b p-4 last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(3n)]:border-r-0">
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="min-w-0 truncate text-sm font-semibold">{children}</dd>
    </div>
  )
}

export function CancelGoalDialog({
  goalName,
  onCancel,
  isCancelling,
}: Readonly<{
  goalName: string
  onCancel: () => void
  isCancelling: boolean
}>) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={isCancelling}>
          <Ban data-icon="inline-start" />
          {isCancelling ? 'Cancelling...' : 'Cancel Goal'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>Cancel goal?</AlertDialogTitle>
          <AlertDialogDescription>
            This will stop "{goalName}" and move it to History with its current progress.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCancelling}>Keep goal</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isCancelling}
            onClick={onCancel}
          >
            {isCancelling ? 'Cancelling...' : 'Cancel goal'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function formatValue(value: number, unit: string): string {
  const formatted = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return unit ? `${formatted} ${unit}` : formatted
}

export function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** "Goal settings" section of the detail page — the rule used to measure
 * and group the target. Extracted from goal-detail-page.tsx (BQC-5.3 CI
 * fallow gate: the page went 15 → 16 cognitive after the now-prop
 * threading; this section owns two of the nested branches). */
export function GoalSettingsSection({
  goal,
  scope,
  timeframeLabel,
}: Readonly<{
  goal: Goal
  scope: EntityScope
  timeframeLabel: string
}>) {
  return (
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
        <Detail term="Timeframe">{timeframeLabel}</Detail>
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
  )
}
