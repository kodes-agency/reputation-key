// Monthly portal goal — the recommended number (ADR 0068 decisions 4 and 5).
//
// A Property's recommended number comes from what its Portals usually bring
// in. The basis W is the 28 whole Property-local days ending yesterday. A
// Portal's live days are the days of W, from the measure versions' first day
// on, on which it was live for any part of the day: the go-live day counts as
// day 1, and a short disable drops only the whole days it covers. A Portal
// joins the rate once it is published, live, and has 14 live days. The
// Property's rate R is the sum, over those Portals, of each one's readings on
// its live days over its live days. Then for a month of D days, x = R × D:
//
//   your usual   roundUp(x)
//   a bit more   max(roundUp(1.1 x), up(usual))       the recommended number
//   stretch      max(roundUp(1.2 x), up(a bit more))
//
// For the rest of the current month, with S already counted (today included)
// and L days left (today included), x = R × L, and each choice is S plus the
// lifted x, the first at least up(S): never at or below what already counts.
// `roundUp` and `up` are the one grid of `goal-number-steps.ts`. A measure
// with R = 0 has no choices. Everything that decides a number is an exact
// BigInt rational: the denominators are live days, whose least common
// multiple is beyond a float's integers.
//
// The month so far S counts every reading of the Property, a Portal's or not,
// listed or not (drafts, disabled, archived and deleted Portals, and readings
// with no Portal), because a Property goal counts them all; what the listed
// published Portals do not account for is `elsewhere`. A suggestion is never a
// result: a running goal's figure comes from the governed read.
//
// Pure. Days are Property-local `YYYY-MM-DD`, decided here, never on a client.

import { propertyWallClockToInstant } from '#/shared/domain/property-calendar'
import { goalMonthDays } from './goal-pace'
import { defaultGoalStartMonth, goalStartOptions } from './goal-start'
import { goalStepAtOrAbove, goalStepUp, type ExactCount } from './goal-number-steps'
import {
  portalQuietFact,
  portalReadiness,
  type PortalQuietFact,
} from './goal-portal-readiness'
import { addLocalDays, localDateOf } from './portal-results-series'
import type {
  Choices,
  MeasureRecommendation,
  PerMeasure,
  PortalFacts,
  PortalGoalMeasure,
  PortalGoalRatio,
  PortalGoalRecommendation,
  PortalGoalRecommendationState,
  RecommendationDayCount,
  RecommendationPortal,
  RecommendationWindow,
  RecommendPortalGoalInput,
} from './goal-recommendation-types'

/** The basis: this many whole local days, ending yesterday. */
const WINDOW_DAYS = 28
/** A Portal joins the rate with this many live days in the basis. */
const JOIN_DAYS = 14
const LIFT_A_BIT_MORE: ExactCount = { num: 11n, den: 10n }
const LIFT_STRETCH: ExactCount = { num: 6n, den: 5n }
const DAYS_PER_WEEK = 7
const BASIS_WEEKS = [2, 3, 4] as const

function localMidnight(localDay: string, timezone: string): Date {
  const [year = 0, month = 1, day = 1] = localDay.split('-').map(Number)
  return propertyWallClockToInstant(
    { year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timezone,
  )
}

/** The basis: the 28 whole Property-local days ending yesterday. */
export function recommendationWindow(now: Date, timezone: string): RecommendationWindow {
  const today = localDateOf(now, timezone)
  const firstDay = addLocalDays(today, -WINDOW_DAYS)
  return {
    today,
    firstDay,
    lastDay: addLocalDays(today, -1),
    start: localMidnight(firstDay, timezone),
    end: localMidnight(today, timezone),
  }
}

// ── Exact arithmetic ──────────────────────────────────────────────────────

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

function exact(num: bigint, den: bigint): ExactCount {
  const divisor = gcd(num < 0n ? -num : num, den) || 1n
  return { num: num / divisor, den: den / divisor }
}

const whole = (value: number): ExactCount => exact(BigInt(value), 1n)
const plus = (a: ExactCount, b: ExactCount): ExactCount =>
  exact(a.num * b.den + b.num * a.den, a.den * b.den)
const times = (a: ExactCount, b: ExactCount): ExactCount =>
  exact(a.num * b.num, a.den * b.den)
const halfUp = (value: ExactCount): number =>
  Number((2n * value.num + value.den) / (2n * value.den))
const onTheWire = (value: ExactCount): PortalGoalRatio => ({
  num: value.num.toString(),
  den: value.den.toString(),
})

// ── Live days and counts ──────────────────────────────────────────────────

/** The local days of W, from `firstAllowed` on, on which any interval was open. */
function liveDaysInWindow(
  intervals: RecommendationPortal['liveIntervals'],
  window: RecommendationWindow,
  firstAllowed: string,
  timezone: string,
): ReadonlySet<string> {
  const days = new Set<string>()
  for (const interval of intervals) {
    const from = Math.max(interval.from.getTime(), window.start.getTime())
    const to = Math.min(interval.to?.getTime() ?? Infinity, window.end.getTime())
    if (to <= from) continue
    const last = localDateOf(new Date(to - 1), timezone)
    for (
      let day = localDateOf(new Date(from), timezone);
      day <= last;
      day = addLocalDays(day, 1)
    ) {
      if (day >= firstAllowed) days.add(day)
    }
  }
  return days
}

const perMeasure = <T>(of: (measure: PortalGoalMeasure) => T): PerMeasure<T> => ({
  portal_rating_count: of('portal_rating_count'),
  qualified_scans: of('qualified_scans'),
})

function sumWhere(
  rows: readonly RecommendationDayCount[],
  counts: (row: RecommendationDayCount) => boolean,
): PerMeasure<number> {
  return perMeasure((measure) =>
    rows.reduce(
      (sum, row) => (row.measure === measure && counts(row) ? sum + row.count : sum),
      0,
    ),
  )
}

type Context = Readonly<{
  timezone: string
  window: RecommendationWindow
  firstAllowed: string
  monthFirstDay: string
  rowsByPortal: ReadonlyMap<string | null, readonly RecommendationDayCount[]>
  lastScanAt: ReadonlyMap<string, Date>
}>

type PortalBasis = Readonly<{
  facts: PortalFacts
  live: boolean
  established: boolean
}>

function quietFields(fact: PortalQuietFact | null) {
  return {
    noScanSinceCodeDays: fact?.kind === 'no_scan_since_code' ? fact.days : null,
    noScansSince:
      fact?.kind === 'no_scans_since'
        ? { since: fact.since, usualPerWeek: fact.usualPerWeek }
        : null,
  }
}

function portalBasisOf(
  portal: RecommendationPortal & Readonly<{ publicationState: 'published' | 'disabled' }>,
  context: Context,
): PortalBasis {
  const { timezone, window } = context
  const lastScanAt = context.lastScanAt.get(portal.portalId) ?? null
  const readiness = portalReadiness({ ...portal, lastScanAt })
  const live = readiness.live && portal.publicationState === 'published'
  const days = liveDaysInWindow(
    portal.liveIntervals,
    window,
    context.firstAllowed,
    timezone,
  )
  const rows = context.rowsByPortal.get(portal.portalId) ?? []
  const windowCounts = sumWhere(rows, (row) => days.has(row.localDay))
  const established = live && days.size >= JOIN_DAYS
  const codeMadeOn =
    readiness.codeMade && portal.codeIssuedAt
      ? localDateOf(portal.codeIssuedAt, timezone)
      : null
  const lastScanOn = lastScanAt ? localDateOf(lastScanAt, timezone) : null
  const quiet = portalQuietFact({
    today: window.today,
    readiness,
    established,
    liveDays: days.size,
    scans: windowCounts.qualified_scans,
    codeMadeOn,
    lastScanOn,
  })
  return {
    live,
    established,
    facts: {
      portalId: portal.portalId,
      name: portal.name,
      publicationState: portal.publicationState,
      liveSince: portal.liveSince ? localDateOf(portal.liveSince, timezone) : null,
      liveDays: days.size,
      joinsOn:
        live && !established ? addLocalDays(window.today, JOIN_DAYS - days.size) : null,
      inBasis: established,
      codeMadeOn,
      firstScan: readiness.firstScan,
      lastScanOn,
      window: windowCounts,
      monthToDate: sumWhere(rows, (row) => row.localDay >= context.monthFirstDay),
      ...quietFields(quiet),
    },
  }
}

// ── Choices and states ────────────────────────────────────────────────────

/** R: each joined Portal's readings on its live days over its live days. */
function propertyRate(
  established: readonly PortalBasis[],
  measure: PortalGoalMeasure,
): ExactCount {
  return established.reduce(
    (rate, { facts }) =>
      plus(rate, exact(BigInt(facts.window[measure]), BigInt(facts.liveDays))),
    whole(0),
  )
}

/**
 * The three choices from `x`, each at least a step above the one before. With
 * `soFar` they are on top of it, and the first is at least a step above it.
 */
function liftedChoices(soFar: number | null, x: ExactCount): Choices {
  const base = whole(soFar ?? 0)
  const rounded = (lift: ExactCount | null) =>
    goalStepAtOrAbove(plus(base, lift ? times(x, lift) : x))
  const usual =
    soFar === null ? rounded(null) : Math.max(rounded(null), goalStepUp(soFar))
  const aBitMore = Math.max(rounded(LIFT_A_BIT_MORE), goalStepUp(usual))
  const stretch = Math.max(rounded(LIFT_STRETCH), goalStepUp(aBitMore))
  return { usual, aBitMore, stretch, about: halfUp(x) }
}

type Months = PortalGoalRecommendation['months']

function measureRecommendation(
  state: MeasureRecommendation['state'],
  rate: ExactCount,
  months: Months,
  soFar: number,
): MeasureRecommendation {
  if (state !== 'ready') {
    return {
      state,
      usualPerMonth: { current: null, next: null },
      fullMonth: { current: null, next: null },
      fromToday: null,
    }
  }
  const current = times(rate, whole(months.current.days))
  const next = times(rate, whole(months.next.days))
  return {
    state,
    usualPerMonth: { current: onTheWire(current), next: onTheWire(next) },
    fullMonth: { current: liftedChoices(null, current), next: liftedChoices(null, next) },
    fromToday: liftedChoices(
      Math.max(0, soFar),
      times(rate, whole(months.current.daysLeftWithToday)),
    ),
  }
}

/** E7: ratings first; scans only when ratings had nothing; else unreadable. */
function recommendationState(
  measures: PerMeasure<MeasureRecommendation['state']>,
  live: boolean,
  established: boolean,
): PortalGoalRecommendationState {
  if (!live) return 'no_live_portal'
  if (!established) return 'getting_ready'
  const ratings = measures.portal_rating_count
  const scans = measures.qualified_scans
  if (ratings === 'ready') return 'ready'
  if (ratings === 'nothing' && scans === 'ready') return 'scans_only'
  if (ratings === 'nothing' && scans === 'nothing') return 'nothing_counted'
  return 'unreadable'
}

function monthsOf(now: Date, timezone: string): Months & Readonly<{ firstDay: string }> {
  const { current, next } = goalStartOptions(now, timezone)
  const days = goalMonthDays(current.period, now, timezone)
  return {
    firstDay: localDateOf(current.period.start, timezone),
    current: {
      key: current.monthKey,
      days: days.totalDays,
      daysLeftWithToday: days.daysLeft + 1,
    },
    next: {
      key: next.monthKey,
      days: goalMonthDays(next.period, next.period.start, timezone).totalDays,
    },
  }
}

function basisOf(established: readonly PortalBasis[]): PortalGoalRecommendation['basis'] {
  if (established.length === 0) return null
  const longest = Math.max(...established.map(({ facts }) => facts.liveDays))
  return {
    portals: established.length,
    weeks: BASIS_WEEKS.filter((weeks) => weeks * DAYS_PER_WEEK <= longest).at(-1) ?? 2,
    counts: perMeasure((measure) =>
      established.reduce((sum, { facts }) => sum + facts.window[measure], 0),
    ),
  }
}

function readyOnOf(bases: readonly PortalBasis[], today: string): string | null {
  const liveDays = bases.filter(({ live }) => live).map(({ facts }) => facts.liveDays)
  return liveDays.length === 0
    ? null
    : addLocalDays(today, JOIN_DAYS - Math.max(...liveDays))
}

function groupByPortal(
  rows: readonly RecommendationDayCount[],
): ReadonlyMap<string | null, readonly RecommendationDayCount[]> {
  const groups = new Map<string | null, RecommendationDayCount[]>()
  for (const row of rows) {
    const group = groups.get(row.portalId)
    if (group) group.push(row)
    else groups.set(row.portalId, [row])
  }
  return groups
}

const isListed = (
  portal: RecommendationPortal,
): portal is RecommendationPortal &
  Readonly<{ publicationState: 'published' | 'disabled' }> =>
  portal.publicationState !== 'draft'

export function recommendPortalGoal(
  input: RecommendPortalGoalInput,
): PortalGoalRecommendation {
  const { now, timezone } = input
  const window = recommendationWindow(now, timezone)
  const months = monthsOf(now, timezone)
  const context: Context = {
    timezone,
    window,
    firstAllowed: localDateOf(input.versionFrom, timezone),
    monthFirstDay: months.firstDay,
    rowsByPortal: groupByPortal(input.days),
    lastScanAt: input.lastScanAt,
  }
  const bases = input.portals
    .filter(isListed)
    .map((portal) => portalBasisOf(portal, context))
  const established = bases.filter((basis) => basis.established)
  const unreadable = new Set(input.unreadable.map((entry) => entry.measure))
  const monthTotals = sumWhere(input.days, (row) => row.localDay >= months.firstDay)
  const measures = perMeasure((measure) => {
    const rate = propertyRate(established, measure)
    const state = unreadable.has(measure)
      ? 'unreadable'
      : rate.num === 0n
        ? 'nothing'
        : 'ready'
    return measureRecommendation(state, rate, months, monthTotals[measure])
  })
  const state = recommendationState(
    perMeasure((measure) => measures[measure].state),
    bases.some((basis) => basis.live),
    established.length > 0,
  )
  const published = bases.filter(({ facts }) => facts.publicationState === 'published')
  return {
    asOf: now.toISOString(),
    timezone,
    window: { firstDay: window.firstDay, lastDay: window.lastDay },
    state,
    defaultMeasure: state === 'scans_only' ? 'qualified_scans' : 'portal_rating_count',
    defaultMonthKey: defaultGoalStartMonth(now, timezone),
    readyOn: state === 'getting_ready' ? readyOnOf(bases, window.today) : null,
    basis: basisOf(established),
    months: { current: months.current, next: months.next },
    measures,
    monthToDate: perMeasure((measure) =>
      unreadable.has(measure) ? null : monthTotals[measure],
    ),
    elsewhere: perMeasure(
      (measure) =>
        monthTotals[measure] -
        published.reduce((sum, { facts }) => sum + facts.monthToDate[measure], 0),
    ),
    windowTotals: sumWhere(
      input.days,
      (row) => row.localDay >= window.firstDay && row.localDay <= window.lastDay,
    ),
    portals: bases.map(({ facts }) => facts),
    drafts: input.portals
      .filter((portal) => portal.publicationState === 'draft')
      .map(({ portalId, name }) => ({ portalId, name })),
    truncated: input.truncated,
  }
}
