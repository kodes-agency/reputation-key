import { Target } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import type { GoalProgramBundle } from '#/contexts/goal/application/public-api'

type StaffGoalListProps = Readonly<{
  goals: readonly GoalProgramBundle[]
}>

export function StaffGoalList({ goals }: StaffGoalListProps) {
  if (goals.length === 0) {
    return <EmptyState icon={Target} title="No visible goals" />
  }

  return (
    <div className="grid gap-3">
      {goals.map(({ program, version, assignments, results }) => {
        const currentAssignments = assignments.filter(
          (assignment) => assignment.programVersionId === version.id,
        )
        const currentResults = results.filter(
          (result) => result.programVersionId === version.id,
        )
        return (
          <Card key={program.id}>
            <CardContent className="space-y-2 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">{program.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {metricLabel(version.metric)} · target {version.targetValue} ·{' '}
                    {currentAssignments.length}{' '}
                    {currentAssignments.length === 1 ? 'subject' : 'subjects'}
                  </p>
                </div>
                <Badge variant="outline">{program.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {resultSummary(currentResults)}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function metricLabel(metric: string) {
  if (metric === 'qualified_scans') return 'Qualified scans'
  if (metric === 'portal_rating_count') return 'Private rating count'
  return 'Private rating average'
}

function resultSummary(results: GoalProgramBundle['results']) {
  const eligible = results.filter((result) => result.evaluation.state === 'eligible')
  if (eligible.length === 0) return 'Results are not available yet.'
  const achieved = eligible.filter((result) => result.evaluation.achieved).length
  return `${achieved} of ${eligible.length} current results achieved`
}
