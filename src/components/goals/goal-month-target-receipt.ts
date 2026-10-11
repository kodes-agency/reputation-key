// What the "Change this month's target" dialog keeps on screen once the change
// is saved.
//
// Pure. The command answers the month and the months after separately: the
// months after can be left as they were while the month changes (a change that
// was already scheduled for them, a subject or a measure that is no longer
// usable). The receipt says both halves in sentences, never as the command's
// codes, and is the only word on the success.
import type { changeGoalMonthTarget } from '#/contexts/reporting/server/goal-month-target'
import { goalDay } from './goal-detail-view'

/** What the command answers. */
type ChangeResult = Awaited<ReturnType<typeof changeGoalMonthTarget>>

export type GoalMonthTargetReceipt = Readonly<{
  /** `warning` when the months after were asked for and did not change. */
  tone: 'success' | 'warning' | 'info'
  text: string
}>

export type GoalMonthTargetReceiptFacts = Readonly<{
  /** The Property's own zone and the instant the dialog was opened. */
  timezone: string
  now: Date
  /** "October": the month whose target was to change. */
  month: string
  /** "November": the month a version for the months after would start with. */
  followingMonth: string
  /** Every subject of the goal is a Portal. */
  portalsOnly: boolean
}>

/**
 * Why the months after did not take the target, one clause per reason the
 * command can give: typed by the reasons, so none is ever printed as a code.
 */
const NOT_APPLIED: Readonly<
  Record<
    NonNullable<ChangeResult['following']['reason']>,
    (facts: GoalMonthTargetReceiptFacts) => string
  >
> = {
  subject_unavailable: (facts) =>
    facts.portalsOnly
      ? 'a portal in this goal is archived'
      : 'a subject of this goal is no longer available',
  metric_unavailable: () => 'the measure is not available',
}

/** The command gives a reason with `not_applied`; without one the receipt still says a sentence. */
function notAppliedReason(
  reason: ChangeResult['following']['reason'],
  facts: GoalMonthTargetReceiptFacts,
): string {
  return reason === undefined
    ? 'it could not take the new target'
    : NOT_APPLIED[reason](facts)
}

/** What became of the months after, as the end of the receipt. */
function followingSentence(
  following: ChangeResult['following'],
  facts: GoalMonthTargetReceiptFacts,
): string | null {
  const from = following.startsAt ? goalDay(following.startsAt, facts) : null
  switch (following.outcome) {
    case 'not_requested':
      return null
    case 'applied':
      return from === null ? null : `It also applies from ${from}.`
    case 'replaced_scheduled_change':
      return from === null
        ? 'It replaces the change that was scheduled.'
        : `It replaces the change that was scheduled from ${from}.`
    case 'kept_scheduled_change':
      return `${facts.followingMonth} keeps the change already scheduled for it.`
    case 'not_applied':
      return `${facts.followingMonth} was not changed because ${notAppliedReason(following.reason, facts)}.`
  }
}

/**
 * What the dialog keeps on screen once the change is saved. The month and the
 * months after are answered separately: the months after can be left as they
 * were while the month changes, and the receipt says so and why.
 */
export function goalMonthTargetReceipt(
  result: ChangeResult,
  facts: GoalMonthTargetReceiptFacts,
): GoalMonthTargetReceipt {
  const { following } = result
  const held =
    following.outcome === 'kept_scheduled_change' || following.outcome === 'not_applied'
  const after = followingSentence(following, facts)
  if (result.month === 'unchanged') {
    return {
      tone: held ? 'warning' : after === null ? 'info' : 'success',
      text: [`${facts.month} already had this target.`, after]
        .filter((part): part is string => part !== null)
        .join(' '),
    }
  }
  if (following.outcome === 'kept_scheduled_change') {
    return {
      tone: 'warning',
      text: `${facts.followingMonth} already has its own change scheduled, so only ${facts.month} changed.`,
    }
  }
  if (following.outcome === 'not_applied') {
    return { tone: 'warning', text: `${facts.month} changed. ${after}` }
  }
  return {
    tone: 'success',
    text: ['Target saved.', after]
      .filter((part): part is string => part !== null)
      .join(' '),
  }
}
