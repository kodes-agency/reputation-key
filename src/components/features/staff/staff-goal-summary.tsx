import { Link } from '@tanstack/react-router'
import { Target, ArrowRight } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { ProgressBar } from '#/components/features/property/goals/progress-bar'
import {
  statusBadgeVariant,
  statusLabel,
  goalTypeLabel,
  type GoalWithProgress,
} from '#/contexts/goal/ui/helpers'

type StaffGoalSummaryProps = Readonly<{
  goals: readonly GoalWithProgress[]
}>

export function StaffGoalSummary({ goals }: StaffGoalSummaryProps) {
  if (goals.length === 0) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Goals</h2>
        <EmptyState icon={Target} title="No goals assigned yet" />
      </div>
    )
  }

  const topGoals = goals.slice(0, 3)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Goals</h2>
        {goals.length > 3 && (
          <Link
            to="/progress"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            View all goals
            <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
      <div className="grid gap-3">
        {topGoals.map(({ goal, progress }) => (
          <Card key={goal.id}>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{goal.name}</span>
                  <Badge variant="outline" className="shrink-0">
                    {goalTypeLabel(goal.goalType)}
                  </Badge>
                </div>
                <ProgressBar
                  currentValue={progress?.currentValue ?? 0}
                  targetValue={goal.targetValue}
                  aggregation={goal.aggregationFunction}
                  status={goal.status}
                />
              </div>
              <Badge variant={statusBadgeVariant(goal.status)} className="shrink-0">
                {statusLabel(goal.status)}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
