// The parts of the Google rating goal's detail page below its summary: the
// change log and the page's foot (how fresh Google's numbers are, and who sees
// this page).
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { formatShortDate } from '#/lib/format'
import { freshnessText } from './rating-goal-detail-view'
import { changeText } from './rating-goal-view'

type Detail = Readonly<{ detail: RatingGoalDetailView }>

export function RatingGoalChangeLog({
  detail,
  personName,
  timezone,
  now,
}: Detail &
  Readonly<{
    /** The person's name once the members are read; null until then, or for a former member. */
    personName: (userId: string) => string | null
    timezone: string
    now: Date
  }>) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle as="h2">Changes</CardTitle>
      </CardHeader>
      <CardContent>
        {detail.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No changes since the goal was set.
          </p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {detail.changes.map((change) => (
              <li
                key={`${change.changedAt}-${change.field}`}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <span className="font-medium">{changeText(change)}</span>
                <span className="text-muted-foreground">
                  {[
                    personName(change.changedBy) ?? 'A manager',
                    formatShortDate(change.changedAt, timezone, now),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** How fresh Google's numbers are, and who sees this page. */
export function RatingGoalFoot({ detail, readAt }: Detail & Readonly<{ readAt: Date }>) {
  return (
    <p className="text-xs text-muted-foreground">
      {detail.google === null
        ? 'Google’s numbers are not in yet'
        : freshnessText(detail.google.asOf, readAt)}
      {' · '}Owners and managers only
    </p>
  )
}
