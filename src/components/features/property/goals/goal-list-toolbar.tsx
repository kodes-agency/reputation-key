import { Link } from '@tanstack/react-router'
import { Filter } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { goalTypeLabel } from '#/contexts/goal/ui/helpers'
import type { GoalListView, HistoryGoalStatus } from '#/contexts/goal/ui/helpers'
import type { GoalType } from '#/contexts/goal/application/public-api'
import { GOAL_TYPES, goalSearch, type GoalSearch } from './goal-list-types'

type GoalsToolbarProps = Readonly<{
  propertyId: string
  view: GoalListView
  historyStatus?: HistoryGoalStatus
  goalType?: GoalType
  activeCount: number
  historyCount: number
}>

export function GoalsToolbar({
  propertyId,
  view,
  historyStatus,
  goalType,
  activeCount,
  historyCount,
}: GoalsToolbarProps) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
      <Tabs value={view} className="min-w-0">
        <TabsList>
          <TabsTrigger value="active" asChild>
            <Link
              to="/properties/$propertyId/goals"
              params={{ propertyId }}
              search={goalSearch({ view: 'active', goalType })}
            >
              Active
              <span className="tabular-nums text-muted-foreground">{activeCount}</span>
            </Link>
          </TabsTrigger>
          <TabsTrigger value="history" asChild>
            <Link
              to="/properties/$propertyId/goals"
              params={{ propertyId }}
              search={goalSearch({ view: 'history', historyStatus, goalType })}
            >
              History
              <span className="tabular-nums text-muted-foreground">{historyCount}</span>
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Filter className="size-3.5" />
          Filters
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterLink
            propertyId={propertyId}
            search={{ view, historyStatus }}
            active={!goalType}
          >
            All types
          </FilterLink>
          {GOAL_TYPES.map((type) => (
            <FilterLink
              key={type}
              propertyId={propertyId}
              search={{ view, historyStatus, goalType: type }}
              active={goalType === type}
            >
              {goalTypeLabel(type)}
            </FilterLink>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FilterLink({
  propertyId,
  search,
  active,
  children,
}: Readonly<{
  propertyId: string
  search: GoalSearch
  active: boolean
  children: ReactNode
}>) {
  return (
    <Button asChild variant={active ? 'secondary' : 'ghost'} size="sm">
      <Link
        to="/properties/$propertyId/goals"
        params={{ propertyId }}
        search={goalSearch(search)}
      >
        {children}
      </Link>
    </Button>
  )
}
