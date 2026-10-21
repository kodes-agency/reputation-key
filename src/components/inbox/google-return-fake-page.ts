// Test support only (`google-return-watcher.test.ts`, `use-google-review-check.test.ts`):
// a page whose clock, timers and visibility a test moves by hand. Nothing in
// the app imports it.

import type { ReturnWatcherEnv } from './google-return-watcher'

/** A page whose time, timers and visibility the test moves by hand. */
export function fakePage() {
  let now = 1_000_000
  let visible = true
  let nextHandle = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  const listeners = new Set<() => void>()
  const env: ReturnWatcherEnv = {
    now: () => now,
    setTimer: (fn, ms) => {
      const handle = nextHandle++
      timers.set(handle, { at: now + ms, fn })
      return handle
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
    isVisible: () => visible,
    onVisible: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    env,
    pendingTimers: () => timers.size,
    listenerCount: () => listeners.size,
    /** Move time on, firing every timer that falls due, in order. */
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = end
    },
    hide() {
      visible = false
    },
    show() {
      visible = true
      for (const listener of [...listeners]) listener()
    },
  }
}
