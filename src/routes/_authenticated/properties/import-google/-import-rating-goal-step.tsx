// The Google import's last step for a single Property: the rating goal wizard,
// inside the setup frame, with "Not now" (ADR 0067, decisions 9, 10 and 13).
// It shows only once Google's numbers for the new Property are in and a goal can
// be set, for a manager who may set one; until then it says nothing and reads
// again now and then (Google's first numbers come with the first sync). "Not
// now" is the setup strip's own, so the strip does not remind again; a goal set
// here ends on "Go to goals".
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { RatingGoalWizardIntent } from '#/components/goals/rating-goal-wizard-view'
import {
  importRatingGoalOffer,
  waitsForGoogle,
} from '#/components/features/property-setup/setup-rating-goal-offer'
import { InlineLink } from '#/components/ui/inline-link'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import {
  ratingGoalCommands,
  ratingGoalSetupQuery,
} from '../$propertyId/goals/-rating-goal-queries'
import { regionRead } from '../$propertyId/goals/-rating-goal-wizard-host'
import { useRatingGoalNotNowAction } from '../$propertyId/goals/-rating-goal-not-now'

// The wizard is a chunk of its own, fetched only when it is offered.
const RatingGoalWizard = lazy(() =>
  import('#/components/goals/rating-goal-wizard').then((module) => ({
    default: module.RatingGoalWizard,
  })),
)

/** How often the step asks again while Google's first numbers are not in. */
const WAIT_FOR_GOOGLE_MS = 30_000

type Stage = 'offered' | 'set' | 'not_now'

/** What "Not now" leaves: one sentence, and the focus on it, where the step was. */
function NoGoalForNow({ propertyId }: Readonly<{ propertyId: string }>) {
  const sentence = useRef<HTMLParagraphElement>(null)
  useEffect(() => sentence.current?.focus(), [])
  return (
    <p
      ref={sentence}
      tabIndex={-1}
      className="text-sm text-muted-foreground outline-none"
    >
      No Google rating goal for now. You can set one on{' '}
      <InlineLink to="/properties/$propertyId/goals" params={{ propertyId }}>
        Goals
      </InlineLink>{' '}
      at any time.
    </p>
  )
}

export function ImportRatingGoalStep({ propertyId }: Readonly<{ propertyId: string }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage>('offered')
  const allowed = can('goal.create') && has('goal.use')
  const setup = useQuery({
    ...ratingGoalSetupQuery(propertyId),
    enabled: allowed && stage === 'offered',
    retry: false,
    refetchInterval: (query) =>
      waitsForGoogle(query.state.data) && query.state.status !== 'error'
        ? WAIT_FOR_GOOGLE_MS
        : false,
  })
  const notNow = useRatingGoalNotNowAction(propertyId)
  // Once offered, the wizard stays, on the intent it opened with, whatever the
  // setup reads after a save (it then has a goal, and offers none).
  const [intent, setIntent] = useState<RatingGoalWizardIntent | null>(null)
  const offer = importRatingGoalOffer(setup.data)
  if (intent === null && offer.kind === 'offer') setIntent(offer.intent)
  if (stage === 'not_now') return <NoGoalForNow propertyId={propertyId} />
  if (intent === null) return null
  const close = () => {
    if (stage === 'set') {
      void navigate({ to: '/properties/$propertyId/goals', params: { propertyId } })
      return
    }
    void notNow({ data: { propertyId } })
      .then(() => setStage('not_now'))
      .catch(() => undefined)
  }
  return (
    <Suspense fallback={null}>
      <RatingGoalWizard
        inline
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
        propertyId={propertyId}
        intent={intent}
        setup={regionRead(setup)}
        // A Property just imported has no Portal yet: the one next step is a first one.
        hasPortals={false}
        setRatingGoalFn={ratingGoalCommands.setRatingGoal}
        changeRatingGoalFn={ratingGoalCommands.changeRatingGoal}
        onSaved={() => setStage('set')}
      />
    </Suspense>
  )
}
