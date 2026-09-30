// The Portals overview's window. It is the reader's own viewing preference and
// follows them from the Results tab, so it is remembered in the browser, never
// in the URL (see overview-range-store). The server renders before any of it is
// readable: on the server the hook reports `ready: false`, and the page reads
// nothing until the browser has looked, so the stored range is fetched once
// rather than the default and then it.
import { useSyncExternalStore } from 'react'
import { storedOverviewRange } from '../portal-analytics/portal-results-window'
import {
  readOverviewRange,
  rememberOverviewRange,
  subscribeOverviewRange,
} from './overview-range-store'

const noSubscription = () => () => undefined

export function useOverviewRange() {
  const timeRange = useSyncExternalStore(subscribeOverviewRange, readOverviewRange, () =>
    storedOverviewRange(null),
  )
  const ready = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
  return { timeRange, setTimeRange: rememberOverviewRange, ready } as const
}
