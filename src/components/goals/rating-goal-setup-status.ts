// The line under the goal on the one-screen setup, and what the numeral says to
// a screen reader (rounds 3 and 4, the approved mock's status). In this order:
//   1. "Google should show 4.0 soon" while Google lags behind the cache (D28);
//   2. at most one hint: + at the highest goal, − at the lowest, or a pinned
//      goal the average no longer reaches;
//   3. the faster pace, as a link, when the goal is more than six months away,
//      a faster chip exists and no hint was said;
//   4. "Recommended", with its reason only when nothing came before it, or the
//      way back to it when the goal is pinned elsewhere.
import { formatNumber } from '#/lib/format'
import type { PaceUnit, SetupDraft, SetupPlan } from './rating-goal-setup-draft'
import { paceText } from './rating-goal-pace-words'
import { spanText, whenText } from './rating-goal-setup-time'
import { tenthsText } from './rating-goal-view'

export type StatusAction =
  | Readonly<{ kind: 'faster'; chipIndex: number; pinTenths: number }>
  | Readonly<{ kind: 'recommended' }>

export type StatusPart =
  | Readonly<{ kind: 'tag'; text: string }>
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'link'; text: string; action: StatusAction }>

const PERFECT_TENTHS = 50

/** The one hint a change may raise, or null. */
function hintOf(plan: SetupPlan, draft: SetupDraft): StatusPart | null {
  const { targetTenths, pinnedTenths, pinnedAboveMax, earnedTenths } = plan.goal
  if (draft.hint === 'cap') {
    const next = targetTenths + 1
    return next >= PERFECT_TENTHS
      ? null
      : {
          kind: 'text',
          text: `${tenthsText(next)} needs new reviews above ${tenthsText(next)} stars, more than planned`,
        }
  }
  if (draft.hint === 'low') {
    return {
      kind: 'text',
      text: `${tenthsText(targetTenths)} is the lowest goal, one step up from ${tenthsText(earnedTenths)}`,
    }
  }
  if (pinnedAboveMax && pinnedTenths !== null) {
    return {
      kind: 'text',
      text: `${tenthsText(pinnedTenths)} needs a higher average than planned, so we show ${tenthsText(targetTenths)}`,
    }
  }
  return null
}

/** The hint a press at an end raised, for the live region; null without one. */
export const hintText = (plan: SetupPlan, draft: SetupDraft): string | null =>
  draft.hint === undefined ? null : (hintOf(plan, draft)?.text ?? null)

/** Why the recommendation is the one it is. */
function reasonOf(plan: SetupPlan): string {
  if (!plan.goal.recommendedIsSafe) {
    return `the next step up from ${tenthsText(plan.goal.shownTenths)}`
  }
  return plan.nextUp === null
    ? 'the highest at this average'
    : `${tenthsText(plan.nextUp.targetTenths)} possible ${whenText(plan.nextUp.days)}`
}

/** The parts of the status line, in the order above. */
export function statusParts(
  plan: SetupPlan,
  draft: SetupDraft,
  unit: PaceUnit,
): readonly StatusPart[] {
  const parts: StatusPart[] = []
  const { goal } = plan
  if (goal.earnedTenths > goal.shownTenths) {
    parts.push({
      kind: 'text',
      text: `Google should show ${tenthsText(goal.earnedTenths)} soon`,
    })
  }
  const hint = hintOf(plan, draft)
  if (hint !== null) parts.push(hint)
  const faster = plan.fasterPace
  const chip = faster === null ? undefined : plan.pace.chips[faster.chipIndex]
  if (hint === null && plan.overSixMonths && faster !== null && chip !== undefined) {
    parts.push({
      kind: 'link',
      text: `At ${paceText(chip.tenthsPerWeek, unit)}, ${spanText(faster.days)}`,
      action: {
        kind: 'faster',
        chipIndex: faster.chipIndex,
        pinTenths: goal.targetTenths,
      },
    })
  }
  if (goal.targetTenths !== goal.recommendedTenths) {
    parts.push({
      kind: 'link',
      text: `Back to ${tenthsText(goal.recommendedTenths)}, recommended`,
      action: { kind: 'recommended' },
    })
    return parts
  }
  const alone = parts.length === 0
  parts.push({ kind: 'tag', text: 'Recommended' })
  if (alone) parts.push({ kind: 'text', text: reasonOf(plan) })
  return parts
}

/** The names of − and +, which say why one does nothing at an end. */
export function goalAriaLabels(plan: SetupPlan): Readonly<{
  lower: string
  raise: string
  atLowest: boolean
  atHighest: boolean
}> {
  const { targetTenths, minTenths, maxTenths } = plan.goal
  const atLowest = targetTenths <= minTenths
  const atHighest = targetTenths >= maxTenths
  return {
    lower: atLowest
      ? `${tenthsText(targetTenths)} is the lowest goal`
      : `Lower the goal to ${tenthsText(targetTenths - 1)}`,
    raise: atHighest
      ? `${tenthsText(targetTenths)} is the highest goal at this average`
      : `Raise the goal to ${tenthsText(targetTenths + 1)}`,
    atLowest,
    atHighest,
  }
}

/** "Goal 4.1: 81 new reviews, in about 3 months at 1 a day". */
export const goalSay = (plan: SetupPlan, unit: PaceUnit): string =>
  `Goal ${tenthsText(plan.goal.targetTenths)}: ${formatNumber(plan.reviewsNeeded)} new reviews, ${whenText(plan.days)} at ${paceText(plan.pace.tenthsPerWeek, unit)}`
