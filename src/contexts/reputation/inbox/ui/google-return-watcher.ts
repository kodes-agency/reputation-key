// Checking a review on Google when the manager comes back from it.
//
// About 97% of replies are still written on Google, often through the Inbox's
// "Open on Google". RepKey reads Google in full only about every 6 h, so
// without this an item stays open for hours after the manager answered it.
//
// The rule, in the manager's terms: after "Open on Google", when this tab is
// visible again within 30 minutes and the same item is still open, ask Google
// at once; if there is no reply yet, ask again 2 and 10 minutes later, while
// the item stays open and the tab visible. A reply found, the item closing, or
// the manager moving to another item ends it. Nothing runs while the tab is
// hidden.
//
// Plain TypeScript over an injected clock, timer and visibility, so the rules
// are testable without a DOM; `useGoogleReviewCheck` supplies the page's own.

/** A return counts for 30 minutes after the click. */
export const RETURN_CHECK_WINDOW_MS = 30 * 60_000

/** After a return that found no reply: check again this long after the return. */
export const RETURN_FOLLOW_UP_DELAYS_MS: ReadonlyArray<number> = [2 * 60_000, 10 * 60_000]

export type ReturnWatcherEnv = Readonly<{
  now: () => number
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  isVisible: () => boolean
  /** Calls `listener` whenever the page becomes visible; returns the unsubscribe. */
  onVisible: (listener: () => void) => () => void
}>

export type ReturnWatcherOptions = Readonly<{
  env: ReturnWatcherEnv
  /**
   * Check one review. Resolves `true` when the watch is over (the reply was
   * found, or the review cannot be checked), `false` to keep going. A rejection
   * counts as `false`: the schedule goes on.
   */
  check: (reviewId: string) => Promise<boolean>
}>

export type ReturnWatcher = Readonly<{
  /** The manager opened Google for this review. */
  opened: (reviewId: string) => void
  /**
   * The review whose item is open and still worth checking, or null (nothing
   * open, the item closed, or it cannot be checked). Anything but the review
   * that was opened on Google ends that watch.
   */
  focus: (reviewId: string | null) => void
  dispose: () => void
}>

type Opened = Readonly<{ reviewId: string; at: number }>

export function createReturnWatcher(options: ReturnWatcherOptions): ReturnWatcher {
  const { env, check } = options
  let opened: Opened | null = null
  let focused: string | null = null
  let timers: unknown[] = []
  // Bumped whenever a schedule is dropped, so an answer that lands after it
  // cannot end or extend the schedule that replaced it.
  let generation = 0

  const clearTimers = () => {
    generation += 1
    for (const handle of timers) env.clearTimer(handle)
    timers = []
  }

  const finish = () => {
    clearTimers()
    opened = null
  }

  const runCheck = (reviewId: string) => {
    const startedIn = generation
    check(reviewId).then(
      (over) => {
        if (over && generation === startedIn) finish()
      },
      () => undefined,
    )
  }

  const scheduleFollowUps = (reviewId: string) => {
    timers = RETURN_FOLLOW_UP_DELAYS_MS.map((delay) =>
      env.setTimer(() => {
        if (focused === reviewId && env.isVisible()) runCheck(reviewId)
      }, delay),
    )
  }

  const onReturn = () => {
    if (opened === null) return
    if (env.now() - opened.at > RETURN_CHECK_WINDOW_MS) {
      opened = null
      return
    }
    if (focused !== opened.reviewId) return
    clearTimers()
    runCheck(opened.reviewId)
    scheduleFollowUps(opened.reviewId)
  }

  const unsubscribe = env.onVisible(onReturn)

  return {
    opened: (reviewId) => {
      clearTimers()
      opened = { reviewId, at: env.now() }
    },
    focus: (reviewId) => {
      if (reviewId === focused) return
      focused = reviewId
      clearTimers()
      if (opened !== null && opened.reviewId !== reviewId) opened = null
    },
    dispose: () => {
      finish()
      focused = null
      unsubscribe()
    },
  }
}
