// The Google section of the Goals page, first on it and apart from the Portal
// goals below (no shared numbers, ADR 0067). It shows one of: the simple card of
// the active goal, the goal the read just found reached or ended, or, with no
// goal, the door into the wizard or the reason there is none. A read that is on
// its way keeps the card's room; one that failed says so here and nowhere else.
import { useState } from 'react'
import type {
  RatingGoalCardView,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { RegionError } from '#/components/ui/region-error'
import { SectionTitle } from '#/components/ui/section-title'
import { Skeleton } from '#/components/ui/skeleton'
import { RatingGoalCard } from './rating-goal-card'
import { RatingGoalEmpty } from './rating-goal-empty'
import { RatingGoalOutcome } from './rating-goal-outcome'
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
  /** The card read, and when it was made (the day a goal was found reached). */
  card: RegionRead<RatingGoalCardView | null> & Readonly<{ readAt: Date }>
  /** Read only while there is no goal: the empty states and the wizard need it. */
  setup: RegionRead<RatingGoalSetupView>
  onStart: (intent: RatingGoalWizardIntent) => void
}>

type Outcome = Readonly<{ card: RatingGoalCardView; readAt: Date }>

/**
 * A goal the read found reached or ended is returned that once; the next read
 * has none. The section keeps showing it while the page is open, so a refetch
 * does not take the news away before it was read.
 */
function useHeldOutcome(card: Props['card']): Outcome | null {
  const [held, setHeld] = useState<Outcome | null>(null)
  const data = card.data
  if (data && data.state !== 'active' && held?.card.goalId !== data.goalId) {
    setHeld({ card: data, readAt: card.readAt })
  }
  return data?.state === 'active' ? null : held
}

const Pending = () => (
  <Skeleton
    aria-hidden="true"
    data-slot="rating-goal-pending"
    className="h-52 rounded-xl"
  />
)

/** The section's title where the card does not bring its own. */
const Titled = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <section aria-labelledby="google-rating-goal-title" className="flex flex-col gap-3">
    <SectionTitle id="google-rating-goal-title">Google rating goal</SectionTitle>
    {children}
  </section>
)

export function RatingGoalSection({
  propertyId,
  timezone,
  now,
  card,
  setup,
  onStart,
}: Props) {
  const outcome = useHeldOutcome(card)
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
  if (outcome !== null) {
    return (
      <RatingGoalOutcome {...outcome} timezone={timezone} now={now} onStart={onStart} />
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
      <RatingGoalEmpty setup={setup.data} propertyId={propertyId} onStart={onStart} />
    </Titled>
  )
}
