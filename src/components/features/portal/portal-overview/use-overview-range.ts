// The Portals overview's window. It is the reader's own viewing preference and
// follows them from the Results tab, so it is remembered in the browser, never
// in the URL. Storage can be absent or throw (private windows, blocked site
// data), and the server renders before any of it is readable: on the server the
// hook reports `ready: false`, and the page reads nothing until the browser has
// looked, so the stored range is fetched once rather than the default and then it.
import { useSyncExternalStore } from 'react'
import type { PortalResultsTimeRange } from '#/contexts/reporting/application/public-api'
import {
  PORTAL_RESULTS_RANGE_STORAGE_KEY,
  storedOverviewRange,
} from '../portal-analytics/portal-results-window'

const listeners = new Set<() => void>()

/** The choice made on this page, which holds even where storage cannot keep it. */
let chosen: PortalResultsTimeRange | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function readStoredRange(): PortalResultsTimeRange {
  if (chosen !== null) return chosen
  try {
    return storedOverviewRange(localStorage.getItem(PORTAL_RESULTS_RANGE_STORAGE_KEY))
  } catch {
    return storedOverviewRange(null)
  }
}

function rememberRange(range: PortalResultsTimeRange): void {
  chosen = range
  try {
    localStorage.setItem(PORTAL_RESULTS_RANGE_STORAGE_KEY, range)
  } catch {
    // A preference write must never take down the page.
  }
  for (const listener of listeners) listener()
}

const noSubscription = () => () => undefined

export function useOverviewRange() {
  const timeRange = useSyncExternalStore(subscribe, readStoredRange, () =>
    storedOverviewRange(null),
  )
  const ready = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
  return { timeRange, setTimeRange: rememberRange, ready } as const
}
