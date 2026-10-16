// What the manager has done on the one-screen setup (rounds 3 and 4, E2/E4),
// kept above the frame so a phone turned to landscape keeps it. The screen is
// worked out from the draft (`choicesOf` → `workOutRatingGoal`); each change
// here is an immutable step, and every step clears a one-off hint. The goal
// follows the recommendation until − / + pins it, and a pin that lands on the
// recommendation lets go again (the mock's `pinGoal`). Typed values are clamped
// with a message, never refused.
import type {
  RatingGoalSetupChoices,
  RatingGoalSetupInputs,
  RatingGoalSetupPlanView,
} from '#/contexts/reporting/application/dto/rating-goal-setup.types'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  NO_SETUP_CHOICES,
  OWN_PACE_MIN_TENTHS,
  ownAverageTenths,
  ownPaceTenths,
  workOutRatingGoal,
} from '#/contexts/reporting/application/rating-goal-setup-plan'
import { paceText } from './rating-goal-pace-words'
import { tenthsText } from './rating-goal-view'

export type PaceUnit = 'day' | 'month'
type DraftPace = NonNullable<RatingGoalSetupChoices['pace']>

export type SetupDraft = Readonly<{
  unit?: PaceUnit
  pace?: DraftPace
  /** The chip "Back to options" returns to. */
  lastChip?: number
  ownAverageTenths?: number
  /** Change plan: the plan's stored average (D30). */
  keptAverageTenths?: number
  pin?: number
  /** + at the highest goal, or − at the lowest: said once, until the next change. */
  hint?: 'cap' | 'low'
  paceMessage?: string
  averageMessage?: string
  open?: 'why' | 'ask'
}>

export type SetupPlan = Extract<RatingGoalSetupPlanView, { kind: 'plan' }>

/** The engine's choices from a draft. */
export const choicesOf = (draft: SetupDraft): RatingGoalSetupChoices => ({
  ...NO_SETUP_CHOICES,
  pace: draft.pace ?? null,
  ownAverageTenths: draft.ownAverageTenths ?? null,
  keptAverageTenths: draft.keptAverageTenths ?? null,
  pinnedTargetTenths: draft.pin ?? null,
})

/** A change: the hint goes, the rest stays unless the patch says otherwise. */
const step = (draft: SetupDraft, patch: SetupDraft): SetupDraft => ({
  ...draft,
  hint: undefined,
  ...patch,
})

/** A pin on the recommendation follows it instead. */
const pinOf = (plan: SetupPlan, tenths: number): number | undefined =>
  tenths === plan.goal.recommendedTenths ? undefined : tenths

export function raiseGoal(draft: SetupDraft, plan: SetupPlan): SetupDraft {
  const { targetTenths, maxTenths } = plan.goal
  return targetTenths < maxTenths
    ? step(draft, { pin: pinOf(plan, targetTenths + 1) })
    : step(draft, { hint: 'cap' })
}

export function lowerGoal(draft: SetupDraft, plan: SetupPlan): SetupDraft {
  const { targetTenths, minTenths } = plan.goal
  return targetTenths > minTenths
    ? step(draft, { pin: pinOf(plan, targetTenths - 1) })
    : step(draft, { hint: 'low' })
}

/** Arrow keys, Home and End on the numeral: a goal within the range. */
export function goToGoal(draft: SetupDraft, plan: SetupPlan, tenths: number): SetupDraft {
  const { minTenths, maxTenths } = plan.goal
  return step(draft, {
    pin: pinOf(plan, Math.min(maxTenths, Math.max(minTenths, tenths))),
  })
}

export const backToRecommended = (draft: SetupDraft): SetupDraft =>
  step(draft, { pin: undefined })

export const chooseChip = (draft: SetupDraft, index: number): SetupDraft =>
  step(draft, { pace: { kind: 'chip', index }, paceMessage: undefined })

/**
 * The faster-pace link: that chip, and the goal the link named (D31), which
 * follows the recommendation again when it is the one at that chip.
 */
export const takeFasterPace = (
  draft: SetupDraft,
  chipIndex: number,
  pinTenths: number,
  recommendationAtChip: number,
): SetupDraft =>
  step(draft, {
    pace: { kind: 'chip', index: chipIndex },
    pin: pinTenths === recommendationAtChip ? undefined : pinTenths,
    paceMessage: undefined,
  })

/** "Your own" opens on the pace shown; "Back to options" returns to the chip before it. */
export function toggleOwnPace(draft: SetupDraft, plan: SetupPlan): SetupDraft {
  if (draft.pace?.kind === 'own') {
    const index = draft.lastChip ?? plan.pace.recommendedIndex
    return step(draft, { pace: { kind: 'chip', index }, paceMessage: undefined })
  }
  return step(draft, {
    pace: { kind: 'own', tenthsPerWeek: plan.pace.tenthsPerWeek },
    lastChip: plan.pace.chosenIndex ?? undefined,
    paceMessage: undefined,
  })
}

/** "4,5" and "4.5" read the same; anything else is no number. */
const parseTyped = (raw: string): number | null => {
  const value = Number.parseFloat(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/** A typed pace in the unit shown, clamped from 0.2 to 50 a day, with a message when it moved. */
export function typeOwnPace(draft: SetupDraft, unit: PaceUnit, raw: string): SetupDraft {
  const own = ownPaceTenths(unit, parseTyped(raw))
  const used = paceText(own.tenths, unit)
  const paceMessage =
    own.clamped === 'high'
      ? `We plan with up to 50 a day, so we used ${used}.`
      : own.clamped === 'low'
        ? `We plan with at least ${paceText(OWN_PACE_MIN_TENTHS, unit)}, so we used ${used}.`
        : undefined
  return step(draft, { pace: { kind: 'own', tenthsPerWeek: own.tenths }, paceMessage })
}

/** "Change" opens the typed average on the one shown; again, it goes back to automatic. */
export function toggleOwnAverage(draft: SetupDraft, plan: SetupPlan): SetupDraft {
  if (draft.ownAverageTenths !== undefined) return backToAutomatic(draft)
  return step(draft, { ownAverageTenths: plan.average.tenths, averageMessage: undefined })
}

/** A typed average, clamped from its floor to 5.0, with a message when it moved. */
export function typeOwnAverage(
  draft: SetupDraft,
  plan: SetupPlan,
  raw: string,
): SetupDraft {
  const floor = plan.average.ownMinTenths
  const own = ownAverageTenths(floor - 2, parseTyped(raw))
  const averageMessage = !own.clamped
    ? undefined
    : floor >= 50
      ? 'We plan with 5.0, so we used 5.0.'
      : `We plan with ${tenthsText(floor)} to 5.0, so we used ${tenthsText(own.tenths)}.`
  return step(draft, { ownAverageTenths: own.tenths, averageMessage })
}

/** "Back to automatic": today's automatic average, neither typed nor kept. */
export const backToAutomatic = (draft: SetupDraft): SetupDraft =>
  step(draft, {
    ownAverageTenths: undefined,
    keptAverageTenths: undefined,
    averageMessage: undefined,
  })

export const setUnit = (draft: SetupDraft, unit: PaceUnit): SetupDraft =>
  step(draft, { unit })

export const togglePopover = (draft: SetupDraft, which: 'why' | 'ask'): SetupDraft =>
  step(draft, { open: draft.open === which ? undefined : which })

/** The goal a change opens on, as the card read it. */
export type GoalToChange = Pick<
  RatingGoalCardView,
  'mode' | 'targetTenths' | 'qualityTenths' | 'paceTenthsPerWeek'
>

/**
 * Change plan opens on the goal's own plan: its target pinned, its pace as the
 * chip of the same value or as its own, and its average kept when it is not
 * today's automatic one (D30). A goal to keep opens as recommended.
 */
export function draftFromGoal(
  inputs: RatingGoalSetupInputs,
  goal: GoalToChange,
): SetupDraft {
  if (goal.mode !== 'climb' || goal.paceTenthsPerWeek === null) return {}
  const opened = workOutRatingGoal(inputs, NO_SETUP_CHOICES)
  if (opened.kind !== 'plan') return {}
  const chip = opened.pace.chips.findIndex(
    (each) => each.tenthsPerWeek === goal.paceTenthsPerWeek,
  )
  const pace: DraftPace =
    chip >= 0
      ? { kind: 'chip', index: chip }
      : { kind: 'own', tenthsPerWeek: goal.paceTenthsPerWeek }
  const kept =
    goal.qualityTenths !== null && goal.qualityTenths !== opened.average.automaticTenths
      ? goal.qualityTenths
      : undefined
  const draft: SetupDraft = { pace, keptAverageTenths: kept }
  const there = workOutRatingGoal(inputs, choicesOf(draft))
  const pin =
    there.kind === 'plan' && there.goal.recommendedTenths === goal.targetTenths
      ? undefined
      : goal.targetTenths
  return { ...draft, pin, lastChip: chip >= 0 ? chip : undefined }
}
