// The Monthly portal goal's card (ADR 0068, amended 2026-10-19: one goal design
// system): drawn in the shared card frame, with the goal's name and, while a
// goal runs, the one pace pill in the corner. Before its number is ready it is
// the gates, the first weeks, nothing counted or an unreadable recommendation
// (`portal-goal-card-before.tsx`); then the number to use
// (`portal-goal-card-ready.tsx`); then the goal (`portal-goal-card-goal.tsx`).
// Every arm once a Portal is live has a door to the set sheet. The title takes
// the focus back from a sheet that closes, and after a set, wherever the card
// is drawn, and after the month-start check-in is answered. On the goal's own
// page the page's title names it, so the card draws none (one heading per
// name) and the page's title takes the focus back.
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { CardContent } from '#/components/ui/card'
import { GoalCardFrame } from './goal-card-frame'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import { PortalGoalCardBefore } from './portal-goal-card-before'
import { PortalGoalCardGoal } from './portal-goal-card-goal'
import { PortalGoalCardReady, type PortalGoalCommands } from './portal-goal-card-ready'

/** The card title's id: a sheet or a dialog that closes hands the focus back to it. */
export const PORTAL_GOAL_TITLE_ID = 'portal-goal-title'

type Props = Readonly<{
  card: PortalGoalCardView
  propertyId: string
  /** The no-portal gate's "Create a portal" needs portal.create. */
  canCreatePortal: boolean
  commands: PortalGoalCommands
  /**
   * The title's level: a part of the Goals page's "Portal goals" section; null
   * where the page's own title names the card.
   */
  titleAs?: 'h2' | 'h3' | null
}>

/** A heading under the card's title: one level below it, under the page's title without one. */
const HEADING_BELOW = { h2: 'h3', h3: 'h4' } as const

/** The arm the read decided, for the arms before a goal: their bodies in the frame's content. */
function BeforeGoalBody({
  card,
  propertyId,
  canCreatePortal,
  commands,
}: Omit<Props, 'titleAs' | 'card'> &
  Readonly<{ card: Exclude<PortalGoalCardView, { state: 'goal' }> }>) {
  switch (card.state) {
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
          openSheet={commands.openSheet}
        />
      )
  }
}

export function PortalGoalCard({ titleAs = 'h3', commands, ...props }: Props) {
  const { card, propertyId } = props
  // Once a set is read back, Use is gone: the focus goes to the card's title.
  const focusingCommands: PortalGoalCommands = {
    ...commands,
    onSet: async () => {
      await commands.onSet()
      document.getElementById(PORTAL_GOAL_TITLE_ID)?.focus()
    },
  }
  if (card.state === 'goal') {
    return (
      <PortalGoalCardGoal
        goal={card.goal}
        today={card.today}
        propertyId={propertyId}
        slot="portal-goal-card"
        titleId={PORTAL_GOAL_TITLE_ID}
        titleAs={titleAs}
        openSheet={focusingCommands.openSheet}
        checkIn={
          focusingCommands.checkIn && {
            commands: focusingCommands.checkIn,
            onAnswered: focusingCommands.onSet,
            headingAs: titleAs === null ? 'h2' : HEADING_BELOW[titleAs],
          }
        }
      />
    )
  }
  return (
    <GoalCardFrame
      slot="portal-goal-card"
      title={titleAs === null ? null : PORTAL_GOAL_NAME}
      titleAs={titleAs ?? 'h3'}
      titleId={PORTAL_GOAL_TITLE_ID}
      dataState={card.state}
    >
      <CardContent>
        <BeforeGoalBody {...props} card={card} commands={focusingCommands} />
      </CardContent>
    </GoalCardFrame>
  )
}
