import { Target } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { ProgressBar } from '#/components/features/property/goals/progress-bar'
import {
  statusBadgeVariant,
  statusLabel,
  goalTypeLabel,
  formatDate,
} from '#/contexts/goal/ui/helpers'
import type { GoalWithProgress, GoalStatus } from '#/contexts/goal/application/public-api'

type StaffGoalListProps = Readonly<{
  goals: readonly GoalWithProgress[]
}>

const STATUS_GROUP_LABELS: Record<GoalStatus, string> = {
  active: 'Active Goals',
  completed: 'Completed Goals',
  expired: 'Expired Goals',
  cancelled: 'Cancelled Goals',
}

const STATUS_GROUPS: readonly GoalStatus[] = [
  'active',
  'completed',
  'expired',
  'cancelled',
]

export function StaffGoalList({ goals }: StaffGoalListProps) {
  if (goals.length === 0) {
    return <EmptyState icon={Target} title="No goals assigned yet" />
  }

  // Group goals by status
  const grouped = new Map<GoalStatus, GoalWithProgress[]>()
  for (const status of STATUS_GROUPS) {
    grouped.set(status, [])
  }
  for (const entry of goals) {
    const group = grouped.get(entry.goal.status)
    if (group) {
      group.push(entry)
    }
  }

  return (
    <div className="space-y-8">
      {STATUS_GROUPS.map((status) => {
        const group = grouped.get(status)
        if (!group || group.length === 0) return null

        return (
          <div key={status} className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {STATUS_GROUP_LABELS[status]}
            </h2>
            <div className="grid gap-3">
              {group.map(({ goal, progress }) => (
                <Card key={goal.id}>
                  <CardContent className="space-y-3 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {goal.name}
                          </span>
                          <Badge variant="outline" className="shrink-0">
                            {goalTypeLabel(goal.goalType)}
                          </Badge>
                        </div>
                        {goal.periodEnd && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Deadline: {formatDate(goal.periodEnd)}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={statusBadgeVariant(goal.status)}
                        className="shrink-0"
                      >
                        {statusLabel(goal.status)}
                      </Badge>
                    </div>
                    <ProgressBar
                      currentValue={progress?.currentValue ?? 0}
                      targetValue={goal.targetValue}
                      aggregation={goal.aggregationFunction}
                      status={goal.status}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
