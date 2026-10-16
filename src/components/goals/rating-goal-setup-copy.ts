// The words of the one-screen setup (rounds 3 and 4, verbatim from the approved
// mock E2-Number, with PLAN-R4's corrections: "takes over" for R2-5's switch,
// the example worded around the planned average, and the new lines X6–X8, X22).
// Pure: the step and the popovers print what this returns.
import type { RatingGoalSetupInputs } from '#/contexts/reporting/application/dto/rating-goal-setup.types'
import { perMonthOf } from '#/contexts/reporting/application/rating-goal-setup-plan'
import { formatMonthName, formatNumber } from '#/lib/format'
import type { PaceUnit, SetupPlan } from './rating-goal-setup-draft'
import { paceText } from './rating-goal-pace-words'
import { likelyText, spanText } from './rating-goal-setup-time'
import { tenthsText } from './rating-goal-view'

type Average = SetupPlan['average']

/** A run of a paragraph; `strong` is set in bold. */
export type TextRun = Readonly<{ text: string; strong?: boolean }>

const monthName = (year: number, month: number): string =>
  formatMonthName(`${year}-${String(month).padStart(2, '0')}-15T12:00:00.000Z`) ?? ''

/** "your best month, August", "your best year, 2024". */
function evidenceLabel(evidence: NonNullable<Average['evidence']>): string {
  return evidence.kind === 'best_month'
    ? `your best month, ${monthName(evidence.year, evidence.month)}`
    : `your best year, ${evidence.year}`
}

/** Where the planned average comes from, beside it. */
export function averageSourceText(average: Average, shownTenths: number): string {
  switch (average.source) {
    case 'own':
      return 'your own number'
    case 'earlier':
      return 'your plan’s average'
    case 'halfway':
      return `halfway between your ${tenthsText(shownTenths)} and 5`
    case 'best_month':
    case 'best_year':
      return average.evidence === null ? '' : evidenceLabel(average.evidence)
  }
}

const SWITCH = 'We switch to your real average as reviews arrive.'

/** The line under the planned average. */
export function averageWhyText(average: Average): string {
  if (average.source === 'own') return `You set this. ${SWITCH}`
  if (average.source === 'earlier') return `Kept from your plan. ${SWITCH}`
  return `Guests who write on their own are often the unhappy ones, so guests you ask usually rate you higher. ${SWITCH}`
}

/** "up from about 2 a month now." and its siblings, ±5% around today. */
function comparedWithNow(perMonth: number, now: number): string {
  if (now === 0) return 'up from none in the last 3 months.'
  if (perMonth * 100 > now * 105) return `up from about ${formatNumber(now)} a month now.`
  if (perMonth * 100 < now * 95)
    return `fewer than the ${formatNumber(now)} a month you get now.`
  return 'about what you get now.'
}

/** The note under the pace: the other unit, then against today. */
export function paceNote(plan: SetupPlan, unit: PaceUnit): string {
  const tenths = plan.pace.tenthsPerWeek
  const other = unit === 'day' ? paceText(tenths, 'month') : paceText(tenths)
  return `About ${other}, ${comparedWithNow(perMonthOf(tenths), plan.pace.nowPerMonth)}`
}

/** Why this pace is recommended. */
export function paceWhyText(plan: SetupPlan): string {
  const { chips, recommendedIndex, busiest30, provenDayTenths } = plan.pace
  const recommended = chips[recommendedIndex]
  if (recommended === undefined || chips[0]?.kind === 'a_few_a_week') {
    return 'Places that ask every guest manage at least 1 a day, so we suggest 1 a day.'
  }
  const proven = formatNumber(provenDayTenths / 10, { maximumFractionDigits: 1 })
  return `Your busiest month brought ${formatNumber(busiest30)}, about ${proven} a day; places that ask every guest usually do more, so we suggest ${paceText(recommended.tenthsPerWeek)}.`
}

/** "7 in 10 guests giving 5 stars and the other 3 giving 4", "every guest giving 5 stars". */
export function exampleText(qualityTenths: number): string {
  const whole = Math.floor(qualityTenths / 10)
  const tenths = qualityTenths % 10
  const stars = (count: number) => `${count} ${count === 1 ? 'star' : 'stars'}`
  if (tenths === 0) return `every guest giving ${stars(whole)}`
  return `${tenths} in 10 guests giving ${stars(whole + 1)} and the other ${10 - tenths} giving ${whole}`
}

/** "{T} is the highest…", "You chose…": why this goal. */
function recommendationText(plan: SetupPlan, unit: PaceUnit): string {
  const { targetTenths, recommendedTenths, recommendedIsSafe } = plan.goal
  const pace = paceText(plan.pace.tenthsPerWeek, unit)
  if (targetTenths !== recommendedTenths) {
    return `You chose ${tenthsText(targetTenths)}. We suggest ${tenthsText(recommendedTenths)}: the highest you can count on within 6 months at ${pace}.`
  }
  return recommendedIsSafe
    ? `${tenthsText(targetTenths)} is the highest number you can count on within 6 months at ${pace}, even if new reviews average 0.1 stars lower than planned.`
    : `${tenthsText(targetTenths)} is the next step up from today, so we suggest it.`
}

/** Where the planned average comes from, in a sentence. */
function planText(plan: SetupPlan): string {
  const { average } = plan
  const q = tenthsText(average.tenths)
  if (average.source === 'own') return `You set new reviews at ${q} stars.`
  if (average.source === 'earlier') return `Your plan has new reviews at ${q} stars.`
  const shows = tenthsText(plan.goal.shownTenths)
  const why =
    average.evidence !== null && average.source !== 'halfway'
      ? `${evidenceLabel(average.evidence)} averaged ${tenthsText(average.evidence.tenths)}.`
      : `halfway between ${shows} and 5, because asked guests rate higher than those who write on their own.`
  return `We plan new reviews at ${q} stars, never at today’s ${shows}: ${why} After your first 10 new reviews, their real average takes over.`
}

/** "How we worked out {T}": five paragraphs. */
export function workedOutParagraphs(
  plan: SetupPlan,
  inputs: RatingGoalSetupInputs,
  unit: PaceUnit,
): readonly (readonly TextRun[])[] {
  const goal = tenthsText(plan.goal.targetTenths)
  const q = tenthsText(plan.average.tenths)
  const after = formatNumber(plan.averageAfterHundredths / 100, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const about = inputs.exactSource === 'google' ? 'about ' : ''
  const today =
    plan.daysAtTodaysPace === null
      ? ''
      : ` At today’s ${formatNumber(plan.pace.nowPerMonth)} a month, the same ${formatNumber(plan.reviewsNeeded)} reviews would take ${spanText(plan.daysAtTodaysPace)}.`
  return [
    [
      {
        text: `Google shows ${tenthsText(plan.goal.shownTenths)} from ${formatNumber(inputs.reviewCount)} reviews today. `,
      },
      { text: formatNumber(plan.reviewsNeeded), strong: true },
      {
        text: ` new reviews averaging ${q} stars make the average ${about}${after}, which Google shows as ${goal}.`,
      },
    ],
    [{ text: `${recommendationText(plan, unit)} ${paceWhyText(plan)}` }],
    [{ text: planText(plan) }],
    [
      {
        text: `“Likely ${likelyText(plan.likely)}” allows for new reviews averaging 0.1 stars lower or higher, and for asking 10% less or more.${today}`,
      },
    ],
    [
      {
        text: `${q} stars is, for example, ${exampleText(plan.average.tenths)}. It is a forecast from your own history, not a target for guests or staff.`,
      },
    ],
  ]
}

/** The ruler from four tenths below today to 5.0, as fractions of its width. */
export function rulerGeometry(
  shownTenths: number,
  targetTenths: number,
): Readonly<{
  ticks: readonly Readonly<{ at: number; whole: boolean }>[]
  today: number
  goal: number
  /** The climb from today to the goal, as a share of today to 5.0. */
  climb: number
}> {
  const low = shownTenths - 4
  const high = 50
  const at = (tenths: number) => (tenths - low) / (high - low)
  return {
    ticks: Array.from({ length: high - low + 1 }, (_, step) => ({
      at: at(low + step),
      whole: (low + step) % 10 === 0,
    })),
    today: at(shownTenths),
    goal: at(targetTenths),
    climb: (targetTenths - shownTenths) / (high - shownTenths),
  }
}
