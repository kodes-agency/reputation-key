// The Monthly portal goal's card (ADR 0068): its title, the tile, and the arm
// the read decided. Before its number is ready it is the gates, the first
// weeks, nothing counted or an unreadable recommendation
// (`portal-goal-card-before.tsx`); then the number to use
// (`portal-goal-card-ready.tsx`); then the goal (`portal-goal-card-goal.tsx`).
// The title takes the focus back from a sheet that closes, and after a set,
// wherever the card is drawn.
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import { PortalGoalCardBefore } from './portal-goal-card-before'
import { PortalGoalCardGoal } from './portal-goal-card-goal'
import { PortalGoalCardReady, type PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalMonthTile } from './portal-goal-month-tile'

/** The card title's id: a sheet or a dialog that closes hands the focus back to it. */
const PORTAL_GOAL_TITLE_ID = 'portal-goal-title'

type Props = Readonly<{
  card: PortalGoalCardView
  propertyId: string
  /** The no-portal gate's "Create a portal" needs portal.create. */
  canCreatePortal: boolean
  commands: PortalGoalCommands
  /** The title's level: a part of the Goals page's "Portal goals" section. */
  titleAs?: 'h2' | 'h3'
}>

/**
 * The header tile's day (G-33): today in the first weeks and while the goal
 * runs, the day it starts once the number is ready or the goal is scheduled;
 * none at a gate.
 */
function tileDay(card: PortalGoalCardView): string | null {
  switch (card.state) {
    case 'getting_ready':
      return card.today
    case 'ready':
    case 'scans_only':
      return `${card.offer.month}-01`
    case 'goal':
      return card.goal.startsOn ?? card.today
    default:
      return null
  }
}

/** The arm the read decided. */
function CardBody({
  card,
  propertyId,
  canCreatePortal,
  commands,
}: Omit<Props, 'titleAs'>) {
  switch (card.state) {
    case 'goal':
      return <PortalGoalCardGoal goal={card.goal} today={card.today} />
    case 'ready':
    case 'scans_only':
      return (
        <PortalGoalCardReady
          propertyId={propertyId}
          offer={card.offer}
          commands={commands}
        />
      )
    default:
      return (
        <PortalGoalCardBefore
          card={card}
          propertyId={propertyId}
          canCreatePortal={canCreatePortal}
        />
      )
  }
}

export function PortalGoalCard({ titleAs = 'h3', commands, ...props }: Props) {
  const { card } = props
  const day = tileDay(card)
  // Once a set is read back, Use is gone: the focus goes to the card's title.
  const focusingCommands: PortalGoalCommands = {
    ...commands,
    onSet: async () => {
      await commands.onSet()
      document.getElementById(PORTAL_GOAL_TITLE_ID)?.focus()
    },
  }
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
        <CardBody {...props} commands={focusingCommands} />
      </CardContent>
    </Card>
  )
}
