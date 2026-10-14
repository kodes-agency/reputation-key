// The two steps of a goal to climb, and what they hold between them: the target
// picked on step 1 and the pace picked on step 2. Going back keeps both. Enter in
// the pace field saves, as the "Set goal" button does.
import { useState, type FormEvent, type ReactNode } from 'react'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { BackButton } from '#/components/ui/back-link'
import { Button } from '#/components/ui/button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { RatingGoalPaceStep } from './rating-goal-pace-step'
import { RatingGoalTargetStep } from './rating-goal-target-step'
import {
  choiceForecast,
  customPaceProblem,
  openingPace,
  openingTarget,
  paceChoicePerWeek,
  stopAt,
  wizardSubmission,
  type PaceChoice,
  type RatingGoalWizardIntent,
  type SavedGoal,
  type WizardSubmission,
} from './rating-goal-wizard-view'

export type ClimbStep = 'goal' | 'pace'

type Props = Readonly<{
  setup: RatingGoalSetupView
  intent: RatingGoalWizardIntent
  propertyId: string
  step: ClimbStep
  onStep: (step: ClimbStep) => void
  pending: boolean
  /** The save's refusal, directly above the actions. */
  banner: ReactNode
  onSave: (submission: WizardSubmission, saved: SavedGoal) => Promise<void>
}>

/**
 * What the two steps hold between them, seeded once per opening: the target,
 * the pace choice and the number typed in. A re-read can move the stops under
 * an open wizard; the target then falls back to where the wizard would open now.
 */
function useClimbDraft(setup: RatingGoalSetupView, intent: RatingGoalWizardIntent) {
  const [target, setTarget] = useState(() => openingTarget(setup, intent))
  const [choice, setChoice] = useState<PaceChoice>(() => openingPace(setup, intent))
  const [customPace, setCustomPace] = useState(() => paceChoicePerWeek(setup, choice))
  const stop = stopAt(setup, target) ?? stopAt(setup, openingTarget(setup, intent))
  return { stop, setTarget, choice, setChoice, customPace, setCustomPace }
}

/** A Property with no higher tenth on offer: nothing to climb to. */
function NothingHigher({ banner }: Readonly<{ banner: ReactNode }>) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        There is no higher number to aim for right now.
      </p>
      {banner}
      <DialogFooter className="mt-auto">
        <DialogCancel>Close</DialogCancel>
      </DialogFooter>
    </>
  )
}

function ClimbFooter({
  step,
  intent,
  pending,
  canSave,
  onBack,
}: Readonly<{
  step: ClimbStep
  intent: RatingGoalWizardIntent
  pending: boolean
  canSave: boolean
  onBack: () => void
}>) {
  if (step === 'goal') {
    return (
      <DialogFooter className="mt-auto">
        <DialogCancel />
        <Button type="submit">Next</Button>
      </DialogFooter>
    )
  }
  return (
    <DialogFooter
      className="mt-auto"
      note={<BackButton label="Back to your goal" disabled={pending} onClick={onBack} />}
    >
      <Button type="submit" pending={pending} disabled={!canSave}>
        {intent.kind === 'change' ? 'Save changes' : 'Set goal'}
      </Button>
    </DialogFooter>
  )
}

export function RatingGoalClimbSteps({
  setup,
  intent,
  propertyId,
  step,
  onStep,
  pending,
  banner,
  onSave,
}: Props) {
  const draft = useClimbDraft(setup, intent)
  const { stop, choice } = draft
  if (stop === null) return <NothingHigher banner={banner} />
  const perWeek = paceChoicePerWeek(setup, choice)
  const invalidPace = choice.kind === 'custom' && customPaceProblem(perWeek) !== null
  const submission = wizardSubmission(intent, propertyId, stop.targetTenths, perWeek)
  const canSave = submission !== null && !invalidPace
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (step === 'goal') return onStep('pace')
    if (!canSave || submission === null || pending) return
    void onSave(submission, {
      mode: 'climb',
      targetTenths: stop.targetTenths,
      pacePerWeek: perWeek,
      forecast: choiceForecast(setup, stop, choice),
    })
  }
  return (
    <form className="flex flex-1 flex-col gap-4" onSubmit={submit} noValidate>
      {step === 'goal' ? (
        <RatingGoalTargetStep
          setup={setup}
          stop={stop}
          onTargetChange={draft.setTarget}
        />
      ) : (
        <RatingGoalPaceStep
          setup={setup}
          stop={stop}
          choice={choice}
          onChoiceChange={draft.setChoice}
          customPace={draft.customPace}
          onCustomPaceChange={draft.setCustomPace}
        />
      )}
      {banner}
      <ClimbFooter
        step={step}
        intent={intent}
        pending={pending}
        canSave={canSave}
        onBack={() => onStep('goal')}
      />
    </form>
  )
}
