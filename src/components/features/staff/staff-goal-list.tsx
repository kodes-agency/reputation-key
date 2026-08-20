import { Target } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import type { GovernedGoalDefinition } from '#/contexts/goal/application/public-api'

type StaffGoalListProps = Readonly<{
  goals: readonly GovernedGoalDefinition[]
}>

export function StaffGoalList({ goals }: StaffGoalListProps) {
  if (goals.length === 0) {
    return <EmptyState icon={Target} title="No visible goals" />
  }

  return (
    <div className="grid gap-3">
      {goals.map((goal) => (
        <Card key={goal.id}>
          <CardContent className="space-y-2 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium">{goal.name}</p>
                <p className="text-sm text-muted-foreground">
                  {goal.scope.kind === 'property'
                    ? 'Visible because this goal covers the property.'
                    : 'Visible because this goal covers a portal group you support.'}
                </p>
              </div>
              <Badge variant="outline">{goal.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Evaluation is unavailable until an eligible governed reading is recorded.
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
