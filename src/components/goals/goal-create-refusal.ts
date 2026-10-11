// What the new-goal form says when the command refuses to create the goal.
//
// The command answers with a code. Three of them are about the choices on the
// form (the start month, the subjects, the measure), so the form says what to
// do next in its own words; "which goal holds this subject, and until when" is
// read from the goals the page already has. Any other failure is handed on
// untouched, and the banner applies its own rule to it.
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import type { GoalSubjectHold } from '#/contexts/reporting/application/goal-subject-holds'
import { formatShortDate } from '#/lib/format'
import { goalSubjectKey } from './goal-subject-picker'

export type GoalCreateRefusalContext = Readonly<{
  /** The subjects the form was saved with. */
  subjects: readonly GoalSubject[]
  /** What other goals hold for the chosen measure from the chosen start. */
  holds: readonly GoalSubjectHold[]
  /** The goal was to start in the current month. */
  startsThisMonth: boolean
  subjectName: (subject: GoalSubject) => string
  timezone: string
  now: Date
}>

const MONTH_CHANGED = 'The month has changed. Check the start and save again.'
const SUBJECT_HELD = 'A subject you chose already has a goal for this measure.'

/** The code of a refusal the command sent; null for any other failure. */
export function goalRefusalCode(error: unknown): string | null {
  return isServerFunctionError(error) ? error.code : null
}

function heldSentence(hold: GoalSubjectHold, context: GoalCreateRefusalContext): string {
  const name = context.subjectName(hold.subject)
  if (hold.heldUntil === null) {
    // A subject taken out of a goal stays in it until the month ends, so it
    // frees next month, never the one that is running.
    const partOf = `${name} is part of ${hold.programName}.`
    return context.startsThisMonth
      ? `${partOf} Remove it from that goal’s subjects, then start the new goal next month.`
      : `${partOf} Remove it from that goal’s subjects first.`
  }
  // The hold ends where the next month begins, so its last day is the day before.
  const lastDay = formatShortDate(
    new Date(hold.heldUntil.getTime() - 1),
    context.timezone,
    context.now,
  )
  const ends = `${name} has a goal for this measure that ends ${lastDay ?? 'this month'}.`
  return context.startsThisMonth ? `${ends} Start the new goal next month.` : ends
}

function heldSubjects(context: GoalCreateRefusalContext): string {
  const chosen = new Set(context.subjects.map(goalSubjectKey))
  const sentences = context.holds
    .filter((hold) => chosen.has(goalSubjectKey(hold.subject)))
    .map((hold) => heldSentence(hold, context))
  return sentences.length === 0 ? SUBJECT_HELD : sentences.join(' ')
}

/**
 * The sentence for the form's banner, or the failure itself when the form has
 * no words of its own for it.
 */
export function goalCreateRefusal(
  error: unknown,
  context: GoalCreateRefusalContext,
): unknown {
  switch (goalRefusalCode(error)) {
    case 'start_month_changed':
      return MONTH_CHANGED
    case 'subject_has_goal':
      return heldSubjects(context)
    case 'metric_unavailable':
      return context.startsThisMonth
        ? 'This measure can’t be read for this month right now. Start the goal next month, or try again later.'
        : 'This measure can’t be read right now. Try again later.'
    default:
      return error
  }
}
