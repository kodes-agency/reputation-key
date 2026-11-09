// Keep counts in name order with no rankings, bars or goal shares. Show them only when
// they reconcile to the governed total.

import { useId } from 'react'
import type { PortalGoalRows } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { InlineLink } from '#/components/ui/inline-link'
import { portalCountsWords } from './portal-goal-running-view'

/** Where "See each" lands on the goal's page: every Portal's count. */
export const FROM_YOUR_PORTALS_ID = 'from-your-portals'

type Props = Readonly<{ rows: PortalGoalRows; propertyId: string }>

export function PortalGoalPortalCounts({ rows, propertyId }: Props) {
  const headingId = useId()
  const words = portalCountsWords(rows)
  if (words.kind === 'sentence') {
    return (
      <p className="text-sm text-muted-foreground">
        {words.text}
        {words.seeEach === null ? null : (
          <>
            <span aria-hidden="true"> · </span>
            <InlineLink
              to="/properties/$propertyId/goals/portals"
              params={{ propertyId }}
              hash={FROM_YOUR_PORTALS_ID}
            >
              {words.seeEach}
            </InlineLink>
          </>
        )}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2" data-slot="portal-goal-portal-counts">
      <p id={headingId} className="text-sm text-muted-foreground">
        {words.heading}
      </p>
      <ul aria-labelledby={headingId} className="flex flex-col gap-1 text-sm">
        {words.rows.map((row) => (
          <li key={row.key} className="flex justify-between gap-3">
            <span className="min-w-0 truncate text-muted-foreground">{row.name}</span>
            <span className="tabular-nums">{row.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
