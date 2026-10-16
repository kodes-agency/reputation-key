// "What moved you" on the Google rating goal's detail page (round 5, PLAN-D
// D-2, mock D3): this week's new reviews, each day Google's own number moved
// (up in the positive ink, back in the warning ink) and each change of the
// plan, newest first, and the day the goal was set; then how fresh Google's
// numbers are and who sees this page. The rows say in words what the chart
// draws, so the chart is never the only way to know it.
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { cn } from '#/lib/utils'
import { freshnessText } from './rating-goal-detail-view'
import { movedRows, type MovedContext, type MovedRow } from './rating-goal-moved-view'

type Props = MovedContext &
  Readonly<{
    detail: RatingGoalDetailView
    /** When the detail was read: Google's numbers are "checked N minutes ago" from it. */
    readAt: Date
  }>

const TONE: Readonly<Record<NonNullable<MovedRow['tone']>, string>> = {
  positive: 'text-positive',
  warn: 'text-warn',
}

/** How fresh Google's numbers are, and who sees this page. */
function Foot({ detail, readAt }: Pick<Props, 'detail' | 'readAt'>) {
  return (
    <p className="text-xs text-muted-foreground">
      {detail.google === null
        ? 'Google’s numbers are not in yet'
        : freshnessText(detail.google.asOf, readAt)}
      {' · '}Owners and managers only
    </p>
  )
}

export function RatingGoalMovedList({ detail, readAt, ...context }: Props) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle as="h2">What moved you</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y text-sm">
          {movedRows(detail, context).map((row) => (
            <li key={row.key} className="flex gap-x-4 py-2 first:pt-0 last:pb-0">
              <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                {row.when}
              </span>
              <span className={cn('min-w-0', row.tone === null ? null : TONE[row.tone])}>
                {row.text}
              </span>
            </li>
          ))}
        </ul>
        <Foot detail={detail} readAt={readAt} />
      </CardContent>
    </Card>
  )
}
