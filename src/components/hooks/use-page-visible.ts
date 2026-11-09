import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void) {
  document.addEventListener('visibilitychange', onStoreChange)
  return () => {
    document.removeEventListener('visibilitychange', onStoreChange)
  }
}

/**
 * Whether provider content on this page is still on screen.
 *
 * Exported so the rule can be asserted without a DOM: the argument is
 * deliberately the whole document, so a future change that reintroduces a
 * focus condition has to widen this signature and fail its test.
 */
export function pageVisible(doc: Document): boolean {
  return doc.visibilityState === 'visible'
}

function getSnapshot() {
  return pageVisible(document)
}

/**
 * Whether the page is on screen, used to gate provider-authorization lease
 * renewal.
 *
 * Visibility only, deliberately: also requiring `document.hasFocus()` made a
 * blurred but still visible window (another application in front, an undocked
 * DevTools panel) stop renewing the 30-second lease while provider content stayed
 * on screen, so the lease expired and the surfaces hard-cleared (the import
 * wizard lost its input). Hiding the page is the boundary that matters:
 * `visibilitychange`/`freeze`/`pagehide` trigger the privacy clear and
 * `refetchIntervalInBackground: false` stops polling. Focus adds no privacy
 * guarantee, only a way to lose work.
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
