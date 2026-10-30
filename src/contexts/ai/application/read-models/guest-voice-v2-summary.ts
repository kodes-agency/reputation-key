// The Monday email's rules, as plain functions of the Guest voice read (decision 11 of the
// v3 contract). Which Mondays send, what a quiet week is, and the three lines the email
// carries. No model, no storage and no word of a review: a line is a fixed topic, counts
// and a link, so the email can say it without breaking ADR 0046 r.8.
import type { GuestVoiceSummaryFactLine } from '../../domain/events'
import { addDays } from '../local-date'
import type { GuestVoiceReview } from './guest-voice-v2-facts'
import type { GuestVoiceV2Ready } from './guest-voice-v2'

/** The Property-local hours the summary may go out in: 08:00 and the two hours after it. */
export const SUMMARY_FIRST_LOCAL_HOUR = 8
export const SUMMARY_LAST_LOCAL_HOUR = 10

/** How many days back "this week" reaches: the days since the same weekday last week. */
export const SUMMARY_WEEK_DAYS = 7

const WEEKDAY_NUMBERS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

/**
 * Whether it is a Monday morning, 08:00 to 10:59, on the clock of a Property's own
 * timezone at this instant. The first hour is when the email is meant to go; the two after
 * it are for a sweep that was late, and the fact's id keeps it to one. A timezone this
 * runtime does not know is never a Monday morning, so one bad profile cannot stop the
 * others from being decided.
 */
export function isSummaryMorning(nowEpochMillis: number, timezone: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(nowEpochMillis)
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? ''
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    return (
      WEEKDAY_NUMBERS[weekday] === 1 &&
      hour >= SUMMARY_FIRST_LOCAL_HOUR &&
      hour <= SUMMARY_LAST_LOCAL_HOUR
    )
  } catch {
    return false
  }
}

/** The day of the week of a Property-local day, Monday 1 to Sunday 7. */
export function isoWeekday(localDate: string): number {
  const day = new Date(`${localDate}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

export function isMonday(localDate: string): boolean {
  return isoWeekday(localDate) === 1
}

/**
 * The first Monday of its month: the Monday whose day of the month is 1 to 7. That
 * Monday sends the monthly roundup instead of waiting for a week with something in it.
 */
export function isFirstMondayOfMonth(localDate: string): boolean {
  return isMonday(localDate) && Number(localDate.slice(8, 10)) <= SUMMARY_WEEK_DAYS
}

/** The three lines of "In short", without the guests' words: topic, counts and the link. */
export function summaryLines(
  read: GuestVoiceV2Ready,
): readonly GuestVoiceSummaryFactLine[] {
  const lines: GuestVoiceSummaryFactLine[] = []
  const problem = read.fixFirst.at(0)
  const strength = read.guestsLove.at(0)
  const change = read.whatChanged.at(0)
  if (problem !== undefined) {
    lines.push({
      kind: 'fix_first',
      topic: problem.topic,
      issueId: problem.issueId,
      reviewCount: problem.statistics.reviewCount,
      textReviewCount: problem.statistics.textReviewCount,
      upTo: problem.statistics.upTo,
      change: null,
      polarity: null,
    })
  }
  if (strength !== undefined) {
    lines.push({
      kind: 'protect',
      topic: strength.topic,
      issueId: strength.issueId,
      reviewCount: strength.statistics.reviewCount,
      textReviewCount: strength.statistics.textReviewCount,
      upTo: null,
      change: null,
      polarity: null,
    })
  }
  if (change !== undefined) {
    lines.push({
      kind: 'change',
      topic: change.topic,
      issueId: change.issueId,
      reviewCount: change.statistics.reviewCount,
      textReviewCount: change.statistics.textReviewCount,
      upTo: null,
      change: change.change,
      polarity: change.polarity,
    })
  }
  return lines
}

/** The issues a read ranks or watches, which is what a week can add a new one to. */
function knownIssues(read: GuestVoiceV2Ready): ReadonlySet<string> {
  return new Set([...read.fixFirst, ...read.watch].map((item) => item.issueId))
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** Whether an Urgent review was left in the week that ends on `endLocalDate`. */
export function hasUrgentReviewThisWeek(
  reviews: readonly GuestVoiceReview[],
  endLocalDate: string,
): boolean {
  const since = addDays(endLocalDate, -SUMMARY_WEEK_DAYS)
  return reviews.some(
    (review) => review.urgentReason !== null && review.localDate > since,
  )
}

/**
 * A quiet week: nothing in Fix first moved, no issue is new to Fix first or Watch, and
 * no review was Urgent. It sends nothing. `before` is the same read a week ago; where
 * there is none (a Property too full to read a year before the window) the week cannot
 * be called quiet, because there is nothing to compare it with.
 */
export function isQuietWeek(
  input: Readonly<{
    now: GuestVoiceV2Ready
    before: GuestVoiceV2Ready | null
    urgentThisWeek: boolean
  }>,
): boolean {
  const { now, before, urgentThisWeek } = input
  if (before === null || urgentThisWeek) return false
  const fixFirstMoved = !sameOrder(
    now.fixFirst.map((item) => item.issueId),
    before.fixFirst.map((item) => item.issueId),
  )
  const earlier = knownIssues(before)
  const newIssue = [...knownIssues(now)].some((id) => !earlier.has(id))
  return !fixFirstMoved && !newIssue
}
