// The Google rating goal wizard (ADR 0067, decision 9; rounds 3 and 4, E2/E4):
// "Your Google goal", one screen opened already answered, then "Your goal is
// set"; or, for a goal that keeps the number Google shows (offered first only
// at 4.9 or 5.0), one step. A change opens the screen on the goal's own plan,
// saves only what differs against the version it was opened on, and closes
// with a toast.
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
import { useIsMobile } from '#/components/hooks/use-mobile'
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
import { draftFromGoal, type SetupDraft } from './rating-goal-setup-draft'
import { RatingGoalSetupStep } from './rating-goal-setup-step'
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
  /** Named in the header of the setup screen, when the page knows it. */
  propertyName?: string
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

type Step = 'plan' | 'keep' | 'done'

function titleOf(step: Step, intent: RatingGoalWizardIntent): string {
  if (step === 'plan') return 'Your Google goal'
  if (step === 'done') return 'Your goal is set'
  return `Keep ${intent.kind === 'keep' ? tenthsText(intent.targetTenths) : ''} on Google`
}

/**
 * What the done screen says can come next, for the goal just set. A goal to
 * keep is set only at 4.9 or 5.0 (R2-9), where there is nothing higher to aim
 * for: it can only be ended.
 */
function doneDescription(intent: RatingGoalWizardIntent): string {
  return intent.kind === 'keep'
    ? 'You can end it at any time.'
    : 'You can change the plan at any time.'
}

/**
 * What the screen starts from, in one sentence: the Property for the setup
 * screen (what Google shows when its name is not known); the keep step's is
 * the whole step.
 */
function descriptionOf(
  step: Step,
  intent: RatingGoalWizardIntent,
  setup?: RatingGoalSetupView,
  propertyName?: string,
): string {
  switch (step) {
    case 'plan': {
      if (propertyName !== undefined) return propertyName
      const google = setup?.google
      return google === undefined || google === null || google.shows === null
        ? 'The number you want Google to show, and how to get there.'
        : `Google shows ${ratingText(google.shows)} from ${reviewsText(google.reviewCount)}.`
    }
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
  const [step, setStep] = useState<Step>(props.intent.kind === 'keep' ? 'keep' : 'plan')
  const [draft, setDraft] = useState<SetupDraft | null>(null)
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
    draft,
    setDraft,
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
    submission: wizardSubmission(intent, propertyId, intent.targetTenths, null, null),
    saved: {
      mode: 'keep',
      targetTenths: intent.targetTenths,
      paceTenthsPerWeek: null,
      days: null,
      likely: null,
    },
  }
}

export function RatingGoalWizard(props: RatingGoalWizardProps) {
  const { intent, setup, propertyId } = props
  const flow = useWizardFlow(props)
  const small = useIsMobile()
  const banner = <DialogErrorBanner error={flow.error} />
  return (
    <RatingGoalWizardFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={flow.pending}
      title={titleOf(flow.step, intent)}
      description={descriptionOf(flow.step, intent, setup.data, props.propertyName)}
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
        <RatingGoalSetupStep
          setup={setup.data}
          intent={intent}
          propertyId={propertyId}
          draft={flow.draft ?? openingDraft(intent, setup.data)}
          onDraft={flow.setDraft}
          pending={flow.pending}
          banner={banner}
          small={small}
          onSave={flow.save}
        />
      )}
    </RatingGoalWizardFrame>
  )
}

/** A change opens on the goal's own plan; a new goal as recommended. */
function openingDraft(
  intent: RatingGoalWizardIntent,
  setup: RatingGoalSetupView,
): SetupDraft {
  if (intent.kind !== 'change' || setup.setupInputs === null) return {}
  return draftFromGoal(setup.setupInputs, intent.goal)
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
