// What the Google rating goal's page says about its new reviews (pure; 2026-11-01, ADR
// 0067): whether enough good ones are coming in, what they average, how many were
// low, the row that opens one and the bars of each week against the plan. Low means 3★ or less here, whatever
// the goal needs: a 4★ review sets a goal of 4.1 back a little, and no manager wants
// to read it first.
import type {
  RatingGoalDetailView,
  RatingGoalLowReviewView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber } from '#/lib/format'
import type { GoalColumn, GoalColumnsPlan } from './goal-columns-view'
import { dateOf, type BandContext, type BandWords } from './rating-goal-bands-view'
import { paceText, weeklyTarget } from './rating-goal-pace-words'
import { reviewCountText } from './rating-goal-tracking-words'
import { ratingText, tenthsText } from './rating-goal-view'

type Detail = RatingGoalDetailView

/** "about 7 a week", "under 1 a week", "none lately": the pace of the last four weeks, as bars read it. */
function weekPaceWords(perWeek: number): string {
  if (perWeek === 0) return 'none lately'
  if (perWeek < 1) return 'under 1 a week'
  return `about ${formatNumber(Math.round(perWeek))} a week`
}

/** "Before the goal it was about 2 a month.": the pace it started from, when the chart reaches it. */
function beforeSentence(detail: Detail): string | null {
  const before = detail.planSoFar.prePlan
  if (before === null) return null
  return before.perMonth === 0
    ? 'There were none in the 4 weeks before the goal.'
    : `Before the goal it was about ${formatNumber(before.perMonth)} a month.`
}

/** "3.8★": what new reviews average, to a tenth, once there are ten of them (R2-5). */
function averageWords(detail: Detail): string | null {
  const average = detail.plan?.sinceSet.average ?? null
  return average === null ? null : `${ratingText(average)}★`
}

const REVIEWS = 'Are enough good reviews coming in?'
/** At this share of the plan a pace counts as on it, as the pill's rule does. */
const ENOUGH_OF_PLAN = 0.9

const capitalised = (words: string): string =>
  `${words.charAt(0).toUpperCase()}${words.slice(1)}`

type ReviewFacts = Readonly<{
  /** The reviews a week the plan asks for, and "about 3 a week" lately. */
  planned: number
  lately: string
  before: string | null
  average: string | null
  plannedStars: string | null
}>

function reviewFacts(detail: Detail): ReviewFacts {
  return {
    planned: weeklyTarget(detail.paceTenthsPerWeek ?? 0),
    lately: weekPaceWords(detail.lastFourWeeksPerWeek),
    before: beforeSentence(detail),
    average: averageWords(detail),
    plannedStars:
      detail.qualityTenths === null ? null : `${tenthsText(detail.qualityTenths)}★`,
  }
}

/** How a goal found reached or ended went: what came in, and from what. */
function closedReviews(detail: Detail, facts: ReviewFacts): BandWords {
  const count = detail.plan?.sinceSet.reviewCount ?? 0
  const reviews = `${formatNumber(count)} new ${count === 1 ? 'review' : 'reviews'}`
  const reached = detail.state === 'reached'
  return {
    title: reached ? 'What got you there?' : 'What came in?',
    icon: 'reviews',
    answer: facts.average === null ? reviews : `${reviews} at ${facts.average}`,
    hint: facts.before,
    tone: reached ? 'positive' : 'neutral',
  }
}

/** The stars are too low for the goal, whether or not enough reviews come in. */
function tooLowReviews(detail: Detail, facts: ReviewFacts): BandWords {
  const enough = detail.lastFourWeeksPerWeek >= facts.planned * ENOUGH_OF_PLAN
  const at = facts.average === null ? '' : ` at ${facts.average}`
  const plannedAt = facts.plannedStars === null ? '' : ` at ${facts.plannedStars}`
  return {
    title: REVIEWS,
    icon: 'reviews',
    answer: enough
      ? 'Enough, but the stars are low'
      : 'Not enough, and the stars are low',
    hint: `${capitalised(facts.lately)}${at}. You planned ${formatNumber(facts.planned)} a week${plannedAt}.`,
    tone: 'warn',
  }
}

export function reviewsBand(detail: Detail): BandWords {
  const facts = reviewFacts(detail)
  const { planned, lately, before } = facts
  if (detail.state !== 'active') return closedReviews(detail, facts)
  const words = { title: REVIEWS, icon: 'reviews' } as const
  if (detail.justSet || detail.status === 'getting_started') {
    return {
      ...words,
      answer: 'Too early to say',
      hint: `Aim for about ${formatNumber(planned)} a week. ${before ?? ''}`.trim(),
      tone: 'neutral',
    }
  }
  switch (detail.status) {
    case 'reviews_too_low':
      return tooLowReviews(detail, facts)
    case 'below_pace':
      return {
        ...words,
        answer: `Not enough: ${lately}`,
        hint: `You planned ${formatNumber(planned)} a week.`,
        tone: 'warn',
      }
    case 'on_pace':
      return {
        ...words,
        answer: `Yes, ${lately}`,
        hint: `You planned ${paceText(detail.paceTenthsPerWeek ?? 0)}. ${before ?? ''}`.trim(),
        tone: 'positive',
      }
    default:
      return {
        ...words,
        answer: capitalised(lately),
        hint: `You planned ${formatNumber(planned)} a week.`,
        tone: 'neutral',
      }
  }
}

/** "They average 4.6★. You planned 4.5★.", or that it is too early to compare. */
export function starsFact(detail: Detail): string | null {
  const planned = detail.qualityTenths
  if (planned === null || detail.plan === null) return null
  const average = averageWords(detail)
  const stars = `${tenthsText(planned)}★`
  return average === null
    ? `We’ll compare their stars with your ${stars} after 10 new reviews.`
    : `They average ${average}. You planned ${stars}.`
}

/** "4 of the 52 new reviews gave 3★ or less."; none from fewer than two reviews. */
export function lowFact(detail: Detail): string | null {
  const low = detail.moved.lowSinceSet
  const count = detail.plan?.sinceSet.reviewCount ?? 0
  if (low === null || count < 2) return null
  const reviews = `${formatNumber(count)} new reviews`
  return low === 0
    ? `None of the ${reviews} gave 3★ or less.`
    : `${formatNumber(low)} of the ${reviews} gave 3★ or less.`
}

/** The stars a review must be at or under for a manager to want to read it first. */
const READ_FIRST_STARS = 3

/** The newest review of 3★ or less this viewer may open; null when there is none. */
export const newestLowReview = (detail: Detail): RatingGoalLowReviewView | null =>
  detail.moved.lowReviews.find(
    (review) => review.stars <= READ_FIRST_STARS && review.inboxItemId !== null,
  ) ?? null

/** "Read the 1★ review from Nov 18", and what it set the goal back. */
export function lowReviewRow(
  review: RatingGoalLowReviewView,
  context: BandContext,
): Readonly<{ title: string; note: string | null }> {
  return {
    title: `Read the ${review.stars}★ review from ${dateOf(review.at, context)}`,
    note:
      review.setBack === null
        ? null
        : `It set you back about ${reviewCountText(review.setBack, false)}.`,
  }
}

/** The bars show this many weeks, this one last. */
const WEEKS_SHOWN = 13
const WEEK_DAYS = 7

function shiftedDay(todayKey: string, days: number): string {
  const [year = 0, month = 1, day = 1] = todayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export type WeekBars = Readonly<{
  columns: readonly GoalColumn[]
  plan: GoalColumnsPlan
}>

/** New reviews each week against the plan: the bars before the goal quiet, this week dashed. */
export function weekBars(
  detail: Detail,
  dayWords: (key: string) => string,
): WeekBars | null {
  const { chart, paceTenthsPerWeek } = detail
  if (chart === null || paceTenthsPerWeek === null || chart.weeks.length === 0)
    return null
  const weeks = chart.weeks.slice(-WEEKS_SHOWN)
  const label = (day: number) => dayWords(shiftedDay(chart.todayKey, day))
  const columns = weeks.map((week): GoalColumn => {
    const open = week.day > -WEEK_DAYS
    const before = week.day + WEEK_DAYS <= chart.setDay
    const reviews = `${formatNumber(week.count)} new ${week.count === 1 ? 'review' : 'reviews'}`
    return {
      key: String(week.day),
      label: label(week.day),
      value: week.count,
      figure: before || (week.count === 0 && !open) ? null : formatNumber(week.count),
      tone: open ? 'open' : before ? 'before' : 'since',
      mark: null,
      met: false,
      line: `Week of ${label(week.day)} · ${reviews}${open ? ' so far' : ''}`,
    }
  })
  const firstSince = columns.findIndex((column) => column.tone !== 'before')
  // Set this week: a line over the last bar alone says little, so it spans them all.
  const from = firstSince >= columns.length - 1 ? 0 : Math.max(0, firstSince)
  const planned = weeklyTarget(paceTenthsPerWeek)
  return {
    columns,
    plan: {
      value: planned,
      from,
      words: `Your plan: ${formatNumber(planned)} a week`,
    },
  }
}
