// Google and Portal goals share no numbers (ADR 0067). Recent outcomes may come from
// History when the snapshot consumer finishes first. Read failures stay in this
// section; its parent owns the named region.

import type {
  RatingGoalCardView,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
} from '#/contexts/reporting/rating-goals/contracts'
import { RegionError } from '#/components/ui/region-error'
import { SectionTitle } from '#/components/ui/section-title'
import { Skeleton } from '#/components/ui/skeleton'
import { RATING_GOAL_HEADING_ID } from './rating-goal-card-header'
import { RatingGoalEmpty } from './rating-goal-empty'
import { RatingGoalOutcome } from './rating-goal-outcome'
import {
  RatingGoalCardWithRecap,
  type RatingGoalRecapCommands,
} from './rating-goal-recap'
import {
  ratingGoalOutcome,
  ratingGoalOutcomeShowsNow,
  type RatingGoalOutcomeView,
} from './rating-goal-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

/** A read as a region draws it: its data, whether it failed, and its "Try again". */
export type RegionRead<T> = Readonly<{
  data: T | undefined
  failed: boolean
  retrying: boolean
  retry: () => void
}>

type Props = Readonly<{
  propertyId: string
  timezone: string
  now: Date
  /** The card read, and when it was made (the day a goal it found reached was reached). */
  card: RegionRead<RatingGoalCardView | null> & Readonly<{ readAt: Date }>
  /** Read while there is no active goal: the empty states and the wizard need it. */
  setup: RegionRead<RatingGoalSetupView>
  /** Read while there is no active goal: a goal reached or ended lately is news. */
  history: RegionRead<readonly RatingGoalHistoryEntry[]>
  /** The few-reviews state links to the Portals, or to a first one. */
  hasPortals: boolean
  onStart: (intent: RatingGoalWizardIntent) => void
  /** The Monday check-in's commands, from the page (E30). */
  recap?: RatingGoalRecapCommands
}>

/**
 * The climb card's height, so the read that fills it moves nothing (CLS), measured
 * in the stories (2026-11-01): 230px once the card holds its two columns (a viewport
 * of about 1060px with the sidebar), 400px under that, and up to 450px on the
 * narrowest phone, where its lines wrap.
 */
const PENDING_HEIGHT =
  'max(230px, min(calc(400px + max(0px, (430px - 100vw) * 0.45)), calc((1060px - 100vw) * 1000)))'

const Pending = () => (
  <Skeleton
    aria-hidden="true"
    data-slot="rating-goal-pending"
    className="rounded-xl"
    style={{ minHeight: PENDING_HEIGHT }}
  />
)

/**
 * The section's title where the card does not bring its own. No region of its
 * own: the Goals page's section (`RatingGoalViews`) is the one named "Google
 * rating goal", so the name is not given twice.
 */
const Titled = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <div className="flex flex-col gap-3">
    <SectionTitle id={RATING_GOAL_HEADING_ID} tabIndex={-1} className="outline-none">
      Google rating goal
    </SectionTitle>
    {children}
  </div>
)

/**
 * With no active goal: the goal the card read found reached or ended, else the
 * newest in History while it is news. Undefined while History is still read
 * (a failed History read is no news, not an error: the empty state stands).
 */
function outcomeOf(
  card: Props['card'],
  history: Props['history'],
  now: Date,
): RatingGoalOutcomeView | null | undefined {
  if (card.data !== null && card.data !== undefined) {
    return ratingGoalOutcome(card.data, card.readAt, history.data, now)
  }
  if (history.data === undefined && !history.failed) return undefined
  return ratingGoalOutcome(null, card.readAt, history.data, now)
}

export function RatingGoalSection(props: Props) {
  const { propertyId, timezone, now, card, setup, onStart } = props
  if (card.failed) {
    return (
      <Titled>
        <RegionError
          message="The Google rating goal couldn’t be loaded."
          description="Your portal goals below are not affected."
          onRetry={card.retry}
          retrying={card.retrying}
        />
      </Titled>
    )
  }
  if (card.data === undefined) return <Pending />
  if (card.data !== null && card.data.state === 'active') {
    return (
      <RatingGoalCardWithRecap
        card={card.data}
        propertyId={propertyId}
        timezone={timezone}
        now={now}
        recap={props.recap}
      />
    )
  }
  const outcome = outcomeOf(card, props.history, now)
  if (outcome === undefined) return <Pending />
  if (outcome !== null) {
    return (
      <RatingGoalOutcome
        outcome={outcome}
        googleShowsNow={ratingGoalOutcomeShowsNow(card.data, setup.data)}
        canSetNext={setup.data?.eligibility.eligible !== false}
        timezone={timezone}
        now={now}
        onStart={onStart}
      />
    )
  }
  if (setup.failed) {
    return (
      <Titled>
        <RegionError
          message="Google’s numbers for this property couldn’t be loaded."
          onRetry={setup.retry}
          retrying={setup.retrying}
        />
      </Titled>
    )
  }
  if (setup.data === undefined) return <Pending />
  return (
    <Titled>
      <RatingGoalEmpty
        setup={setup.data}
        propertyId={propertyId}
        hasPortals={props.hasPortals}
        onStart={onStart}
      />
    </Titled>
  )
}
