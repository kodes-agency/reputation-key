// How a dashboard topic page (Ratings, Guest voice) reads its range.
//
// The range used to be a loader dependency, so choosing one made a new route
// match, and a new match shows the route's pending fallback at once: the page
// (header, range control and all) was replaced by a skeleton and the keyboard
// focus was lost. Now the range is not a dependency. The loader primes the range
// the URL names when the page is entered, and the page reads whatever range is
// chosen through the query cache, keeping the previous one on screen, dimmed,
// until the new one arrives.
import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import {
  dashboardRangeSearch,
  guestVoiceRangeSearch,
  type DashboardRange,
  type GuestVoiceRange,
} from '#/shared/dashboard-range'

function rangeOfSearch(location: Readonly<{ search: unknown }>): unknown {
  const search = location.search
  return typeof search === 'object' && search !== null && 'range' in search
    ? search.range
    : undefined
}

/**
 * The range the URL names, for a loader. A loader must not read search that has
 * not been validated, so the same schema as the route's reads it: anything but a
 * preset is the default, as it is for the page.
 */
export function rangeOfLocation(location: Readonly<{ search: unknown }>): DashboardRange {
  return dashboardRangeSearch.parse(rangeOfSearch(location))
}

/** `rangeOfLocation` for Guest voice, whose presets add `auto` and 12 months. */
export function guestVoiceRangeOfLocation(
  location: Readonly<{ search: unknown }>,
): GuestVoiceRange {
  return guestVoiceRangeSearch.parse(rangeOfSearch(location))
}

/**
 * The data of a read that is kept on screen between ranges. It is always there
 * once the loader has primed the page; the one way it is not is a failed read,
 * which is the route's error to show (its Try again), so it is thrown.
 */
export function keptData<T>(query: Pick<UseQueryResult<T>, 'data' | 'error'>): T | null {
  if (query.data !== undefined) return query.data
  if (query.error) throw query.error
  return null
}

/**
 * The range of the figures on screen. While the next range is read the page keeps
 * the previous range's figures, so what describes them (the comparison wording,
 * the chart's buckets) must stay the previous range's too; only the range control
 * moves to the one just chosen. Settled during render, as `SearchField` does.
 */
export function useRangeOfShownData(
  range: DashboardRange,
  isPlaceholderData: boolean,
): DashboardRange {
  const [shown, setShown] = useState(range)
  if (!isPlaceholderData && shown !== range) setShown(range)
  return isPlaceholderData ? shown : range
}
