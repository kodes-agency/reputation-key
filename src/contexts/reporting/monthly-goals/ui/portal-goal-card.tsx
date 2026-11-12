// On the goal's own page, omit the card title: the page supplies the heading and
// receives restored focus. Elsewhere the card title receives focus after setting or
// answering a check-in.

import type { PortalGoalCardView } from '#/contexts/reporting/monthly-goals/contracts'
import { CardContent } from '#/components/ui/card'
import { GoalCardFrame } from '../../../../components/goals/goal-card-frame'
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
