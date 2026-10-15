// The Google rating goal on the Property Overview, between the attention band
// and "How you are doing" (owner, 2026-10-14): the same simple card the Goals
// page draws, a goal reached or ended lately, or one line into the wizard
// (not after a manager chose "Not now"). Nothing else, and nothing at all where
// none of those applies (`overviewGoalView`).
import { Target } from 'lucide-react'
import type {
  RatingGoalCardView,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { RatingGoalCard } from './rating-goal-card'
import { RatingGoalOutcome } from './rating-goal-outcome'
import { overviewGoalView } from './rating-goal-overview-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

type Props = Readonly<{
  propertyId: string
  /** The Property's zone: a stale number's date is on its clock. */
  timezone: string
  now: Date
  /** Undefined while the card is read, or when its read failed. */
  card: RatingGoalCardView | null | undefined
  cardReadAt: Date
  setup: RatingGoalSetupView | undefined
  history: readonly RatingGoalHistoryEntry[] | undefined
  /** A manager chose "Not now" (the setup checklist); undefined until it is read. */
  notNowChosen: boolean | undefined
  onStart: (intent: RatingGoalWizardIntent) => void
}>

/** One line, one door: the wizard opens from it as from the Goals page. */
function RatingGoalPrompt({ onOpen }: Readonly<{ onOpen: () => void }>) {
  return (
    <section
      aria-label="Google rating goal"
      data-slot="rating-goal-prompt"
      className="flex items-center gap-2 rounded-lg border bg-card px-4 py-1 text-sm"
    >
      <Target aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <Button variant="link" className="px-0" onClick={onOpen}>
        Set your Google rating goal
      </Button>
    </section>
  )
}

export function RatingGoalOverview({
  propertyId,
  timezone,
  now,
  onStart,
  ...reads
}: Props) {
  const { can } = usePermissions()
  const view = overviewGoalView({ ...reads, canCreate: can('goal.create'), now })
  switch (view.kind) {
    case 'nothing':
      return null
    case 'card':
      return (
        <RatingGoalCard
          card={view.card}
          propertyId={propertyId}
          timezone={timezone}
          now={now}
        />
      )
    case 'outcome':
      return (
        <RatingGoalOutcome
          outcome={view.outcome}
          googleShowsNow={view.googleShowsNow}
          canSetNext={view.canSetNext}
          timezone={timezone}
          now={now}
          onStart={onStart}
        />
      )
    case 'prompt':
      return <RatingGoalPrompt onOpen={() => onStart(view.intent)} />
  }
}
