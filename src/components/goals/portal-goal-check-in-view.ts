// The Monthly portal goal's month-start check-in, worded (copy deck K-1…K-9;
// PLAN PG-15; the strip's lines U-K1…U-K3, ADR 0068 amended 2026-10-19): the
// month it asks about as the strip's name, the month before as the strip's
// headline (so far, while it is read; then met or not met), what is offered
// ("Your goal is 40 a month. 45 is recommended for December, a bit above your
// usual of about 38."), "Use 45", "Keep 40", another number, and that nothing
// changes unless a manager chooses; with nothing counted, the fact instead of a
// number; with the recommended number the month's already, one line under the
// card. The read decides whether it asks, the month, the numbers and the weeks
// (PLAN E12); this only says them. Pure.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalCheckIn,
  PortalGoalLastMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatNumber } from '#/lib/format'
import { lastMonthWords } from './portal-goal-running-view'
import { dayWords, monthName, portalGoalCount, portalGoalUnit } from './portal-goal-words'

/**
 * U-K1: the strip's headline, the month before. K-1 while it is read: what it
 * has so far, and the day its final figure is due (until that day has gone); with
 * no figure to say yet, the card's own line (G-30). K-6: once it has closed, met
 * or not met (G-31), as the card says it, without a check: the strip has its own
 * icon. None where the month before has nothing to say.
 */
function checkInHeadline(lastMonth: PortalGoalLastMonth | null): string | null {
  if (lastMonth === null) return null
  const { key, value, target, outcome, finalOn } = lastMonth
  if (outcome !== 'updating' || value === null) {
    return lastMonthWords(lastMonth)?.text ?? null
  }
  const soFar = `${monthName(key)}: ${formatNumber(value)} of ${formatNumber(target)} so far.`
  return finalOn === null ? soFar : `${soFar} Final figure on ${dayWords(finalOn)}.`
}

/** "45" for private ratings, "55 scans" for scans: as the ready card's Use says it. */
const buttonNumber = (measure: PortalGoalMeasure, n: number): string =>
  measure === 'portal_rating_count' ? formatNumber(n) : portalGoalCount(measure, n)

export type PortalGoalCheckInWords = Readonly<{
  /** K-2: the strip's name, "For December". */
  label: string
  /** U-K1: the month before in one line; none where there is nothing to say of it. */
  headline: string | null
  /**
   * U-K2 with an offer: the goal, the number recommended and what it stands on
   * (the way to "How we worked this out" follows it). K-8 without one: why not.
   */
  sub: string
  /** U-K3 and K-9: "Use 45", the number it sends and its toast; none with nothing to offer. */
  use: Readonly<{ label: string; targetValue: number; toast: string }> | null
  /** U-K3 and K-9: "Keep 40", and its toast. */
  keep: Readonly<{ label: string; toast: string }>
  /** U-K3: the way to another number, through the change sheet. */
  other: string
  /** K-5 */
  note: string
}>

/** The check-in that asks (an offer, or nothing to offer), worded; `lastMonth` is the month before. */
export function checkInWords(
  checkIn: Extract<PortalGoalCheckIn, { kind: 'offer' | 'nothing' }>,
  lastMonth: PortalGoalLastMonth | null,
): PortalGoalCheckInWords {
  const month = monthName(checkIn.month)
  const { measure, target } = checkIn
  const kept = formatNumber(target)
  const use =
    checkIn.kind === 'offer'
      ? {
          label: `Use ${buttonNumber(measure, checkIn.offer.choices.aBitMore)}`,
          targetValue: checkIn.offer.choices.aBitMore,
          toast: `${month} goal: ${portalGoalCount(measure, checkIn.offer.choices.aBitMore)}`,
        }
      : null
  const sub =
    checkIn.kind === 'offer'
      ? `Your goal is ${buttonNumber(measure, target)} a month. ${buttonNumber(measure, checkIn.offer.choices.aBitMore)} is recommended for ${month}, a bit above your usual of about ${formatNumber(checkIn.offer.usualAbout)}.`
      : `No recommendation this month: no ${portalGoalUnit(measure, 2)} in the last ${checkIn.weeks} weeks.`
  return {
    label: `For ${month}`,
    headline: checkInHeadline(lastMonth),
    sub,
    use,
    keep: {
      label: `Keep ${buttonNumber(measure, target)}`,
      toast: `${month} stays at ${kept}`,
    },
    other: 'Other number',
    note: `Nothing changes unless you choose. ${month} counts against ${kept} until then.`,
  }
}

/** K-7: the recommended number is the month's already. */
export function sameNumberWords(
  checkIn: Extract<PortalGoalCheckIn, { kind: 'same' }>,
): Readonly<{ text: string; change: string }> {
  return {
    text: `${monthName(checkIn.month)} stays at ${formatNumber(checkIn.target)}. It is still the recommended number.`,
    change: 'Change',
  }
}
