// Retention cutoffs. One function turns a rule's age into the instant its
// timestamp column is compared with, so the scheduled sweep, the report and the
// restore check cannot disagree about which rows a rule reaches.

import type { RetentionRuleAge } from './execute-retention-rule'

/**
 * The same instant `months` UTC calendar months earlier. When the earlier month
 * is shorter the day is clamped to its last day (29 February back two years is
 * 28 February), never rolled into the following month: rolling forward would
 * move the cutoff later and reach a row before its full horizon had passed.
 * The clamp errs the other way, by a day at most and only around 29 February:
 * a row stamped on the leap day waits until 1 March two years on, and a run on
 * the leap day counts back to 28 February at its own time of day, so the later
 * rows of that day wait for the next run.
 */
export function subtractUtcMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime())
  const targetDay = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() - months)
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(targetDay, lastDayOfTargetMonth))
  return result
}

/** Rows whose timestamp column is before this instant are in the rule's reach at `now`. */
export function retentionRuleCutoff(rule: RetentionRuleAge, now: Date): Date {
  return rule.olderThanMonths === undefined
    ? new Date(now.getTime() - rule.olderThanMs)
    : subtractUtcMonths(now, rule.olderThanMonths)
}
