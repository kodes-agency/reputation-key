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
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import { goalKeys } from '#/shared/queries/query-keys'
import { withRatingGoalRefusals } from './rating-goal-refusal'
import type { RegionRead } from './rating-goal-section'
import { RatingGoalDone, RatingGoalKeepStep } from './rating-goal-wizard-done'
import { RatingGoalWizardFrame } from './rating-goal-wizard-frame'
import { RatingGoalClimbSteps, type ClimbStep } from './rating-goal-wizard-steps'
import { ratingText, reviewsText, tenthsText } from './rating-goal-view'
import {
  wizardReceipt,
  wizardSubmission,
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
}>

/** A server function as the page hands it in: called with its input, nothing more. */
type CommandOf<F extends (input: never) => unknown> = (
  input: Parameters<F>[0],
) => ReturnType<F>

type Step = ClimbStep | 'keep' | 'done'

const DESCRIPTIONS: Readonly<Record<Step, string>> = {
  goal: 'Step 1 of 2: the number you want Google to show.',
  pace: 'Step 2 of 2: how many new Google reviews a week you aim for.',
  keep: 'Watch that Google keeps showing the number it shows now.',
  done: 'You can change the target or the pace at any time.',
}

function titleOf(step: Step, intent: RatingGoalWizardIntent): string {
  if (step === 'goal') return 'Pick your goal'
  if (step === 'pace') return 'Pick your pace'
  if (step === 'done') return 'Your goal is set'
  return `Keep ${intent.kind === 'keep' ? tenthsText(intent.targetTenths) : ''} on Google`
}

/** The two commands, refusing in plain words and re-reading the goal when refused. */
function useRatingGoalCommands(props: RatingGoalWizardProps) {
  const queryClient = useQueryClient()
  const family = goalKeys.ratingGoal(props.propertyId)
  const reRead = () => void queryClient.invalidateQueries({ queryKey: family })
  const set = useActionMutation(withRatingGoalRefusals(props.setRatingGoalFn), {
    invalidateKeys: [family],
    onError: reRead,
  })
  const change = useActionMutation(withRatingGoalRefusals(props.changeRatingGoalFn), {
    successMessage: 'Google rating goal changed',
    invalidateKeys: [family],
    onError: reRead,
  })
  return { set, change }
}

/**
 * Where the wizard is and what saving does: the step (its title takes the
 * focus when it changes; the dialog focuses the first), the receipt the done
 * screen reads, and the save. A refusal stays on the mutation, which the
 * dialog's banner shows; the rejection is settled here so it is not reported
 * twice.
 */
function useWizardFlow(props: RatingGoalWizardProps) {
  const [step, setStep] = useState<Step>(props.intent.kind === 'keep' ? 'keep' : 'goal')
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
    } catch {
      // Held by the mutation: DialogErrorBanner says it above the actions.
    }
  }
  return {
    step,
    setStep,
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
      description={DESCRIPTIONS[flow.step]}
      titleRef={flow.titleRef}
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
          kept={tenthsText(intent.targetTenths)}
          googleLine={googleLine(setup.data)}
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
          pending={flow.pending}
          banner={banner}
          onSave={flow.save}
        />
      )}
    </RatingGoalWizardFrame>
  )
}

/** "Google shows 4.9 from 50 reviews". */
function googleLine(setup: RatingGoalSetupView): string | null {
  const google = setup.google
  if (google === null || google.shows === null) return null
  return `Google shows ${ratingText(google.shows)} from ${reviewsText(google.reviewCount)}`
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
        <DialogCancel />
      </DialogFooter>
    </>
  )
}
