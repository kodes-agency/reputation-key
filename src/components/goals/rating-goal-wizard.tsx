// The Google rating goal wizard (ADR 0067, decisions 9 and 10): "Pick your
// goal", "Pick your pace", then "Your goal is set"; or, for a goal that keeps
// the number Google shows, one step. A change opens it on the goal's own target
// and pace, saves only what differs against the version it was opened on, and
// closes with a toast.
//
// A component with its two commands (set and change): the route hands in the
// server functions and this owns the mutations, as the month target dialog
// does. A refusal is said once, in the dialog's banner, in plain words
// (`rating-goal-refusal.ts`), and re-reads the goal: a refusal usually means the
// page is behind.
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  changeRatingGoal,
  setRatingGoal,
} from '#/contexts/reporting/server/rating-goals'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { DialogFooter } from '#/components/ui/dialog'
import { RatingGoalCancel } from './rating-goal-wizard-cancel'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import { dashboardKeys, goalKeys, propertyKeys } from '#/shared/queries/query-keys'
import { withRatingGoalRefusals } from './rating-goal-refusal'
import type { RegionRead } from './rating-goal-section'
import { RatingGoalDone, RatingGoalKeepStep } from './rating-goal-wizard-done'
import { RatingGoalWizardFrame } from './rating-goal-wizard-frame'
import { RatingGoalClimbSteps, type ClimbStep } from './rating-goal-wizard-steps'
import { tenthsText } from './rating-goal-view'
import {
  wizardReceipt,
  wizardSubmission,
  type ClimbDraft,
  type RatingGoalReceipt,
  type RatingGoalWizardIntent,
  type SavedGoal,
  type WizardSubmission,
} from './rating-goal-wizard-view'

export type RatingGoalWizardProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyId: string
  intent: RatingGoalWizardIntent
  setup: RegionRead<RatingGoalSetupView>
  /** The done screen offers portal goals when there are Portals, a Portal when not. */
  hasPortals: boolean
  setRatingGoalFn: CommandOf<typeof setRatingGoal>
  changeRatingGoalFn: CommandOf<typeof changeRatingGoal>
  /** Where the focus goes when the wizard closes: the page knows what opened it. */
  onCloseAutoFocus?: (event: Event) => void
  /**
   * Inside the Google import's setup frame instead of a dialog (decision 10):
   * every step's way out reads "Not now" and closes it as `onOpenChange(false)`.
   */
  inline?: boolean
  /** A goal was set: the done screen is on, and its way out goes on from there. */
  onSaved?: () => void
}>

/** A server function as the page hands it in: called with its input, nothing more. */
type CommandOf<F extends (input: never) => unknown> = (
  input: Parameters<F>[0],
) => ReturnType<F>

type Step = ClimbStep | 'keep' | 'done'

function titleOf(step: Step, intent: RatingGoalWizardIntent): string {
  if (step === 'goal')
    return intent.kind === 'change' ? 'Change your goal' : 'Pick your goal'
  if (step === 'pace') return 'Pick your pace'
  if (step === 'done') return 'Your goal is set'
  return `Keep ${intent.kind === 'keep' ? tenthsText(intent.targetTenths) : ''} on Google`
}

/** Nothing is higher than 5.0: a goal that keeps it can only be ended. */
const PERFECT_TENTHS = 50

/** What the done screen says can come next, for the goal just set. */
function doneDescription(intent: RatingGoalWizardIntent): string {
  if (intent.kind !== 'keep') return 'You can change the target or the pace at any time.'
  return intent.targetTenths < PERFECT_TENTHS
    ? 'You can aim higher at any time.'
    : 'You can end it at any time.'
}

/**
 * What the screen is for, in one sentence; the keep step's is the whole step.
 * Inside the Google import's setup frame there is no "Step 1 of 2": the setup
 * already counts its own steps on the same screen, and two counters read as
 * one sequence that contradicts itself.
 */
function descriptionOf(
  step: Step,
  intent: RatingGoalWizardIntent,
  inline: boolean,
): string {
  switch (step) {
    case 'goal':
      return inline
        ? 'The number you want Google to show.'
        : 'Step 1 of 2: the number you want Google to show.'
    case 'pace':
      return inline
        ? 'How many new Google reviews a week you aim for.'
        : 'Step 2 of 2: how many new Google reviews a week you aim for.'
    case 'keep':
      return `We’ll watch that Google keeps showing ${intent.kind === 'keep' ? tenthsText(intent.targetTenths) : 'its number'}.`
    case 'done':
      return doneDescription(intent)
  }
}

/**
 * The two commands, refusing in plain words and re-reading the goal when
 * refused. A goal set or changed also moves the Property's setup step and its
 * Properties list cell, so those are read again too.
 */
function useRatingGoalCommands(props: RatingGoalWizardProps) {
  const queryClient = useQueryClient()
  const family = goalKeys.ratingGoal(props.propertyId)
  const reRead = () => void queryClient.invalidateQueries({ queryKey: family })
  const refreshed = [
    family,
    propertyKeys.setup(props.propertyId),
    propertyKeys.setupSummaries(),
    dashboardKeys.fleets(),
  ]
  const set = useActionMutation(withRatingGoalRefusals(props.setRatingGoalFn), {
    invalidateKeys: refreshed,
    onError: reRead,
  })
  const change = useActionMutation(withRatingGoalRefusals(props.changeRatingGoalFn), {
    successMessage: 'Google rating goal changed',
    invalidateKeys: refreshed,
    onError: reRead,
  })
  return { set, change }
}

/**
 * Where the wizard is and what saving does: the step (its title takes the
 * focus when it changes; the dialog focuses the first), what has been picked
 * so far, the receipt the done screen reads, and the save. All of it sits
 * above the frame, which swaps the sheet for the dialog when a phone turns. A
 * refusal stays on the mutation, which the dialog's banner shows; the
 * rejection is settled here so it is not reported twice.
 */
function useWizardFlow(props: RatingGoalWizardProps) {
  const [step, setStep] = useState<Step>(props.intent.kind === 'keep' ? 'keep' : 'goal')
  const [draft, setDraft] = useState<ClimbDraft>({})
  const [receipt, setReceipt] = useState<RatingGoalReceipt | null>(null)
  const { set, change } = useRatingGoalCommands(props)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const opening = useRef(step)
  useEffect(() => {
    if (step !== opening.current) titleRef.current?.focus()
  }, [step])
  const save = async (submission: WizardSubmission, saved: SavedGoal) => {
    try {
      if (submission.kind === 'change') {
        await change({ data: submission.data })
        props.onOpenChange(false)
        return
      }
      await set({ data: submission.data })
      setReceipt(wizardReceipt(saved))
      setStep('done')
      props.onSaved?.()
    } catch {
      // Held by the mutation: DialogErrorBanner says it above the actions.
    }
  }
  return {
    step,
    setStep,
    draft,
    addToDraft: (pick: ClimbDraft) => setDraft((current) => ({ ...current, ...pick })),
    receipt,
    titleRef,
    save,
    pending: set.isPending || change.isPending,
    error: set.error ?? change.error,
  }
}

/** Keeping a tenth: what is sent, and what the done screen says. */
function keepSave(
  intent: Extract<RatingGoalWizardIntent, { kind: 'keep' }>,
  propertyId: string,
): Readonly<{ submission: WizardSubmission | null; saved: SavedGoal }> {
  return {
    submission: wizardSubmission(intent, propertyId, intent.targetTenths, null),
    saved: {
      mode: 'keep',
      targetTenths: intent.targetTenths,
      pacePerWeek: null,
      forecast: null,
    },
  }
}

export function RatingGoalWizard(props: RatingGoalWizardProps) {
  const { intent, setup, propertyId } = props
  const flow = useWizardFlow(props)
  const banner = <DialogErrorBanner error={flow.error} />
  return (
    <RatingGoalWizardFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={flow.pending}
      title={titleOf(flow.step, intent)}
      description={descriptionOf(flow.step, intent, props.inline === true)}
      titleRef={flow.titleRef}
      onCloseAutoFocus={props.onCloseAutoFocus}
      inline={props.inline}
    >
      {flow.step === 'done' && flow.receipt !== null ? (
        <RatingGoalDone
          receipt={flow.receipt}
          propertyId={propertyId}
          hasPortals={props.hasPortals}
        />
      ) : setup.data === undefined ? (
        <SetupPending setup={setup} />
      ) : intent.kind === 'keep' ? (
        <RatingGoalKeepStep
          pending={flow.pending}
          banner={banner}
          onStart={() => {
            const { submission, saved } = keepSave(intent, propertyId)
            if (submission !== null) void flow.save(submission, saved)
          }}
        />
      ) : (
        <RatingGoalClimbSteps
          setup={setup.data}
          intent={intent}
          propertyId={propertyId}
          step={flow.step === 'pace' ? 'pace' : 'goal'}
          onStep={flow.setStep}
          draft={flow.draft}
          onDraft={flow.addToDraft}
          pending={flow.pending}
          banner={banner}
          onSave={flow.save}
        />
      )}
    </RatingGoalWizardFrame>
  )
}

/** While the setup reads: the room the step will take, or its failure and "Try again". */
function SetupPending({ setup }: Readonly<{ setup: RegionRead<RatingGoalSetupView> }>) {
  return (
    <>
      {setup.failed ? (
        <RegionError
          size="compact"
          message="Google’s numbers for this property couldn’t be loaded."
          onRetry={setup.retry}
          retrying={setup.retrying}
        />
      ) : (
        <Skeleton aria-hidden="true" className="h-64 rounded-lg" />
      )}
      <DialogFooter className="mt-auto">
        <RatingGoalCancel />
      </DialogFooter>
    </>
  )
}
