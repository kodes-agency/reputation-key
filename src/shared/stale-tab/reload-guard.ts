// The one thing that stands between a stale tab and a reload loop.
//
// A reload cures a stale tab only if the page it lands on is current. When it is
// not (a cached document, a replica still on the old release), reloading again
// would loop. So a release gets one reload per window, written down in
// sessionStorage BEFORE the reload so it survives it. Without storage to write
// in, the guard refuses: a tab that cannot remember must not reload.
//
// Keyed by the release being left, not the one being aimed at. The release being
// left is always known to the tab; the target is not (a missing chunk says the
// server moved on, not where to). A reload that lands on the same release is the
// loop worth stopping, and the next deploy is a different release.

export const RELOAD_WINDOW_MS = 120_000

const KEY_PREFIX = 'repkey:stale-reload:'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type ReloadGuardDeps = Readonly<{
  /** The tab's session storage, or null where there is none. May throw. */
  storage: () => StorageLike | null
  now: () => number
  /** Load the page afresh: the address given, or the current one when none is. */
  reload: (target?: string) => void
}>

export type ReloadGuard = Readonly<{
  request: (release: string, target?: string) => 'reloading' | 'refused'
}>

export function createReloadGuard(deps: ReloadGuardDeps): ReloadGuard {
  // Once a reload is on its way the page is leaving: later asks are the same one.
  let requested = false

  function note(release: string): boolean {
    try {
      const store = deps.storage()
      if (!store) return false
      const key = `${KEY_PREFIX}${release}`
      // A missing, unreadable or future time gives NaN or a negative age: not recent.
      const age = deps.now() - Number(store.getItem(key) ?? Number.NaN)
      if (age >= 0 && age < RELOAD_WINDOW_MS) return false
      store.setItem(key, String(deps.now()))
      return true
    } catch {
      return false
    }
  }

  return {
    request(release, target) {
      if (requested) return 'reloading'
      if (!note(release)) return 'refused'
      requested = true
      deps.reload(target)
      return 'reloading'
    },
  }
}
