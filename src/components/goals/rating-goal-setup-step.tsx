// The one screen of a goal to climb (rounds 3 and 4, E2 on a desktop, E4 on a
// phone): opened already answered with the recommendation, accepted in one tap
// ("Aim for 4.1") or adjusted. The number Google is to show, its ruler, when it
// arrives and what it needs, the status line, then the plan behind the number:
// the pace and the average new reviews are planned at. Everything is worked
// out here from the setup read's exact inputs and the draft, with no server
// call (`workOutRatingGoal`). Composition only: each part words itself.
import { useId, type FormEvent, type ReactNode } from 'react'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { workOutRatingGoal } from '#/contexts/reporting/application/rating-goal-setup-plan'
import { Button } from '#/components/ui/button'
import { DialogFooter } from '#/components/ui/dialog'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { RatingGoalAverageFact } from './rating-goal-average-fact'
import { RatingGoalGoalNumeral } from './rating-goal-goal-numeral'
import { paceText } from './rating-goal-pace-words'
import { RatingGoalPaceControl } from './rating-goal-pace-control'
import { RatingGoalRatingRuler } from './rating-goal-rating-ruler'
import * as steps from './rating-goal-setup-draft'
import { RatingGoalSetupPopovers } from './rating-goal-setup-popovers'
import {
  goalAriaLabels,
  goalSay,
  hintText,
  statusParts,
  type StatusAction,
} from './rating-goal-setup-status'
import { RatingGoalSetupStatusLine } from './rating-goal-setup-status-line'
import { likelyText, whenText } from './rating-goal-setup-time'
import { RatingGoalCancel } from './rating-goal-wizard-cancel'
import {
  wizardSubmission,
  type RatingGoalWizardIntent,
  type SavedGoal,
  type WizardSubmission,
} from './rating-goal-wizard-view'
import { formatNumber } from '#/lib/format'
import { tenthsText } from './rating-goal-view'

type Draft = steps.SetupDraft
type Plan = steps.SetupPlan

type Props = Readonly<{
  setup: RatingGoalSetupView
  intent: RatingGoalWizardIntent
  propertyId: string
  draft: Draft
  onDraft: (draft: Draft) => void
  pending: boolean
  /** The save's refusal, directly above the actions. */
  banner: ReactNode
  /** The phone's full-screen sheet: the mock's smaller sizes. */
  small: boolean
  onSave: (submission: WizardSubmission, saved: SavedGoal) => Promise<void>
}>

/** No goal to climb to: Google shows 4.9 or more, or its numbers are not in. */
function NothingToPlan({
  banner,
  message,
  way,
}: Readonly<{ banner: ReactNode; message: string; way: string }>) {
  return (
    <>
      <p className="text-sm text-muted-foreground">{message}</p>
      {banner}
      <DialogFooter className="mt-auto">
        <RatingGoalCancel>{way}</RatingGoalCancel>
      </DialogFooter>
    </>
  )
}

const NOTHING_HIGHER = 'There is no higher number to aim for right now.'

/** What saving sends, and what the done screen is told. */
function saveOf(props: Props, plan: Plan) {
  const submission = wizardSubmission(
    props.intent,
    props.propertyId,
    plan.goal.targetTenths,
    plan.pace.tenthsPerWeek,
    plan.average.tenths,
  )
  const saved: SavedGoal = {
    mode: 'climb',
    targetTenths: plan.goal.targetTenths,
    paceTenthsPerWeek: plan.pace.tenthsPerWeek,
    days: plan.days,
    likely: plan.likely,
  }
  return { submission, saved }
}

/** The status line's links: the faster pace keeps the goal it named (D31). */
function actionOf(props: Props, plan: Plan, action: StatusAction): Draft {
  const { draft, setup } = props
  if (action.kind === 'recommended') return steps.backToRecommended(draft)
  const atChip =
    setup.setupInputs === null
      ? null
      : workOutRatingGoal(
          setup.setupInputs,
          steps.choicesOf({
            ...draft,
            pace: { kind: 'chip', index: action.chipIndex },
            pin: undefined,
          }),
        )
  const recommended =
    atChip?.kind === 'plan' ? atChip.goal.recommendedTenths : plan.goal.targetTenths
  return steps.takeFasterPace(draft, action.chipIndex, action.pinTenths, recommended)
}

function Headline({ props, plan }: Readonly<{ props: Props; plan: Plan }>) {
  const { draft, onDraft, small } = props
  const unit = draft.unit ?? 'day'
  const labels = goalAriaLabels(plan)
  const parts = statusParts(plan, draft, unit)
  const say = goalSay(plan, unit)
  // Full width, so the ruler keeps the mock's fixed width (its inline maxWidth)
  // instead of the widest line's, and never resizes as − / + change the lines.
  return (
    <div className="flex w-full flex-col items-center text-center">
      <RatingGoalGoalNumeral
        targetTenths={plan.goal.targetTenths}
        minTenths={plan.goal.minTenths}
        maxTenths={plan.goal.maxTenths}
        labels={labels}
        say={say}
        live={hintText(plan, draft) ?? say}
        small={small}
        onLower={() => onDraft(steps.lowerGoal(draft, plan))}
        onRaise={() => onDraft(steps.raiseGoal(draft, plan))}
        onGoTo={(tenths) => onDraft(steps.goToGoal(draft, plan, tenths))}
      />
      <RatingGoalRatingRuler
        shownTenths={plan.goal.shownTenths}
        targetTenths={plan.goal.targetTenths}
        small={small}
      />
      <p
        className={cn('font-semibold', plan.overSixMonths && TONE_INK.warn)}
        style={{ fontSize: small ? 21 : 26, marginTop: small ? 2 : 8 }}
      >
        {whenText(plan.days)}
      </p>
      <p className={cn('text-muted-foreground', small ? 'px-2 text-xs' : 'text-sm')}>
        <span className="font-mono font-medium text-foreground">
          {formatNumber(plan.reviewsNeeded)}
        </span>{' '}
        new reviews at {paceText(plan.pace.tenthsPerWeek, unit)} · likely{' '}
        {likelyText(plan.likely)}
      </p>
      <RatingGoalSetupStatusLine
        parts={parts}
        small={small}
        onAction={(action) => onDraft(actionOf(props, plan, action))}
      />
    </div>
  )
}

function PlanBehind({ props, plan }: Readonly<{ props: Props; plan: Plan }>) {
  const { draft, onDraft, small } = props
  const id = useId()
  return (
    <section
      aria-label="The plan behind the number"
      className={cn(
        'flex w-full flex-col rounded-xl bg-muted',
        small ? 'px-4 py-3' : 'px-6 py-4',
      )}
      style={{ maxWidth: 620 }}
    >
      <RatingGoalPaceControl
        plan={plan}
        unit={draft.unit ?? 'day'}
        ownOn={draft.pace?.kind === 'own'}
        message={draft.paceMessage}
        idBase={id}
        small={small}
        onUnit={(unit) => onDraft(steps.setUnit(draft, unit))}
        onChip={(index) => onDraft(steps.chooseChip(draft, index))}
        onToggleOwn={() => onDraft(steps.toggleOwnPace(draft, plan))}
        onTypeOwn={(raw) => onDraft(steps.typeOwnPace(draft, draft.unit ?? 'day', raw))}
      />
      <RatingGoalAverageFact
        plan={plan}
        ownOn={draft.ownAverageTenths !== undefined || plan.average.ownOnly}
        message={draft.averageMessage}
        idBase={id}
        onChange={() => onDraft(steps.toggleOwnAverage(draft, plan))}
        onBackToAutomatic={() => onDraft(steps.backToAutomatic(draft))}
        onTypeOwn={(raw) => onDraft(steps.typeOwnAverage(draft, plan, raw))}
      />
    </section>
  )
}

export function RatingGoalSetupStep(props: Props) {
  const { setup, draft, pending, banner, intent, small } = props
  const id = useId()
  const inputs = setup.setupInputs
  if (inputs === null) {
    return <NothingToPlan banner={banner} message={NOTHING_HIGHER} way="Close" />
  }
  const view = workOutRatingGoal(inputs, steps.choicesOf(draft))
  if (view.kind === 'keep_only') {
    return <NothingToPlan banner={banner} message={NOTHING_HIGHER} way="Close" />
  }
  if (view.kind === 'catching_up') {
    return (
      <NothingToPlan
        banner={banner}
        way="Not now"
        message={`Google should show ${tenthsText(view.earnedTenths)} soon. Its number can take up to two weeks to catch up; set your goal once it does.`}
      />
    )
  }
  const { submission, saved } = saveOf(props, view)
  const unchanged = intent.kind === 'change' && submission === null
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submission === null || pending) return
    void props.onSave(submission, saved)
  }
  return (
    <form
      className="flex flex-1 flex-col items-center gap-3"
      onSubmit={submit}
      noValidate
    >
      <Headline props={props} plan={view} />
      <PlanBehind props={props} plan={view} />
      <div
        className={cn(
          'flex flex-wrap items-center justify-center gap-x-2 text-center text-sm text-muted-foreground',
          small && 'text-xs',
        )}
      >
        {small ? null : (
          <span>We count new Google reviews every week, Monday to Sunday.</span>
        )}
        <RatingGoalSetupPopovers
          plan={view}
          inputs={inputs}
          unit={draft.unit ?? 'day'}
          open={draft.open}
          small={small}
          onToggle={(which) => props.onDraft(steps.togglePopover(draft, which))}
        />
      </div>
      {banner}
      <DialogFooter
        className="mt-auto w-full"
        note={
          intent.kind === 'change' ? (
            <p id={`${id}-unchanged`}>{unchanged ? 'Change the plan to save.' : null}</p>
          ) : undefined
        }
      >
        <RatingGoalCancel />
        <Button
          type="submit"
          pending={pending}
          disabled={submission === null}
          aria-describedby={unchanged ? `${id}-unchanged` : undefined}
        >
          {intent.kind === 'change'
            ? 'Save changes'
            : `Aim for ${tenthsText(view.goal.targetTenths)}`}
        </Button>
      </DialogFooter>
    </form>
  )
}
