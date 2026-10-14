// The two steps of a goal to climb. What they hold between them (the target
// picked on step 1, the pace picked on step 2) is the wizard's draft, held above
// the frame: going back keeps both, and so does a phone turned to landscape.
// Enter in the pace field saves, as the "Set goal" button does.
import type { FormEvent, ReactNode } from 'react'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { BackButton } from '#/components/ui/back-link'
import { Button } from '#/components/ui/button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { RatingGoalPaceStep } from './rating-goal-pace-step'
import { RatingGoalTargetStep } from './rating-goal-target-step'
import {
  choiceForecast,
  customPaceProblem,
  paceChoicePerWeek,
  resolveClimbDraft,
  wizardSubmission,
  type ClimbDraft,
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
  /** What has been picked so far, and how a pick is added to it. */
  draft: ClimbDraft
  onDraft: (pick: ClimbDraft) => void
  pending: boolean
  /** The save's refusal, directly above the actions. */
  banner: ReactNode
  onSave: (submission: WizardSubmission, saved: SavedGoal) => Promise<void>
}>

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
  draft,
  onDraft,
  pending,
  banner,
  onSave,
}: Props) {
  const { stop, choice, customPace } = resolveClimbDraft(setup, intent, draft)
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
          onTargetChange={(target) => onDraft({ target })}
        />
      ) : (
        <RatingGoalPaceStep
          setup={setup}
          stop={stop}
          choice={choice}
          onChoiceChange={(next) => onDraft({ choice: next })}
          customPace={customPace}
          onCustomPaceChange={(next) => onDraft({ customPace: next })}
        />
      )}
      {step === 'pace' && intent.kind === 'change' && submission === null ? (
        <p className="text-sm text-muted-foreground">
          Change the goal or the pace to save.
        </p>
      ) : null}
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
