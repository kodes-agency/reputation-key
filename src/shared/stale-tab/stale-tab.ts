// What a browser tab does once it learns its code is older than the server's.
//
// The tab keeps the release that served its page. It is ARMED (stale) when the
// server says it has moved on (release-skew-middleware.ts) or when code the page
// needs is gone (a missing chunk). It reloads at a moment that costs the person
// nothing:
//   - an armed tab's next navigation to another view (a new path or new search:
//     the Inbox selects an item through its search), which it turns into a full
//     page load of the navigation's target;
//   - a read the server refuses just after a navigation (FRESH_VIEW_MS), which
//     reloads the current address: that view has only just been drawn;
//   - a read the server refuses just after the person came back to the tab, when
//     they hold nothing a reload would lose: everything the page reads is about
//     to fail, and they have not started anything yet;
//   - a route that already failed to draw (use-guarded-route-error.tsx):
//     refused, missing its chunk, or failing in an already armed tab;
//   - Try again pressed on a failed read in an armed tab: that read can only be
//     refused again, so the press does the one thing that helps.
// Any other refused read (a poll, a part of the page that mounted late) only arms
// the tab. It never reloads under a mutation still in flight, never in a loop
// (reload-guard.ts), and never when it does not know its own release: a
// development server, a test, Storybook and a server render all stay inert. A
// page still here a while after asking (a cancelled navigation) draws its
// failure again rather than a loading state that never ends.
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

type PersonTarget = FailureTarget &
  Readonly<{ document: Pick<Document, 'visibilityState'> }>

/** A form control the person changed, as much of it as the tab asks about. */
type ChangedControl = Pick<Element, 'isConnected' | 'closest'>

/**
 * A control whose changes a reload cannot lose, for now: its form saves itself and
 * guards the page while it cannot, so it says so only while that holds. A value,
 * not a bare attribute, so a field can stop saying so.
 */
const RELOAD_SAFE = '[data-reload-safe="true"]'

/**
 * The controls changed by pressing them, which fire no `input` or `change` of their
 * own (Radix's). A radio outside a form is a view switch (Draft or Live, a range):
 * it holds nothing.
 */
const PRESSED_CONTROL = '[role="checkbox"], [role="switch"], form [role="radio"]'

type NavigationEvent = Readonly<{
  pathChanged: boolean
  fromLocation?: Readonly<{ searchStr: string }>
  toLocation: Readonly<{ publicHref: string; searchStr: string }>
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

/**
 * A path on this site (`/x`), never another origin (`//x`, `/\x`, `https:`):
 * else the current address. A raw tab, line break or backslash is refused too:
 * the address parser drops the first two and reads a backslash as a slash, so
 * `/<tab>/x` would load `//x`. A path the router built has them encoded.
 */
function sitePath(href: unknown): string | undefined {
  return typeof href === 'string' && /^\/(?!\/)/u.test(href) && !/[\t\n\r\\]/u.test(href)
    ? href
    : undefined
}

/**
 * How long a page that asked to be reloaded may still be here before it takes
 * the reload as not happening (a navigation the browser or the person cancelled)
 * and draws its failure again. A reload that arrives ends the page first.
 */
export const RELOAD_SETTLE_MS = 10_000

/**
 * How long after a navigation its view counts as just drawn, so that a read the
 * server refuses reloads the page at once instead of only arming the tab.
 *
 * A navigation's own reads start straight away (its loaders, then the queries
 * of the view as it mounts, after its chunk if it has one), and the server
 * refuses before any handler runs, so the refusal is back in about one round
 * trip. Three seconds holds a slow phone connection with a chunk to fetch first,
 * and is still too short for anyone to have written something worth keeping in
 * a view that has just appeared. Coming back to the tab and pressing Try again
 * start their reads as promptly, so the same window answers for them. A refusal
 * after that is a poll or a part of the page that mounted late, when the person
 * may be in the middle of something: it only arms the tab.
 */
export const FRESH_VIEW_MS = 3_000

/**
 * A navigation that draws another view: a new path or new search. A new hash
 * alone scrolls the same view, and the same address again is a refresh (Try
 * again re-runs the loaders).
 */
function drawsAnotherView(event: NavigationEvent): boolean {
  return event.pathChanged || event.fromLocation?.searchStr !== event.toLocation.searchStr
}

export type StaleTabDeps = ReloadGuardDeps &
  Readonly<{
    later: (run: () => void, ms: number) => void
    /** A dialog is open: the person is in the middle of something the address does not keep. */
    dialogOpen: () => boolean
    /** Have the browser ask the person before the page is next left. */
    askBeforeLeaving: () => void
  }>

export function createStaleTab(deps: StaleTabDeps) {
  const guard = createReloadGuard(deps)
  let release: string | undefined
  let stale = false
  let mutationsInFlight = 0
  let reloading = false
  /** When the latest navigation to another view began; none yet is never fresh. */
  let navigatedAt = Number.NaN
  /** When the person last came back to this tab. */
  let returnedAt = Number.NaN
  /** When the person last pressed Try again on a read. */
  let pressedAt = Number.NaN
  /** The form controls the person changed. */
  let changed: readonly ChangedControl[] = []
  const watchers = new Set<() => void>()

  function setReloading(value: boolean): void {
    reloading = value
    watchers.forEach((watcher) => watcher())
  }

  /** The page is leaving. Still here after a while: the reload did not happen, so the failure is drawn. */
  function settleReload(): void {
    setReloading(true)
    deps.later(() => setReloading(false), RELOAD_SETTLE_MS)
  }

  /** Within FRESH_VIEW_MS of a moment. None yet gives NaN, a clock set back a negative age: neither is. */
  function justAfter(moment: number): boolean {
    const age = deps.now() - moment
    return age >= 0 && age < FRESH_VIEW_MS
  }

  /**
   * Whether a reload would lose something the person changed. Asked when a reload
   * is in question, not when they typed: a form that has left the page took its
   * words with it, and a field marked reload-safe may have stopped being safe, or
   * started to, since.
   */
  function holdsChanges(): boolean {
    changed = changed.filter((control) => control.isConnected)
    return changed.some((control) => !control.closest(RELOAD_SAFE))
  }

  /** The reload the person pressed for. Only a mutation in flight holds it back, as it does every reload. */
  function reloadAsked(activeRelease: string): ReloadOutcome {
    if (reloading) return 'reloading'
    if (mutationsInFlight > 0) return 'deferred'
    if (holdsChanges()) deps.askBeforeLeaving()
    guard.insist(activeRelease)
    settleReload()
    return 'reloading'
  }

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
      // One reload per page: once it is on its way the page is leaving.
      if (reloading) return 'reloading'
      if (mutationsInFlight > 0) return 'deferred'
      const outcome = guard.request(release, sitePath(target))
      // The guard has counted it, so if the page is still here after a while, a
      // second ask inside its window is refused and the failure is drawn.
      if (outcome === 'reloading') settleReload()
      return outcome
    },

    /** A reload is on its way. With `onReloading`, the shape React's external-store hook reads. */
    isReloading: (): boolean => reloading,

    onReloading(watcher: () => void): () => void {
      watchers.add(watcher)
      return () => void watchers.delete(watcher)
    },

    /** The person came back to this tab, or it came back to the network: its reads run again now. */
    noteReturn(): void {
      returnedAt = deps.now()
    },

    /** The person changed a form control. */
    noteEdit(control: ChangedControl): void {
      if (!changed.includes(control)) changed = [...changed, control]
    },

    /**
     * The server refused a read because this tab's code is stale. Reload the
     * current address when that read answers Try again, or when the view is fresh
     * from a navigation or the person has just come back to it (all within
     * FRESH_VIEW_MS) and they hold nothing a reload would lose; otherwise, or when
     * the reload is deferred or refused, the tab stays armed for its next
     * navigation. By then the router has written the navigation's address, so the
     * current one is the view that asked.
     */
    readRefused(): ReloadOutcome | 'armed' {
      tab.markStale()
      if (!release || !stale) return 'unavailable'
      if (justAfter(pressedAt)) return reloadAsked(release)
      if (holdsChanges()) return 'armed'
      const back = justAfter(returnedAt) && !deps.dialogOpen()
      return justAfter(navigatedAt) || back ? tab.reload() : 'armed'
    },

    /**
     * Try again, pressed on a read that failed. A tab whose code is stale gets
     * the same refusal however often it asks, so in an armed tab the press loads
     * the page afresh, with the browser's own question first if the person holds
     * something a reload would lose. A retry that is not a read (a save) never
     * comes here: it goes through in a stale tab, and a reload could lose it.
     */
    tryAgain(retry: () => void): void {
      if (release && stale && reloadAsked(release) === 'reloading') return
      pressedAt = deps.now()
      retry()
    },

    /**
     * A route failed to draw. Load the page afresh when the failure says this
     * tab's code is stale (a refusal, a missing chunk), arming the tab, or when
     * the tab already knows it is: old code meeting a newer answer fails in ways
     * no shape can name, and the page is lost already. A refused or deferred
     * reload leaves the tab armed, so the next navigation asks again.
     */
    reloadForFailure(error: unknown): ReloadOutcome | 'unrelated' {
      if (tab.needsFreshCode(error)) tab.markStale()
      return stale ? tab.reload() : 'unrelated'
    },

    /** The failures that mean this tab needs the current code: a stale refusal, a missing chunk. */
    needsFreshCode(error: unknown): boolean {
      if (isStaleClientError(error)) return true
      const message = (error as { message?: unknown } | null)?.message
      return typeof message === 'string' && isChunkLoadMessage(message)
    },

    /**
     * Load the page afresh when an armed tab goes to another view: a new path
     * or new search (the Inbox selects an item through its search). A change of
     * hash alone stays. The router announces the navigation before the address
     * bar changes, so the new load names its target. Every such navigation is
     * noted, armed or not, for `readRefused`. A navigation that would lose
     * something is held by the page's own blocker before the router announces
     * it, and a reload itself still meets the page's `beforeunload`. Returns
     * the unsubscribe.
     */
    reloadOnNavigation(source: NavigationSource): () => void {
      return source.subscribe('onBeforeLoad', (event) => {
        if (!drawsAnotherView(event)) return
        navigatedAt = deps.now()
        if (stale) tab.reload(event.toLocation.publicHref)
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

/**
 * Note what decides whether coming back to a stale tab may reload it: that the
 * person came back (or the network did, which reads everything again too), and
 * which form controls they changed. A search is left out: the address keeps it.
 * Captured, so a control that stops its event's propagation is still counted. The
 * signed-in app's layout calls this: a guest's page holds what they did in the
 * page, and its failures draw no panel to get stuck on, so it waits for its next
 * navigation. Returns the undo.
 */
export function watchPerson(tab: StaleTab, target: PersonTarget): () => void {
  const onVisibility = (): void => {
    if (target.document.visibilityState === 'visible') tab.noteReturn()
  }
  const onOnline = (): void => tab.noteReturn()
  const onEdit = (event: Event): void => {
    const control = event.target as unknown as ChangedControl &
      Readonly<{ type?: string }>
    if (control.type !== 'search') tab.noteEdit(control)
  }
  const onPress = (event: Event): void => {
    const pressed = event.target as Partial<ChangedControl> | null
    const control = pressed?.closest?.(PRESSED_CONTROL)
    if (control) tab.noteEdit(control)
  }
  target.addEventListener('visibilitychange', onVisibility)
  target.addEventListener('online', onOnline)
  target.addEventListener('input', onEdit, true)
  target.addEventListener('change', onEdit, true)
  target.addEventListener('click', onPress, true)
  return () => {
    target.removeEventListener('visibilitychange', onVisibility)
    target.removeEventListener('online', onOnline)
    target.removeEventListener('input', onEdit, true)
    target.removeEventListener('change', onEdit, true)
    target.removeEventListener('click', onPress, true)
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
  later: (run, ms) => void setTimeout(run, ms),
  dialogOpen: () =>
    document.querySelector('[role="dialog"], [role="alertdialog"]') !== null,
  askBeforeLeaving: () =>
    window.addEventListener('beforeunload', (event) => event.preventDefault(), {
      once: true,
    }),
})

/** Called once by the browser entry, before the page hydrates. */
export function startStaleTabGuard(): void {
  staleTab.remember(readReleaseMeta(document))
  watchBrowserFailures(staleTab, window)
}
