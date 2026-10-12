// What the new-goal form says when the command refuses to create the goal.
//
// The command answers with a code, and every code has a sentence
// (goal-refusal.ts). Two of them are about choices on this form (the subjects,
// the measure), so here the form says more: which goal holds a subject and
// until when, read from the goals the page already has, and that next month is
// still open when this month's figure cannot be read. A failure that is not a
// refusal is handed on untouched, and the banner applies its own rule to it.
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import type { GoalSubjectHold } from '#/contexts/reporting/application/goal-subject-holds'
import { formatShortDate } from '#/lib/format'
import { goalRefusal, goalRefusalCode } from './goal-refusal'
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

/**
 * Which goal holds a subject, and what frees it: the goal it is part of, or
 * the day a goal that is ending lets it go. The table that sets several goals
 * prints the same sentence on the row of a subject that is taken.
 */
export function goalHeldSentence(
  hold: GoalSubjectHold,
  context: Pick<
    GoalCreateRefusalContext,
    'startsThisMonth' | 'subjectName' | 'timezone' | 'now'
  >,
): string {
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
  if (!context.startsThisMonth) return ends
  // A goal that goes on can still have its running month's target changed,
  // which is the other way to a different number this month. One that has
  // ended takes no change, so it is not offered.
  return hold.goalEnded
    ? `${ends} Start the new goal next month.`
    : `${ends} Start the new goal next month, or change this month’s target.`
}

/** One sentence per chosen subject another goal holds; null before those goals are read. */
function heldSubjects(context: GoalCreateRefusalContext): string | null {
  const chosen = new Set(context.subjects.map(goalSubjectKey))
  const sentences = context.holds
    .filter((hold) => chosen.has(goalSubjectKey(hold.subject)))
    .map((hold) => goalHeldSentence(hold, context))
  return sentences.length === 0 ? null : sentences.join(' ')
}

/**
 * What the form's banner shows: the form's own sentence where it can say more
 * than the refusal does, otherwise the refusal in its sentence, or the failure
 * itself when it is not a refusal.
 */
export function goalCreateRefusal(
  error: unknown,
  context: GoalCreateRefusalContext,
): unknown {
  const code = goalRefusalCode(error)
  if (code === 'subject_has_goal') return heldSubjects(context) ?? goalRefusal(error)
  if (code === 'metric_unavailable' && context.startsThisMonth) {
    return 'This measure can’t be read for this month right now. Start the goal next month, or try again later.'
  }
  return goalRefusal(error)
}
