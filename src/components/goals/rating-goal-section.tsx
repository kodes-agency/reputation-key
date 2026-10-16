// The Google section of the Goals page, first on it and apart from the Portal
// goals below (no shared numbers, ADR 0067). It shows one of: the simple card of
// the active goal; a goal reached, or ended by something other than a manager,
// while it is news (from the read that found it, or from History when the
// snapshot consumer got there first); or, with no goal, the door into the
// wizard or the reason there is none. A read that is on its way keeps the
// card's room; one that failed says so here and nowhere else.
import type {
  RatingGoalCardView,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { RegionError } from '#/components/ui/region-error'
import { SectionTitle } from '#/components/ui/section-title'
import { Skeleton } from '#/components/ui/skeleton'
import { RatingGoalCard } from './rating-goal-card'
import { RATING_GOAL_HEADING_ID } from './rating-goal-card-header'
import { RatingGoalEmpty } from './rating-goal-empty'
import { RatingGoalOutcome } from './rating-goal-outcome'
import {
  outcomeFromCard,
  recentOutcome,
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
}>

/**
 * The climb card's height, so the read that fills it moves nothing (CLS),
 * measured in the stories (2026-10-16, D4's short card on a phone): 386px at
 * 320px, 340px from 390px until the card turns wide at a 768px viewport, and
 * 312px on a desktop. The first term follows the small phones, the second
 * holds 340px below 768px and drops out above it.
 */
const PENDING_HEIGHT =
  'max(clamp(312px, calc(596px - 65.7vw), 386px), min(340px, calc((768px - 100vw) * 1000)))'

const Pending = () => (
  <Skeleton
    aria-hidden="true"
    data-slot="rating-goal-pending"
    className="rounded-xl"
    style={{ minHeight: PENDING_HEIGHT }}
  />
)

/** The section's title where the card does not bring its own. */
const Titled = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <section aria-labelledby={RATING_GOAL_HEADING_ID} className="flex flex-col gap-3">
    <SectionTitle id={RATING_GOAL_HEADING_ID} tabIndex={-1} className="outline-none">
      Google rating goal
    </SectionTitle>
    {children}
  </section>
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
    return outcomeFromCard(card.data, card.readAt)
  }
  if (history.data === undefined && !history.failed) return undefined
  return recentOutcome(history.data, now)
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
      <RatingGoalCard
        card={card.data}
        propertyId={propertyId}
        timezone={timezone}
        now={now}
      />
    )
  }
  const outcome = outcomeOf(card, props.history, now)
  if (outcome === undefined) return <Pending />
  if (outcome !== null) {
    return (
      <RatingGoalOutcome
        outcome={outcome}
        googleShowsNow={setup.data?.google?.shows ?? null}
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
