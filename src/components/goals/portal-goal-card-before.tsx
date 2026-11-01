// The Monthly portal goal card before its number is ready (P-4, copy deck
// G-5…G-12, G-19): the gates, each stated as a fact with the one way on; the
// first weeks, with each Portal's steps, the month so far and the day the
// number is ready; nothing counted; and a recommendation that cannot be read.
// No number is invented and nothing is in a warning colour. Once a Portal is
// live, a link opens the set sheet with a number of the manager's own (G-12),
// where the page draws the sheet.
import { Link } from '@tanstack/react-router'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Button } from '#/components/ui/button'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalReadiness } from './portal-goal-readiness'
import {
  GETTING_READY_WORDS,
  RECOMMENDATION_UNREADABLE_WORDS,
  gateWords,
  nothingCountedWords,
  ownNumberDoorWords,
  readyOnWords,
  soFarWords,
  type PortalGoalGateAction,
} from './portal-goal-words'

/** The card's arms before a goal and before its number is ready. */
export type PortalGoalBeforeView = Exclude<
  PortalGoalCardView,
  { state: 'goal' | 'ready' | 'scans_only' }
>

type Props = Readonly<{
  card: PortalGoalBeforeView
  propertyId: string
  /** The no-portal gate's "Create a portal" needs portal.create. */
  canCreatePortal: boolean
  /** Opens the set sheet; without it no link to the sheet is drawn. */
  openSheet?: PortalGoalCommands['openSheet']
}>

type FirstWeeksView = Extract<PortalGoalBeforeView, { state: 'getting_ready' }>

/** G-12: the manager's own number, on scans when every candidate skips ratings. */
function OwnNumberDoor({
  state,
  openSheet,
  ratingsAvailable,
}: Readonly<{
  ratingsAvailable?: boolean
  state: Parameters<typeof ownNumberDoorWords>[0]
  openSheet: Props['openSheet']
}>) {
  if (openSheet === undefined) return null
  return (
    <Button
      variant="link"
      size="inline"
      touch
      className="self-start"
      onClick={() =>
        openSheet({
          measure: ratingsAvailable === false ? 'qualified_scans' : 'portal_rating_count',
        })
      }
    >
      {ownNumberDoorWords(state)}
    </Button>
  )
}

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
  openSheet,
}: Readonly<{
  card: FirstWeeksView
  propertyId: string
  openSheet: Props['openSheet']
}>) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{GETTING_READY_WORDS}</p>
      <PortalGoalReadiness propertyId={propertyId} portals={card.portals} />
      <div className="flex flex-col gap-2 border-t pt-4 text-sm">
        <p className="text-muted-foreground">{soFarWords(card.month, card.soFar)}</p>
        <p>{readyOnWords(card.readyOn)}</p>
        <OwnNumberDoor
          state={card.state}
          openSheet={openSheet}
          ratingsAvailable={card.sheet.ratingsAvailable}
        />
      </div>
    </div>
  )
}

export function PortalGoalCardBefore({
  card,
  propertyId,
  canCreatePortal,
  openSheet,
}: Props) {
  switch (card.state) {
    case 'no_portal':
    case 'drafts_only':
      return (
        <Gate card={card} propertyId={propertyId} canCreatePortal={canCreatePortal} />
      )
    case 'getting_ready':
      return <FirstWeeks card={card} propertyId={propertyId} openSheet={openSheet} />
    case 'nothing_counted': {
      const words = nothingCountedWords(card.weeks)
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{words.text}</p>
          <GateAction action={words.action} propertyId={propertyId} />
          <OwnNumberDoor
            state={card.state}
            openSheet={openSheet}
            ratingsAvailable={card.sheet.ratingsAvailable}
          />
        </div>
      )
    }
    case 'recommendation_unreadable':
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {RECOMMENDATION_UNREADABLE_WORDS}
          </p>
          <OwnNumberDoor
            state={card.state}
            openSheet={openSheet}
            ratingsAvailable={card.sheet.ratingsAvailable}
          />
        </div>
      )
  }
}
