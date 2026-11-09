// The rows provide a text alternative to the chart, including Google's moves, plan
// changes and review setbacks.

import type { RatingGoalDetailView } from '#/contexts/reporting/rating-goals/contracts'
import { InlineLink } from '#/components/ui/inline-link'
import { GoalHistoryList } from '#/components/goals/goal-history-list'
import { movedRows, type MovedContext, type MovedRow } from './rating-goal-moved-view'

type Props = MovedContext &
  Readonly<{
    detail: RatingGoalDetailView
    /** The low reviews open in this Property's Inbox. */
    propertyId: string
  }>

const TONE: Readonly<Record<NonNullable<MovedRow['tone']>, string>> = {
  positive: 'text-positive',
  warn: 'text-warn',
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
          className="-my-3 inline-block py-3 md:my-0 md:py-0"
        >
          Open in the inbox
        </InlineLink>
      </div>
    </div>
  )
}

export function RatingGoalMovedList({ detail, propertyId, ...context }: Props) {
  return (
    <GoalHistoryList
      title="What happened"
      rows={movedRows(detail, context).map((row) => ({
        key: row.key,
        when: row.when,
        content: <RowText row={row} propertyId={propertyId} />,
      }))}
    />
  )
}
