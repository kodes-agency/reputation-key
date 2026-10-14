// The Google import's last step for a single Property: the rating goal wizard,
// inside the setup frame, with "Not now" (ADR 0067, decisions 9, 10 and 13).
// It shows only once the setup read says a goal can be set; until then it
// draws nothing, and the route reads again now and then (Google's first numbers
// come with the first sync). It appears below results the user has finished
// with, so a polite status line says so for anyone not looking there. "Not now"
// is the setup strip's own, so the strip does not remind again; a goal set here
// ends on "Go to goals".
//
// The commands come in from the route (`-import-rating-goal-step.tsx`), which
// also decides whether the viewer may set a goal at all.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import type { RegionRead } from '#/components/goals/rating-goal-section'
import type { RatingGoalWizardProps } from '#/components/goals/rating-goal-wizard'
import type { RatingGoalWizardIntent } from '#/components/goals/rating-goal-wizard-view'
import { InlineLink } from '#/components/ui/inline-link'
import { importRatingGoalOffer } from './setup-rating-goal-offer'

// The wizard is a chunk of its own, fetched only when it is offered.
const RatingGoalWizard = lazy(() =>
  import('#/components/goals/rating-goal-wizard').then((module) => ({
    default: module.RatingGoalWizard,
  })),
)

type Stage = 'offered' | 'set' | 'not_now'

export type SetupRatingGoalStepProps = Readonly<{
  propertyId: string
  /** The goal's setup read: the wizard is offered once it says a goal can be set. */
  setup: RegionRead<RatingGoalSetupView>
  setRatingGoalFn: RatingGoalWizardProps['setRatingGoalFn']
  changeRatingGoalFn: RatingGoalWizardProps['changeRatingGoalFn']
  /** Records "Not now". A rejection keeps the step: the command says it failed. */
  onNotNow: () => Promise<unknown>
  /** After a goal is set: on to the Goals page. */
  onGoToGoals: () => void
}>

/** Said once, politely, when the step appears below the finished setup. */
export const RATING_GOAL_STEP_APPEARED = 'You can now set a Google rating goal.'

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

export function SetupRatingGoalStep({
  propertyId,
  setup,
  setRatingGoalFn,
  changeRatingGoalFn,
  onNotNow,
  onGoToGoals,
}: SetupRatingGoalStepProps) {
  const [stage, setStage] = useState<Stage>('offered')
  // Once offered, the wizard stays, on the intent it opened with, whatever the
  // setup reads after a save (it then has a goal, and offers none).
  const [intent, setIntent] = useState<RatingGoalWizardIntent | null>(null)
  const offer = importRatingGoalOffer(setup.data)
  if (intent === null && offer.kind === 'offer') setIntent(offer.intent)
  const close = () => {
    if (stage === 'set') return onGoToGoals()
    void onNotNow()
      .then(() => setStage('not_now'))
      .catch(() => undefined)
  }
  // The status line is there from the first render, so the sentence it gains
  // when the step appears is announced.
  return (
    <>
      <p role="status" className="sr-only">
        {intent !== null && stage === 'offered' ? RATING_GOAL_STEP_APPEARED : ''}
      </p>
      {stage === 'not_now' ? (
        <NoGoalForNow propertyId={propertyId} />
      ) : intent === null ? null : (
        <Suspense fallback={null}>
          <RatingGoalWizard
            inline
            open
            onOpenChange={(open) => {
              if (!open) close()
            }}
            propertyId={propertyId}
            intent={intent}
            setup={setup}
            // A Property just imported has no Portal yet: the one next step is a first one.
            hasPortals={false}
            setRatingGoalFn={setRatingGoalFn}
            changeRatingGoalFn={changeRatingGoalFn}
            onSaved={() => setStage('set')}
          />
        </Suspense>
      )}
    </>
  )
}
