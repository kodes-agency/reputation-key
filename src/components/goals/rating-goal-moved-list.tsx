// "What moved you" on the Google rating goal's detail page (round 5, PLAN-D
// D-2 and D-2b, mock D3): this week's new reviews and their stars, each day
// Google's own number moved (up in the positive ink, back in the warning ink),
// each change of the plan and each low review since the set with what it set
// the goal back and a link to it in the Inbox ("Open in the inbox": it may be
// answered already), newest first, and the day the goal was set; then how
// fresh Google's numbers are and who sees this page. The rows say in words
// what the chart draws, so the chart is never the only way to know it.
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { InlineLink } from '#/components/ui/inline-link'
import { freshnessText } from './rating-goal-detail-view'
import { movedRows, type MovedContext, type MovedRow } from './rating-goal-moved-view'

type Props = MovedContext &
  Readonly<{
    detail: RatingGoalDetailView
    /** When the detail was read: Google's numbers are "checked N minutes ago" from it. */
    readAt: Date
    /** The low reviews open in this Property's Inbox. */
    propertyId: string
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

/**
 * A row's words: the toned text and a low review's setback, then its link to
 * the Inbox in a block of its own (a link inside a line of words would be told
 * from them by colour alone), beside the words when it fits, under them when not.
 */
function RowText({ row, propertyId }: Readonly<{ row: MovedRow; propertyId: string }>) {
  const words = (
    <span>
      <span className={row.tone === null ? undefined : TONE[row.tone]}>{row.text}</span>
      {row.detail ? ` · ${row.detail}` : null}
    </span>
  )
  if (!row.inboxItemId) return <span className="min-w-0">{words}</span>
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      {words}
      <div>
        <InlineLink
          to="/properties/$propertyId/reviews"
          params={{ propertyId }}
          search={{ itemId: row.inboxItemId }}
          aria-label={row.linkLabel}
          className="inline-flex min-h-11 items-center md:min-h-0"
        >
          Open in the inbox
        </InlineLink>
      </div>
    </div>
  )
}

export function RatingGoalMovedList({ detail, readAt, propertyId, ...context }: Props) {
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
              <RowText row={row} propertyId={propertyId} />
            </li>
          ))}
        </ul>
        <Foot detail={detail} readAt={readAt} />
      </CardContent>
    </Card>
  )
}
