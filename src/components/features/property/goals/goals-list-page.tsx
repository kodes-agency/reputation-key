import { Link } from '@tanstack/react-router'
import { Plus, Target } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { ProgressBar } from './progress-bar'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import {
  statusBadgeVariant,
  statusLabel,
  scopeLabel,
  goalTypeLabel,
  metricLabel,
  targetUnit,
  formatPeriodDates,
  STATUS_ORDER,
  type GoalWithProgress,
} from '#/contexts/goal/ui/helpers'
import { deriveEntityScope } from '#/contexts/goal/application/public-api'

type GoalsListPageProps = Readonly<{
  goals: readonly GoalWithProgress[]
  propertyId: string
  propertyName: string
}>

export function GoalsListPage({ goals, propertyId, propertyName }: GoalsListPageProps) {
  // Sort by status bucket then createdAt desc
  const sorted = [...goals].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.goal.status] - STATUS_ORDER[b.goal.status]
    if (statusDiff !== 0) return statusDiff
    return b.goal.createdAt.getTime() - a.goal.createdAt.getTime()
  })

  return (
    <PageShell>
      <PageHeader
        title="Goals"
        description="Track and manage performance goals."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'Goals' },
        ]}
        actions={
          <Button asChild>
            <Link to="/properties/$propertyId/goals/new" params={{ propertyId }}>
              <Plus className="size-4" />
              New Goal
            </Link>
          </Button>
        }
      />

      {/* Goal list */}
      {sorted.length === 0 ? (
        <EmptyState icon={Target} title="No goals yet">
          <p className="text-sm text-muted-foreground">
            Create your first goal to start tracking performance.
          </p>
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          {sorted.map(({ goal, progress }) => {
            const scope = deriveEntityScope(goal)
            const isRecurringTemplate =
              goal.goalType === 'recurring' && !goal.parentGoalId

            return (
              <Card key={goal.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle>
                        <Link
                          to="/properties/$propertyId/goals/$goalId"
                          params={{ propertyId, goalId: goal.id }}
                          className="hover:underline"
                        >
                          {goal.name}
                        </Link>
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{scopeLabel(scope)}</Badge>
                        <Badge variant="outline">{metricLabel(goal.metricKey)}</Badge>
                        <Badge variant="outline">{goalTypeLabel(goal.goalType)}</Badge>
                      </div>
                    </div>
                    <Badge variant={statusBadgeVariant(goal.status)}>
                      {statusLabel(goal.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ProgressBar
                    currentValue={progress?.currentValue ?? 0}
                    targetValue={goal.targetValue}
                    aggregation={goal.aggregationFunction}
                    status={goal.status}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {isRecurringTemplate
                        ? 'Current instance'
                        : formatPeriodDates(goal.periodStart, goal.periodEnd) || '—'}
                    </span>
                    <span>
                      Target: {goal.targetValue.toLocaleString()}{' '}
                      {targetUnit(goal.metricKey, goal.aggregationFunction)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
