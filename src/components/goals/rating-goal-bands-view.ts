// The questions on the Google rating goal's page, in words (pure; 2026-11-01, ADR
// 0067): is the rating going up and what can a manager do this week; whether enough
// good reviews are coming in is `rating-goal-review-facts-view.ts`'. The same answer-first shape as Guest voice and Portal
// Results, so a manager reads this page as they read those. The read decides every
// state and number; this only says them, once. Nothing here is a date to come:
// arrivals stay durations (R4-3).
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import type { Tone } from '#/components/ui/tone'
import { formatNumber, formatShortDate } from '#/lib/format'
import { PLAN_POLICY_LINE } from './rating-goal-copy'
import { reviewCountText, weekdayName } from './rating-goal-tracking-words'
import {
  ratingText,
  reviewsTooLowSentence,
  tenthsText,
  waitingSentence,
} from './rating-goal-view'

export type BandIcon = 'up' | 'down' | 'new' | 'wait' | 'reviews' | 'flag' | 'done'

export type BandWords = Readonly<{
  title: string
  icon: BandIcon
  answer: string
  hint: string | null
  tone: Tone
}>

export type BandContext = Readonly<{ timezone: string; now: Date }>

type Detail = RatingGoalDetailView

const tenthsOf = (rating: number): number => Math.round(rating * 10)

export const dateOf = (at: string, { timezone, now }: BandContext): string =>
  formatShortDate(at, timezone, now) ?? ''

const about = (detail: Detail): boolean => detail.exactAverageSource === 'google'

/** "2 new reviews to 4.0.": the count to the next number, as a sentence of its own. */
function toNextSentence(detail: Detail): string | null {
  const { next } = detail
  if (next === null) return null
  return `${reviewCountText(next.reviewsNeeded, about(detail))} to ${tenthsText(next.targetTenths)}.`
}

/** "in 11 weeks", "in 5 days", from the chart's day the goal was set. */
function timeTaken(detail: Detail): string | null {
  const setDay = detail.chart?.setDay
  if (setDay === undefined) return null
  const days = -setDay
  if (days < 14) return `in ${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`
  return `in ${formatNumber(Math.round(days / 7))} weeks`
}

const RISING = 'Is your rating going up?'

/** The goal this read found reached, or ended, says how it went and looks forward no more. */
function closedRising(detail: Detail, start: number, shown: number | null): BandWords {
  if (detail.state === 'reached') {
    const time = timeTaken(detail)
    return {
      title: 'Did you get there?',
      icon: 'done',
      answer: `Yes. Google shows ${ratingText(detail.target)}`,
      hint: `From ${tenthsText(start)}${time === null ? '' : ` ${time}`}.`,
      tone: 'positive',
    }
  }
  return {
    title: 'Where did it get to?',
    icon: 'flag',
    answer: shown === null ? 'This goal has ended' : `Google shows ${tenthsText(shown)}`,
    hint: `Google showed ${tenthsText(start)} when you started.`,
    tone: 'neutral',
  }
}

/** Google's number has not moved up: what is in the way, and how close the next number is. */
function notRisen(detail: Detail, start: number, shown: number): BandWords {
  const next = toNextSentence(detail)
  if (detail.justSet || detail.status === 'getting_started') {
    return {
      title: RISING,
      icon: 'new',
      answer: 'You’ve just started',
      hint: `Google shows ${tenthsText(shown)}. New reviews take a few weeks to show there.`,
      tone: 'neutral',
    }
  }
  if (shown < start) {
    return {
      title: RISING,
      icon: 'down',
      answer: `No. Google went down to ${tenthsText(shown)}`,
      hint: `It showed ${tenthsText(start)} when you started.${next === null ? '' : ` ${next}`}`,
      tone: 'warn',
    }
  }
  return {
    title: RISING,
    icon: 'up',
    answer: 'Not on Google yet',
    hint: `Google still shows ${tenthsText(shown)}.${next === null ? '' : ` ${next}`}`,
    tone: detail.status === 'below_pace' ? 'warn' : 'neutral',
  }
}

export function risingBand(detail: Detail, context: BandContext): BandWords {
  const start = tenthsOf(detail.baseline.googleShows)
  const shows = detail.google?.shows
  const shown = shows === null || shows === undefined ? null : tenthsOf(shows)
  if (detail.state !== 'active') return closedRising(detail, start, shown)
  if (shown === null || detail.status === 'waiting_for_google') {
    return {
      title: RISING,
      icon: 'wait',
      answer: 'Waiting for Google’s latest numbers',
      hint: waitingSentence(detail.google, context.timezone, context.now),
      tone: 'neutral',
    }
  }
  const target = ratingText(detail.target)
  if (detail.googleShowsSoon) {
    return {
      title: RISING,
      icon: 'up',
      answer: `Yes. Google should show ${target} soon`,
      hint: `Your reviews already clear ${target}. Google’s number can take up to two weeks to catch up.`,
      tone: 'positive',
    }
  }
  if (detail.status === 'reviews_too_low') {
    return {
      title: RISING,
      icon: 'down',
      answer:
        shown > start
          ? `Up to ${tenthsText(shown)}, but not on course for ${target}`
          : `Not yet. It’s holding at ${tenthsText(shown)}`,
      hint: reviewsTooLowSentence(detail.target),
      tone: 'warn',
    }
  }
  const [latest] = detail.moved.shownChanges
  if (latest !== undefined && !latest.up) {
    const next = toNextSentence(detail)
    return {
      title: RISING,
      icon: 'down',
      answer: `Not lately. Google went back to ${tenthsText(latest.tenths)}`,
      hint: `It went back on ${dateOf(latest.at, context)}.${next === null ? '' : ` ${next}`}`,
      tone: 'warn',
    }
  }
  if (shown > start) {
    return {
      title: RISING,
      icon: 'up',
      answer: `Yes, from ${tenthsText(start)} to ${tenthsText(shown)}`,
      hint:
        latest === undefined
          ? null
          : `Google started showing ${tenthsText(latest.tenths)} on ${dateOf(latest.at, context)}.`,
      tone: 'positive',
    }
  }
  return notRisen(detail, start, shown)
}

const WEEK_ROWS_TITLE = 'What can you do this week?'

/** "1 new review so far this week. It’s Tuesday." */
function thisWeekSentence(detail: Detail): string {
  const day = `It’s ${weekdayName(detail.weekday)}.`
  if (detail.thisWeekCount === 0) return `No new reviews yet this week. ${day}`
  const count = formatNumber(detail.thisWeekCount)
  return `${count} new ${detail.thisWeekCount === 1 ? 'review' : 'reviews'} so far this week. ${day}`
}

export function todoBand(detail: Detail): BandWords {
  const flag = { icon: 'flag', tone: 'neutral' } as const
  if (detail.state !== 'active') {
    return {
      ...flag,
      title: 'What’s next?',
      answer: 'Set your next goal',
      hint: 'This goal is in History now.',
    }
  }
  const week = thisWeekSentence(detail)
  if (detail.status === 'reviews_too_low') {
    return {
      ...flag,
      title: WEEK_ROWS_TITLE,
      answer: 'Fix what guests complain about',
      hint: PLAN_POLICY_LINE,
    }
  }
  if (detail.status === 'below_pace') {
    return { ...flag, title: WEEK_ROWS_TITLE, answer: 'Ask more guests', hint: week }
  }
  if (detail.justSet || detail.status === 'getting_started') {
    return {
      ...flag,
      title: WEEK_ROWS_TITLE,
      answer: 'Start asking every guest',
      hint: week,
    }
  }
  return {
    ...flag,
    title: WEEK_ROWS_TITLE,
    answer: 'Keep asking every guest',
    hint: week,
  }
}

/** A goal to keep a number: is it still there. */
export function keepBand(detail: Detail, context: BandContext): BandWords {
  const target = ratingText(detail.target)
  const shows = detail.google?.shows
  const title = 'Is it holding?'
  if (shows === null || shows === undefined || detail.status === 'waiting_for_google') {
    return {
      title,
      icon: 'wait',
      answer: 'Waiting for Google’s latest numbers',
      hint: waitingSentence(detail.google, context.timezone, context.now),
      tone: 'neutral',
    }
  }
  if (detail.status === 'dropped_below') {
    return {
      title,
      icon: 'down',
      answer: `Not right now. Google shows ${ratingText(shows)}`,
      hint: `You’re keeping ${target}. Asking every guest, not only the ones who would write anyway, and better stays are what move this number.`,
      tone: 'warn',
    }
  }
  return {
    title,
    icon: 'up',
    answer: `Yes. Google shows ${ratingText(shows)}`,
    hint: null,
    tone: 'positive',
  }
}
