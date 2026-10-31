// Which reviews a Guest voice 2.0 read counts, and over which window: Review's own count
// of the Property's reviews (those with only stars included), read once for the window
// and the 12 months before it, with the same fallbacks the v2 insights read has when a
// Property has more reviews than one read can hold.
import type {
  AiReviewSourcePort,
  AiTrendPopulationRequest,
  AiTrendPopulationResult,
  AiTrendPopulationReview,
} from '#/contexts/review/application/public-api'
import { chooseEvidenceWindow } from '../../domain/guest-voice-statistics'
import { addDays } from '../local-date'
import type { Window } from './guest-voice-v2'

const WINDOW_DAYS: Readonly<Record<Window, number>> = {
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
}

/** The 12 months a change is measured against, which end the day before the window starts. */
export const BASELINE_DAYS = 365

/** The most reviews one population read may hold; a full result is strictly smaller. */
export const POPULATION_QUERY_LIMIT = 10_001

export type PopulationScope = Omit<
  AiTrendPopulationRequest,
  'startLocalDate' | 'detectEvidenceBeforeStart'
>

export const GUEST_VOICE_RANGES = ['auto', '30d', '90d', '180d', '365d'] as const
export type PopulationRange = (typeof GUEST_VOICE_RANGES)[number]

export type PopulationChoice = Readonly<{
  window: Window
  startLocalDate: string
  coveredStartLocalDate: string
  /** Every review from (at least) the window's start to its end. */
  reviews: readonly AiTrendPopulationReview[]
  /** Whether `reviews` also holds the 12 months before the window. */
  hasBaseline: boolean
  /** Whether the last 12 months hold enough reviews with text to spot patterns. */
  enough: boolean
}>

type PopulationReader = Pick<AiReviewSourcePort, 'readTrendPopulation'>

export function windowStart(endLocalDate: string, window: Window): string {
  return addDays(endLocalDate, -(WINDOW_DAYS[window] - 1))
}

function read(
  reader: PopulationReader,
  scope: PopulationScope,
  startLocalDate: string,
): Promise<AiTrendPopulationResult> {
  return reader.readTrendPopulation({
    ...scope,
    startLocalDate,
    detectEvidenceBeforeStart: false,
  })
}

export function textReviewsSince(
  reviews: readonly AiTrendPopulationReview[],
  since: string,
): number {
  return reviews.filter((review) => review.hasText && review.localDate >= since).length
}

/** The shortest window that holds enough reviews with text, from the last 12 months. */
function chooseFrom(reviews: readonly AiTrendPopulationReview[], endLocalDate: string) {
  const since = (window: Window) => windowStart(endLocalDate, window)
  return chooseEvidenceWindow({
    '30d': textReviewsSince(reviews, since('30d')),
    '90d': textReviewsSince(reviews, since('90d')),
    '180d': textReviewsSince(reviews, since('180d')),
    '365d': textReviewsSince(reviews, since('365d')),
  })
}

async function chooseAutomatically(
  reader: PopulationReader,
  scope: PopulationScope,
): Promise<PopulationChoice | null> {
  const end = scope.endLocalDate
  const full = await read(reader, scope, addDays(end, -(2 * BASELINE_DAYS - 1)))
  if (full.status === 'complete') {
    const choice = chooseFrom(full.reviews, end)
    return {
      window: choice.window,
      startLocalDate: windowStart(end, choice.window),
      reviews: full.reviews,
      coveredStartLocalDate: addDays(end, -(2 * BASELINE_DAYS - 1)),
      hasBaseline: true,
      enough: choice.enough,
    }
  }
  if (full.status !== 'limit_exceeded') return null

  // Too many reviews to read two years: read the last twelve months and claim no change.
  const year = await read(reader, scope, windowStart(end, '365d'))
  if (year.status === 'complete') {
    const choice = chooseFrom(year.reviews, end)
    return {
      window: choice.window,
      startLocalDate: windowStart(end, choice.window),
      coveredStartLocalDate: windowStart(end, '365d'),
      reviews: year.reviews,
      hasBaseline: false,
      enough: choice.enough,
    }
  }
  if (year.status !== 'limit_exceeded') return null

  // A year too full to read holds more than enough in any window: the 90 days the page
  // had before the choice was automatic.
  const quarter = await read(reader, scope, windowStart(end, '90d'))
  if (quarter.status !== 'complete') return null
  return {
    window: '90d',
    startLocalDate: windowStart(end, '90d'),
    coveredStartLocalDate: windowStart(end, '90d'),
    reviews: quarter.reviews,
    hasBaseline: false,
    enough: true,
  }
}

async function chooseExplicitly(
  reader: PopulationReader,
  scope: PopulationScope,
  window: Window,
): Promise<PopulationChoice | null> {
  const end = scope.endLocalDate
  const start = windowStart(end, window)
  const full = await read(reader, scope, addDays(start, -BASELINE_DAYS))
  if (full.status === 'complete') {
    return {
      window,
      startLocalDate: start,
      coveredStartLocalDate: addDays(start, -BASELINE_DAYS),
      reviews: full.reviews,
      hasBaseline: true,
      enough: chooseFrom(full.reviews, end).enough,
    }
  }
  if (full.status !== 'limit_exceeded') return null
  const only = await read(reader, scope, start)
  if (only.status !== 'complete') return null
  // Star-only volume cannot prove pattern eligibility. If this bounded window
  // is small, ask the bounded year rather than reporting its count as a year.
  if (textReviewsSince(only.reviews, start) < 10) {
    const year = await read(reader, scope, windowStart(end, '365d'))
    if (year.status !== 'complete') return null
    return {
      window,
      startLocalDate: start,
      coveredStartLocalDate: windowStart(end, '365d'),
      reviews: year.reviews,
      hasBaseline: false,
      enough: chooseFrom(year.reviews, end).enough,
    }
  }
  return {
    window,
    startLocalDate: start,
    coveredStartLocalDate: start,
    reviews: only.reviews,
    hasBaseline: false,
    enough: true,
  }
}

/**
 * The window the page is drawn over and the reviews Review counts in and before it.
 * Null when Review cannot answer (the read is refused, or even the window alone is
 * too full to read): the page is then "preparing", never a zero.
 */
export function choosePopulation(
  reader: PopulationReader,
  scope: PopulationScope,
  range: PopulationRange,
): Promise<PopulationChoice | null> {
  return range === 'auto'
    ? chooseAutomatically(reader, scope)
    : chooseExplicitly(reader, scope, range)
}
