// The parent Google section owns the named region; History supplies a heading without
// duplicating the landmark.

import { History } from 'lucide-react'
import type { RatingGoalHistoryEntry } from '#/contexts/reporting/rating-goals/contracts'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
import { SectionTitle } from '#/components/ui/section-title'
import { Skeleton } from '#/components/ui/skeleton'
import { StatusBadge } from '#/components/ui/status-badge'
import type { RegionRead } from './rating-goal-section'
import { historyEntryView } from './rating-goal-view'

type Props = Readonly<{
  history: RegionRead<readonly RatingGoalHistoryEntry[]>
  timezone: string
  now: Date
}>

function Rows({
  entries,
  timezone,
  now,
}: Readonly<{
  entries: readonly RatingGoalHistoryEntry[]
  timezone: string
  now: Date
}>) {
  if (entries.length === 0) {
    return (
      <EmptyState icon={History} size="compact" title="No Google rating goal history" />
    )
  }
  return (
    <DataTable label="Google rating goal history" from="3xl">
      <DataTableHeader>
        <DataTableHead>Goal</DataTableHead>
        <DataTableHead className="w-40">Status</DataTableHead>
      </DataTableHeader>
      <DataTableBody>
        {entries.map((entry) => {
          const view = historyEntryView(entry, timezone, now)
          return (
            <DataTableRow key={entry.goalId}>
              <DataTableCell className="min-w-0 whitespace-normal">
                <p className="font-medium">{view.title}</p>
                <p className="text-sm text-muted-foreground">{view.summary}</p>
              </DataTableCell>
              <DataTableCell className="col-start-2 row-start-1 justify-self-end">
                <StatusBadge {...view.status} />
              </DataTableCell>
            </DataTableRow>
          )
        })}
      </DataTableBody>
    </DataTable>
  )
}

export function RatingGoalHistory({ history, timezone, now }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Google rating goal</SectionTitle>
      {history.failed ? (
        <RegionError
          message="The Google rating goal history couldn’t be loaded."
          onRetry={history.retry}
          retrying={history.retrying}
          size="compact"
        />
      ) : history.data === undefined ? (
        <Skeleton aria-hidden="true" className="h-24 rounded-xl" />
      ) : (
        <Rows entries={history.data} timezone={timezone} now={now} />
      )}
    </div>
  )
}
