// The three questions on the Monthly portal goal's page, in words (pure; 2026-11-01,
// ADR 0068): where they are coming from, how the month compares and what a manager
// can do this week; the shape Guest voice, Portal Results and the Google rating
// goal's page use. It never names a winner: Portals stay in name order with plain
// counts (P-1), and the one Portal it names is one that has gone quiet (P-7). The
// read decides every state and number; this only says them.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalPageMonth,
  PortalGoalPageTiles,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type { PortalGoalRunningMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import type { Tone } from '#/components/ui/tone'
import { formatNumber } from '#/lib/format'
import type { GoalColumn } from './goal-columns-view'
import { PORTAL_ASK_EVERY_GUEST_LINE, PORTAL_NO_SCAN_HINT } from './portal-goal-copy'
import { stripChips, type fromPortalsWords } from './portal-goal-page-view'
import { portalGoalUnit } from './portal-goal-words'

export type PortalBandIcon = 'where' | 'months' | 'flag'

export type PortalBandWords = Readonly<{
  title: string
  icon: PortalBandIcon
  answer: string
  hint: string | null
  tone: Tone
}>

type FromPortals = ReturnType<typeof fromPortalsWords>

/** Each Portal's count, without what the rest brought in. */
const portalRows = (words: FromPortals) =>
  (words.rows ?? []).filter((row) => row.key !== 'elsewhere')

/** Null with nothing to say: no counts that add up, and no Portal gone quiet. */
export function whereBand(words: FromPortals): PortalBandWords | null {
  const title = 'Where are they coming from?'
  const [quiet] = words.quiet
  if (quiet !== undefined) {
    return {
      title,
      icon: 'where',
      answer:
        words.quiet.length === 1
          ? `${quiet.name} has gone quiet`
          : `${formatNumber(words.quiet.length)} portals have gone quiet`,
      hint:
        words.quiet.length === 1
          ? `${quiet.text} ${PORTAL_NO_SCAN_HINT}`
          : PORTAL_NO_SCAN_HINT,
      tone: 'warn',
    }
  }
  if (words.rows === null) return null
  const rows = portalRows(words)
  const counting = rows.filter((row) => row.count !== formatNumber(0)).length
  // What draft, disabled or archived Portals brought in: "all from" must not leave it out.
  const others = words.rows.length > rows.length
  const say = (
    answer: string,
    tone: Tone,
    hint: string | null = null,
  ): PortalBandWords => ({
    title,
    icon: 'where',
    answer,
    hint,
    tone,
  })
  const [only] = rows
  if (counting === 0) {
    return others
      ? say('All from other portals', 'neutral')
      : say('Nothing yet this month', 'neutral')
  }
  if (rows.length === 1 && only !== undefined) {
    return others
      ? say(`From ${only.name} and other portals`, 'neutral')
      : say(`All from ${only.name}`, 'positive')
  }
  return counting === rows.length
    ? say(
        `All ${formatNumber(rows.length)} portals are bringing them in`,
        'positive',
        'No portal has gone quiet.',
      )
    : say(
        `From ${formatNumber(counting)} of your ${formatNumber(rows.length)} portals`,
        'neutral',
      )
}

/** A week of a month is enough to say where it is heading. */
const DAYS_BEFORE_A_PACE = 7
/** Within this share of the usual a month is "about your usual". */
const ABOUT_USUAL = 0.1

/** Where the month would end at its pace so far; null while too early or with no figure. */
function endOfMonth(month: PortalGoalRunningMonth | null): number | null {
  if (month === null || month.value === null) return null
  if (month.quietDays || month.elapsedDays < DAYS_BEFORE_A_PACE) return null
  return Math.round((month.value / month.elapsedDays) * month.totalDays)
}

export function compareBand(
  month: PortalGoalRunningMonth | null,
  tiles: PortalGoalPageTiles | null,
): PortalBandWords {
  const title = 'How does this month compare?'
  const usual = tiles?.usual?.about ?? null
  const usualWords =
    usual === null ? null : `You usually get about ${formatNumber(usual)} a month.`
  const end = endOfMonth(month)
  if (month === null) {
    return {
      title,
      icon: 'months',
      answer: 'No month is counting now',
      hint: usualWords,
      tone: 'neutral',
    }
  }
  if (month.value === null) {
    return {
      title,
      icon: 'months',
      answer: 'Can’t tell right now',
      hint: usualWords,
      tone: 'neutral',
    }
  }
  if (end === null) {
    return {
      title,
      icon: 'months',
      answer: 'Too early to say',
      hint: usualWords,
      tone: 'neutral',
    }
  }
  const pace = `At this pace you’d end around ${formatNumber(end)}.`
  const hint = usualWords === null ? pace : `${usualWords} ${pace}`
  if (usual === null) {
    return end >= month.target
      ? {
          title,
          icon: 'months',
          answer: 'On course for your number',
          hint,
          tone: 'positive',
        }
      : {
          title,
          icon: 'months',
          answer: 'Short of your number so far',
          hint,
          tone: 'neutral',
        }
  }
  if (end < usual * (1 - ABOUT_USUAL)) {
    return {
      title,
      icon: 'months',
      answer: 'A slower month so far',
      hint,
      tone: 'neutral',
    }
  }
  return end > usual * (1 + ABOUT_USUAL)
    ? { title, icon: 'months', answer: 'Better than usual', hint, tone: 'positive' }
    : { title, icon: 'months', answer: 'About your usual', hint, tone: 'neutral' }
}

/** Past this many months the bars start to crowd a phone. */
const MONTHS_SHOWN = 12

export type MonthBars = Readonly<{
  columns: readonly GoalColumn[]
  caption: string
  /** The months before this measure, which the bars leave out. */
  earlier: string | null
}>

/**
 * The months of what the goal counts now, oldest first: a bar for its figure, the
 * mark for its own number and a check when met; one still counting is dashed. Null
 * under two months: one bar compares nothing.
 */
export function monthBars(
  months: readonly PortalGoalPageMonth[],
  measure: PortalGoalMeasure,
  today: string,
): MonthBars | null {
  const chips = new Map(stripChips(months, today).map((chip) => [chip.key, chip]))
  const same = months.filter((month) => month.measure === measure)
  if (same.length < 2) return null
  const columns = [...same]
    .reverse()
    .slice(-MONTHS_SHOWN)
    .map((month): GoalColumn => {
      const chip = chips.get(month.key)
      const open = month.outcome === 'running' || month.outcome === 'updating'
      return {
        key: month.key,
        label: chip?.title.slice(0, 3) ?? month.key,
        value: month.value,
        figure: month.value === null ? null : formatNumber(month.value),
        tone: open ? 'open' : 'since',
        mark: month.target,
        met: month.outcome === 'met',
        line: chip === undefined ? month.key : `${chip.title}: ${chip.lines.join(' · ')}`,
      }
    })
  const unit = portalGoalUnit(measure, 2)
  return {
    columns,
    caption: `${unit.charAt(0).toUpperCase()}${unit.slice(1)} each month. The short line is that month’s number.`,
    earlier:
      same.length < months.length
        ? `Earlier months counted ${measure === 'qualified_scans' ? 'private ratings' : 'scans'}.`
        : null,
  }
}

export function todoBand(
  measure: PortalGoalMeasure,
  month: PortalGoalRunningMonth | null,
): PortalBandWords {
  const line =
    measure === 'qualified_scans'
      ? 'Put your codes where guests can see them.'
      : PORTAL_ASK_EVERY_GUEST_LINE
  const passed = month?.value !== null && month !== null && month.value >= month.target
  return {
    title: 'What can you do this week?',
    icon: 'flag',
    answer: passed || month?.belowPace === false ? 'Keep going' : 'Ask every guest',
    hint: line,
    tone: 'neutral',
  }
}

/** "Check Restaurant’s code": what to do about a Portal gone quiet. */
export const quietRow = (name: string): Readonly<{ title: string; note: string }> => ({
  title: `Check ${name}’s code`,
  note: 'See it, print it again, or move it.',
})

/** "Your usual is about 34 a month.", under the way to change the number. */
export const changeNumberNote = (tiles: PortalGoalPageTiles | null): string | null =>
  tiles?.usual ? `Your usual is about ${formatNumber(tiles.usual.about)} a month.` : null
