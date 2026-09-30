// Where the Portals overview's window lives. Storage is the source of truth, so
// a range picked on a Results tab is what the overview reads next: this module
// never answers from its own copy while storage can answer. Storage can be
// absent or throw (private windows, blocked site data), so a pick it could not
// keep is held here for this page and used only when storage has nothing to say.
import type { PortalResultsTimeRange } from '#/contexts/reporting/application/public-api'
import {
  PORTAL_RESULTS_RANGE_STORAGE_KEY,
  storedOverviewRange,
} from '../portal-analytics/portal-results-window'

const listeners = new Set<() => void>()

/** A pick storage refused. Cleared by the next write storage accepts. */
let unsaved: PortalResultsTimeRange | null = null

export function subscribeOverviewRange(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export function readOverviewRange(): PortalResultsTimeRange {
  try {
    const stored = localStorage.getItem(PORTAL_RESULTS_RANGE_STORAGE_KEY)
    if (stored !== null || unsaved === null) return storedOverviewRange(stored)
  } catch {
    // Fall through to the pick held for this page.
  }
  return unsaved ?? storedOverviewRange(null)
}

export function rememberOverviewRange(range: PortalResultsTimeRange): void {
  try {
    localStorage.setItem(PORTAL_RESULTS_RANGE_STORAGE_KEY, range)
    unsaved = null
  } catch {
    // A preference write must never take down the page.
    unsaved = range
  }
  for (const listener of listeners) listener()
}
