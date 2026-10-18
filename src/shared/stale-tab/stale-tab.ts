// What a browser tab does once it learns its code is older than the server's.
//
// The tab keeps the release that served its page. It is ARMED (stale) when the
// server says it has moved on (release-skew-middleware.ts) or when code the page
// needs is gone (a missing chunk). An armed tab reloads at a moment that costs
// the person nothing:
//   - the next page-to-page navigation, before the new page loads, so the
//     address already in the bar is the one the full page load fetches;
//   - a route that already failed to draw, because it was refused or because
//     its chunk is gone (use-guarded-route-error.tsx).
// It never reloads under a mutation still in flight, never in a loop
// (reload-guard.ts), and never when it does not know its own release: a
// development server, a test, Storybook and a server render all stay inert.
//
// Everything on the reload path is in first paint on purpose. It runs when a
// lazy chunk may be gone, so it cannot depend on loading another one.

import { isChunkLoadMessage } from './chunk-load'
import { createReloadGuard, type ReloadGuardDeps } from './reload-guard'
import { concreteRelease, isStaleClientError } from './release-skew'

export type ReloadOutcome =
  /** A reload is on its way. */
  | 'reloading'
  /** The guard refused: this release already reloaded recently, or nothing could be remembered. */
  | 'refused'
  /** A mutation is in flight; try again at a later moment. */
  | 'deferred'
  /** The tab does not know its release, so there is nothing to compare or reload for. */
  | 'unavailable'

type ReleaseDocument = Readonly<{
  querySelector(selector: string): Pick<Element, 'getAttribute'> | null
}>

type FailureTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

type NavigationEvent = Readonly<{
  pathChanged: boolean
  toLocation: Readonly<{ publicHref: string }>
}>

type NavigationSource = Readonly<{
  subscribe: (
    type: 'onBeforeLoad',
    listener: (event: NavigationEvent) => void,
  ) => () => void
}>

/** The release the server stated in this page's head, if it did. */
export function readReleaseMeta(root: ReleaseDocument): string | undefined {
  return (
    root.querySelector('meta[name="repkey-release"]')?.getAttribute('content') ??
    undefined
  )
}

/** A path on this site (`/x`), never another origin (`//x`, `/\x`, `https:`): else the current address. */
function sitePath(href: unknown): string | undefined {
  return typeof href === 'string' && /^\/(?![/\\])/u.test(href) ? href : undefined
}

export function createStaleTab(deps: ReloadGuardDeps) {
  const guard = createReloadGuard(deps)
  let release: string | undefined
  let stale = false
  let mutationsInFlight = 0
  let reloading = false
  const watchers = new Set<() => void>()

  const tab = {
    /** Keep the release of this page's code. Read once, before any navigation can change the head. */
    remember(value: unknown): void {
      release = concreteRelease(value)
    },

    release: (): string | undefined => release,

    /** The server has moved on. Without a release of its own the tab cannot act on that. */
    markStale(): void {
      if (release) stale = true
    },

    isStale: (): boolean => stale,

    /** Count a mutation as in flight until it settles. Hands the call back untouched. */
    trackMutation<T>(call: Promise<T>): Promise<T> {
      mutationsInFlight += 1
      const settled = (): void => void (mutationsInFlight -= 1)
      call.then(settled, settled)
      return call
    },

    /**
     * Load the page afresh. `target` is where the person is going, for the one
     * moment the address bar does not say so yet (a navigation that has begun).
     */
    reload(target?: string): ReloadOutcome {
      if (!release) return 'unavailable'
      if (mutationsInFlight > 0) return 'deferred'
      const outcome = guard.request(release, sitePath(target))
      if (outcome === 'reloading' && !reloading) {
        reloading = true
        watchers.forEach((watcher) => watcher())
      }
      return outcome
    },

    /** A reload is on its way. With `onReloading`, the shape React's external-store hook reads. */
    isReloading: (): boolean => reloading,

    onReloading(watcher: () => void): () => void {
      watchers.add(watcher)
      return () => void watchers.delete(watcher)
    },

    /** The failures that mean this tab needs the current code: a stale refusal, a missing chunk. */
    needsFreshCode(error: unknown): boolean {
      if (isStaleClientError(error)) return true
      const message = (error as { message?: unknown } | null)?.message
      return typeof message === 'string' && isChunkLoadMessage(message)
    },

    /**
     * Load the page afresh when an armed tab goes to another page. A change of
     * search or hash stays, so a page keeps the form it is showing. The router
     * announces the navigation before the address bar changes, so the new load
     * names its target. Returns the unsubscribe.
     */
    reloadOnNavigation(source: NavigationSource): () => void {
      return source.subscribe('onBeforeLoad', ({ pathChanged, toLocation }) => {
        if (pathChanged && stale) tab.reload(toLocation.publicHref)
      })
    },
  }
  return tab
}

export type StaleTab = ReturnType<typeof createStaleTab>

/**
 * Arm the tab on the two browser-wide signs of missing code. Arming is all they
 * do: they fire on hovers (preloads) and from handlers nobody is waiting on, so
 * reloading from them could cost a half-written reply. The next navigation, or
 * the route boundary that is already losing the page, does the reloading.
 */
export function watchBrowserFailures(tab: StaleTab, target: FailureTarget): () => void {
  const onPreloadError = (): void => tab.markStale()
  const onRejection = (event: Event): void => {
    if (tab.needsFreshCode((event as PromiseRejectionEvent).reason)) tab.markStale()
  }
  target.addEventListener('vite:preloadError', onPreloadError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('vite:preloadError', onPreloadError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}

/** The browser's tab. Touches `window` only when asked to act, so a server render is untouched. */
export const staleTab: StaleTab = createStaleTab({
  storage: () => (typeof sessionStorage === 'undefined' ? null : sessionStorage),
  now: () => Date.now(),
  reload: (target) => {
    if (target) window.location.assign(target)
    else window.location.reload()
  },
})

/** Called once by the browser entry, before the page hydrates. */
export function startStaleTabGuard(): void {
  staleTab.remember(readReleaseMeta(document))
  watchBrowserFailures(staleTab, window)
}
