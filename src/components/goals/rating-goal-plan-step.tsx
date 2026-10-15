// "Pick a plan", the one step of a goal to climb (round 2, R2-6 to R2-12): the
// quality every plan assumes and its "Change", three plans (and "Your plan" for
// a change), the policy line, and "Build your own", which is the plan being set
// while it is open. What is picked is the wizard's draft, held above the frame,
// so a phone turned to landscape keeps it. Enter in a number saves, as the
// button does. The frame opens with the focus on the checked plan.
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type {
  RatingGoalForecastInputs,
  RatingGoalPlanningView,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { DialogFooter } from '#/components/ui/dialog'
import { cn } from '#/lib/utils'
import { ownPreview } from './rating-goal-build-own-view'
import { RatingGoalBuildOwn } from './rating-goal-build-own'
import { QUIET } from './rating-goal-option'
import { RatingGoalPlanCards } from './rating-goal-plan-cards'
import {
  closeOwn,
  openOwn,
  ownValues,
  pickCard,
  PLAN_POLICY_LINE,
  qualityAssumption,
  resolvePlanDraft,
  type PlanDraft,
  type ResolvedPlan,
} from './rating-goal-plan-view'
import { RatingGoalCancel } from './rating-goal-wizard-cancel'
import {
  wizardSubmission,
  type RatingGoalWizardIntent,
  type SavedGoal,
  type WizardSubmission,
} from './rating-goal-wizard-view'

type Props = Readonly<{
  setup: RatingGoalSetupView
  intent: RatingGoalWizardIntent
  propertyId: string
  draft: PlanDraft
  onDraft: (draft: PlanDraft) => void
  pending: boolean
  /** The save's refusal, directly above the actions. */
  banner: ReactNode
  onSave: (submission: WizardSubmission, saved: SavedGoal) => Promise<void>
}>

/** A Property with nothing to plan for: no higher tenth, or no numbers to plan with. */
function NothingToPlan({ banner }: Readonly<{ banner: ReactNode }>) {
  return (
    <>
      <p className={QUIET}>There is no higher number to aim for right now.</p>
      {banner}
      <DialogFooter className="mt-auto">
        <RatingGoalCancel>Close</RatingGoalCancel>
      </DialogFooter>
    </>
  )
}

/** The checked radio of a row, or its first, takes the focus. */
function focusRow(group: HTMLDivElement | null): void {
  const radio =
    group?.querySelector<HTMLElement>('[role="radio"][data-state="checked"]') ??
    group?.querySelector<HTMLElement>('[role="radio"]')
  radio?.focus()
}

/**
 * "Change" moves the focus to the average row once Build your own has drawn
 * it: the request waits in a ref for the render that brings the row, so a
 * frame swapped by a turned phone (a fresh step) does not take the focus again.
 */
function useFocusQualityRow() {
  const qualityRef = useRef<HTMLDivElement>(null)
  const requested = useRef(false)
  useEffect(() => {
    if (!requested.current || qualityRef.current === null) return
    requested.current = false
    focusRow(qualityRef.current)
  })
  return {
    qualityRef,
    request: () => {
      if (qualityRef.current === null) requested.current = true
      else focusRow(qualityRef.current)
    },
  }
}

/** What saving sends and what the done screen is told, or null while it cannot save. */
function chosenPlan(
  props: Props,
  inputs: RatingGoalForecastInputs,
  resolved: ResolvedPlan,
) {
  const card = resolved.cards.find((each) => each.key === resolved.checked)
  const preview = ownPreview(inputs, resolved.own)
  const values = resolved.ownOpen ? ownValues(resolved.own) : card?.values
  const forecast = resolved.ownOpen
    ? preview.valid
      ? preview.forecast
      : null
    : (card?.forecast ?? null)
  const valid = resolved.ownOpen ? preview.valid : values !== undefined
  const submission =
    values === undefined || !valid
      ? null
      : wizardSubmission(
          props.intent,
          props.propertyId,
          values.targetTenths,
          values.pacePerWeek,
          values.qualityTenths,
        )
  return { preview, values, forecast, valid, submission }
}

export function RatingGoalPlanStep(props: Props) {
  const { setup, draft, onDraft, pending, banner, intent } = props
  const id = useId()
  const focusQuality = useFocusQualityRow()
  const planning: RatingGoalPlanningView | null = setup.planning
  const inputs = setup.forecastInputs
  const resolved =
    planning === null ? null : resolvePlanDraft(setup, planning, intent, draft)
  if (planning === null || inputs === null || resolved === null) {
    return <NothingToPlan banner={banner} />
  }
  const chosen = chosenPlan(props, inputs, resolved)
  const unchanged = intent.kind === 'change' && chosen.valid && chosen.submission === null
  const changeQuality = () => {
    onDraft(openOwn(draft, resolved))
    focusQuality.request()
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const { submission, values } = chosen
    if (submission === null || values === undefined || pending) return
    void props.onSave(submission, {
      mode: 'climb',
      targetTenths: values.targetTenths,
      pacePerWeek: values.pacePerWeek,
      forecast: chosen.forecast,
    })
  }
  return (
    <form className="flex flex-1 flex-col gap-4" onSubmit={submit} noValidate>
      <p className="text-sm">
        <span id={`${id}-quality`}>{qualityAssumption(planning)}</span>{' '}
        {/* "· Change" is a link in the line, kept together, so a narrow screen
            breaks before the dot and never leaves it hanging at a line's end. */}
        <span className="whitespace-nowrap">
          <span aria-hidden="true" className="text-muted-foreground">
            ·{' '}
          </span>
          <Button
            type="button"
            variant="link"
            size="inline"
            aria-describedby={`${id}-quality`}
            onClick={changeQuality}
          >
            Change
          </Button>
        </span>
      </p>
      <RatingGoalPlanCards
        cards={resolved.cards}
        checked={resolved.checked}
        onPick={(key) => onDraft(pickCard(draft, key))}
        describedBy={`${id}-quality`}
      />
      <p className={QUIET}>{PLAN_POLICY_LINE}</p>
      <Collapsible
        open={resolved.ownOpen}
        onOpenChange={(open) =>
          onDraft(open ? openOwn(draft, resolved) : closeOwn(draft))
        }
        className={cn(
          'rounded-lg border',
          resolved.ownOpen && 'border-primary bg-primary/5',
        )}
      >
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="group w-full justify-between">
            Build your own
            <ChevronDown
              aria-hidden="true"
              className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <p className={cn(QUIET, 'mb-4')}>
            Pick each part yourself. While this is open, it is the plan you set.
          </p>
          <RatingGoalBuildOwn
            setup={setup}
            planning={planning}
            inputs={inputs}
            own={resolved.own}
            onOwn={(own) => onDraft({ ...draft, own })}
            preview={chosen.preview}
            qualityRef={focusQuality.qualityRef}
            idBase={id}
          />
        </CollapsibleContent>
      </Collapsible>
      {banner}
      {/* Why "Save changes" is dead sits in the pinned footer, beside the button
          it describes, so a phone shows the two together. A change always has
          the note's place, so the buttons are not rebuilt when it comes and goes. */}
      <DialogFooter
        className="mt-auto"
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
          disabled={chosen.submission === null}
          aria-describedby={unchanged ? `${id}-unchanged` : undefined}
        >
          {intent.kind === 'change' ? 'Save changes' : 'Set goal'}
        </Button>
      </DialogFooter>
    </form>
  )
}
