// The Monthly portal goal card before a goal (P-4, copy deck G-5…G-11, G-19):
// the gates, each stated as a fact with the one way on; the first weeks, with
// each Portal's steps, the month so far and the day the number is ready;
// nothing counted; and a recommendation that cannot be read. A number that is
// ready is drawn with the first weeks (no ready day) until the card can offer
// it. No number is invented and nothing is in a warning colour.
import { Link } from '@tanstack/react-router'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Button } from '#/components/ui/button'
import { PortalGoalReadiness } from './portal-goal-readiness'
import {
  GETTING_READY_WORDS,
  RECOMMENDATION_UNREADABLE_WORDS,
  gateWords,
  nothingCountedWords,
  readyOnWords,
  soFarWords,
  type PortalGoalGateAction,
} from './portal-goal-words'

/** The card's arms before a goal. */
export type PortalGoalBeforeView = Exclude<PortalGoalCardView, { state: 'goal' }>

type Props = Readonly<{
  card: PortalGoalBeforeView
  propertyId: string
  /** The no-portal gate's "Create a portal" needs portal.create. */
  canCreatePortal: boolean
}>

type FirstWeeksView = Extract<
  PortalGoalBeforeView,
  { state: 'getting_ready' | 'ready' | 'scans_only' }
>

function GateAction({
  action,
  propertyId,
}: Readonly<{ action: PortalGoalGateAction; propertyId: string }>) {
  return (
    <Button asChild variant="outline" className="self-start">
      {action.kind === 'open_portal' ? (
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId: action.portalId }}
        >
          {action.label}
        </Link>
      ) : action.kind === 'open_portals' ? (
        <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
          {action.label}
        </Link>
      ) : (
        <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
          {action.label}
        </Link>
      )}
    </Button>
  )
}

function Gate({
  card,
  propertyId,
  canCreatePortal,
}: Readonly<{
  card: Extract<PortalGoalBeforeView, { state: 'no_portal' | 'drafts_only' }>
  propertyId: string
  canCreatePortal: boolean
}>) {
  const words = gateWords(card, canCreatePortal)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{words.fact}</p>
      {words.drafts === null ? null : <p className="text-sm">{words.drafts}</p>}
      {words.action === null ? null : (
        <GateAction action={words.action} propertyId={propertyId} />
      )}
    </div>
  )
}

function FirstWeeks({
  card,
  propertyId,
}: Readonly<{ card: FirstWeeksView; propertyId: string }>) {
  return (
    <div className="flex flex-col gap-4">
      {card.state === 'getting_ready' ? (
        <p className="text-sm text-muted-foreground">{GETTING_READY_WORDS}</p>
      ) : null}
      <PortalGoalReadiness propertyId={propertyId} portals={card.portals} />
      <div className="flex flex-col gap-2 border-t pt-4 text-sm">
        <p className="text-muted-foreground">{soFarWords(card.month, card.soFar)}</p>
        {card.state === 'getting_ready' ? <p>{readyOnWords(card.readyOn)}</p> : null}
      </div>
    </div>
  )
}

export function PortalGoalCardBefore({ card, propertyId, canCreatePortal }: Props) {
  switch (card.state) {
    case 'no_portal':
    case 'drafts_only':
      return (
        <Gate card={card} propertyId={propertyId} canCreatePortal={canCreatePortal} />
      )
    case 'getting_ready':
    case 'ready':
    case 'scans_only':
      return <FirstWeeks card={card} propertyId={propertyId} />
    case 'nothing_counted': {
      const words = nothingCountedWords(card.weeks)
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{words.text}</p>
          <GateAction action={words.action} propertyId={propertyId} />
        </div>
      )
    }
    case 'recommendation_unreadable':
      return (
        <p className="text-sm text-muted-foreground">{RECOMMENDATION_UNREADABLE_WORDS}</p>
      )
  }
}
