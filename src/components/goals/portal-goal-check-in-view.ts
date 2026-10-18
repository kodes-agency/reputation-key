// The Monthly portal goal's month-start check-in, worded (copy deck K-1…K-9;
// PLAN PG-15): the month before as it stands (so far, while it is read; then
// met or not met), the month the check-in asks about, "Use 45" with what it
// stands on, "Keep 40", another number, and that nothing changes unless a
// manager chooses; with nothing counted, the fact instead of a number; with
// the recommended number the month's already, one line. The read decides
// whether it asks, the month, the numbers and the weeks (PLAN E12); this only
// says them. Pure.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalCheckIn,
  PortalGoalLastMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatNumber } from '#/lib/format'
import { lastMonthWords } from './portal-goal-running-view'
import { dayWords, monthName, portalGoalCount, portalGoalUnit } from './portal-goal-words'

/**
 * K-1 while the month before is read: what it has so far, and the day its
 * final figure is due (until that day has gone); with no figure to say yet,
 * the card's own line (G-30). K-6: once it has closed, met or not met (G-31).
 */
export function checkInLastMonthWords(
  lastMonth: PortalGoalLastMonth | null,
): Readonly<{ text: string; met: boolean }> | null {
  if (lastMonth === null) return null
  const { key, value, target, outcome, finalOn } = lastMonth
  if (outcome !== 'updating' || value === null) return lastMonthWords(lastMonth)
  const soFar = `${monthName(key)}: ${formatNumber(value)} of ${formatNumber(target)} so far.`
  return {
    text: finalOn === null ? soFar : `${soFar} Final figure on ${dayWords(finalOn)}.`,
    met: false,
  }
}

/** "45" for private ratings, "55 scans" for scans: as the ready card's Use says it. */
const buttonNumber = (measure: PortalGoalMeasure, n: number): string =>
  measure === 'portal_rating_count' ? formatNumber(n) : portalGoalCount(measure, n)

export type PortalGoalCheckInWords = Readonly<{
  /** K-2: the region's heading, "For December". */
  heading: string
  /** K-3 and K-9: "Use 45", what it stands on, and its toast; none with nothing to offer. */
  use: Readonly<{
    label: string
    caption: string
    targetValue: number
    toast: string
  }> | null
  /** K-8: with nothing to offer, why. */
  lead: string | null
  /** K-4 and K-9: "Keep 40", and its toast. */
  keep: Readonly<{ label: string; toast: string }>
  /** K-4: the way to another number, through the change sheet. */
  other: string
  /** K-5 */
  foot: string
}>

/** The check-in that asks (an offer, or nothing to offer), worded. */
export function checkInWords(
  checkIn: Extract<PortalGoalCheckIn, { kind: 'offer' | 'nothing' }>,
): PortalGoalCheckInWords {
  const month = monthName(checkIn.month)
  const { measure, target } = checkIn
  const kept = formatNumber(target)
  const use =
    checkIn.kind === 'offer'
      ? {
          label: `Use ${buttonNumber(measure, checkIn.offer.choices.aBitMore)}`,
          caption: `Recommended · a bit above your usual of about ${formatNumber(checkIn.offer.usualAbout)}`,
          targetValue: checkIn.offer.choices.aBitMore,
          toast: `${month} goal: ${portalGoalCount(measure, checkIn.offer.choices.aBitMore)}`,
        }
      : null
  return {
    heading: `For ${month}`,
    use,
    lead:
      checkIn.kind === 'nothing'
        ? `No recommendation this month: no ${portalGoalUnit(measure, 2)} in the last ${checkIn.weeks} weeks.`
        : null,
    keep: {
      label: `Keep ${buttonNumber(measure, target)}`,
      toast: `${month} stays at ${kept}`,
    },
    other: 'Other number',
    foot: `Nothing changes unless you choose. ${month} counts against ${kept} until then.`,
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
