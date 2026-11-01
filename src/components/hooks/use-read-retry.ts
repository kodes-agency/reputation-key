// "Try again" on a read that failed, as every control that retries a read presses
// it. A tab whose code is older than the server's gets the same refusal however
// often it asks, so there the press loads the page afresh (shared/stale-tab) and
// `reloading` keeps the control busy until the page goes. A retry that is not a
// read (a save) does not come here: it goes through in a stale tab, and a reload
// could lose it.
import { useSyncExternalStore } from 'react'
import { staleTab } from '#/shared/stale-tab/stale-tab'

type ReadRetry = Readonly<{
  /** Run the retry, or load the page afresh when only that can help. */
  tryAgain: () => void
  /** The page is being loaded afresh. */
  reloading: boolean
}>

export function useReadRetry(retry: () => void): ReadRetry {
  const reloading = useSyncExternalStore(
    staleTab.onReloading,
    staleTab.isReloading,
    () => false,
  )
  return { tryAgain: () => staleTab.tryAgain(retry), reloading }
}
