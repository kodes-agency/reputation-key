// The Monthly portal goal's card (ADR 0068): its title, the tile, and the arm
// the read decided. Before a goal it is the gates, the first weeks, nothing
// counted or an unreadable recommendation (`portal-goal-card-before.tsx`). With
// a goal it draws nothing yet: the goal's own body arrives with the goal state,
// and until then the goal is listed under "More portal goals". The title takes
// the focus back from a sheet that closes, wherever the card is drawn.
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import { PortalGoalCardBefore } from './portal-goal-card-before'
import { PortalGoalMonthTile } from './portal-goal-month-tile'

/** The card title's id: a sheet or a dialog that closes hands the focus back to it. */
export const PORTAL_GOAL_TITLE_ID = 'portal-goal-title'

type Props = Readonly<{
  card: PortalGoalCardView
  propertyId: string
  /** The no-portal gate's "Create a portal" needs portal.create. */
  canCreatePortal: boolean
  /** The title's level: a part of the Goals page's "Portal goals" section. */
  titleAs?: 'h2' | 'h3'
}>

/** The header tile's day: today in the first weeks (G-33); none at a gate. */
function tileDay(card: PortalGoalCardView): string | null {
  switch (card.state) {
    case 'getting_ready':
    case 'ready':
    case 'scans_only':
      return card.today
    default:
      return null
  }
}

export function PortalGoalCard({
  card,
  propertyId,
  canCreatePortal,
  titleAs = 'h3',
}: Props) {
  if (card.state === 'goal') return null
  const day = tileDay(card)
  return (
    <Card data-slot="portal-goal-card" data-state={card.state} className="gap-4">
      <CardHeader className="flex items-start justify-between gap-3">
        <CardTitle
          as={titleAs}
          id={PORTAL_GOAL_TITLE_ID}
          tabIndex={-1}
          className="outline-none"
        >
          {PORTAL_GOAL_NAME}
        </CardTitle>
        {day === null ? null : <PortalGoalMonthTile day={day} />}
      </CardHeader>
      <CardContent>
        <PortalGoalCardBefore
          card={card}
          propertyId={propertyId}
          canCreatePortal={canCreatePortal}
        />
      </CardContent>
    </Card>
  )
}
