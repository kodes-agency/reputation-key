import { Link } from '@tanstack/react-router'
import { Filter } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
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

/**
 * View switcher uses a nav + links (not Radix Tabs). TabsTrigger+asChild Link
 * sets aria-controls to panels that do not exist when there is no TabsContent,
 * which fails axe aria-valid-attr-value (BQR merge gate).
 */
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
      <nav aria-label="Goal list views" className="min-w-0">
        <div
          className={cn(
            'inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground',
          )}
        >
          <ViewLink
            propertyId={propertyId}
            search={goalSearch({ view: 'active', goalType })}
            active={view === 'active'}
          >
            Active
            <span className="tabular-nums text-muted-foreground">{activeCount}</span>
          </ViewLink>
          <ViewLink
            propertyId={propertyId}
            search={goalSearch({ view: 'history', historyStatus, goalType })}
            active={view === 'history'}
          >
            History
            <span className="tabular-nums text-muted-foreground">{historyCount}</span>
          </ViewLink>
        </div>
      </nav>

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

function ViewLink({
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
    <Link
      to="/properties/$propertyId/goals"
      params={{ propertyId }}
      search={search}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-all',
        active
          ? 'bg-background text-foreground shadow-sm'
          : // muted-foreground meets WCAG AA; foreground/60 fails axe (4.47 < 4.5)
            'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
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
