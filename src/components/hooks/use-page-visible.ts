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
 * Visibility only, deliberately: this hook used to AND `document.hasFocus()`,
 * which made a *blurred but still visible* window (another application in
 * front, the address bar focused, an undocked DevTools panel) stop renewing a
 * 30-second lease while the provider content stayed rendered on screen. The
 * lease then expired and the surfaces hard-cleared - the Google import wizard
 * threw away the account choice, every ticked location and the half-typed
 * country/timezone form, and the property performance panel replaced its chart
 * with a red "Authorization changed" alert. Nothing about the operator's
 * authorization had changed; they had looked at another window for half a
 * minute.
 *
 * Hiding the page is the boundary that actually matters, and it is already
 * handled: `visibilitychange`/`freeze`/`pagehide` trigger a deliberate privacy
 * clear of provider content, and `refetchIntervalInBackground: false` stops the
 * polling itself. Focus adds no privacy guarantee on top of that, only a way to
 * lose work.
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
