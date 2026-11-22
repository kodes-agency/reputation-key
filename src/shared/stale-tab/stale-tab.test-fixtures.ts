// Shared harness for the stale tab suites: a tab wired to fakes, a stand-in
// router and a stand-in window.
import { vi } from 'vitest'
import { STALE_CLIENT_CODE } from './release-skew'
import { createStaleTab } from './stale-tab'

export const RELEASE = 'a'.repeat(40)

export function setup(release: string | null = RELEASE) {
  const items = new Map<string, string>()
  const reload = vi.fn()
  const askBeforeLeaving = vi.fn()
  const page = { dialogOpen: false }
  const timers: Array<Readonly<{ run: () => void; ms: number }>> = []
  let time = 5_000_000
  const tab = createStaleTab({
    storage: () => ({
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
    }),
    now: () => time,
    reload,
    later: (run, ms) => void timers.push({ run, ms }),
    dialogOpen: () => page.dialogOpen,
    askBeforeLeaving,
  })
  if (release !== null) tab.remember(release)
  /** Let the time a reload is given to replace the page run out, with the page still here. */
  const outlive = (): void => timers.splice(0).forEach((timer) => timer.run())
  /** Move the tab's clock; a negative step is a clock set back. */
  const tick = (ms: number): void => void (time += ms)
  return { tab, reload, items, timers, outlive, tick, askBeforeLeaving, page }
}

type Place = Readonly<{ searchStr: string; publicHref: string }>
type NavigationEvent = Readonly<{
  pathChanged: boolean
  fromLocation?: Place
  toLocation: Place
}>

/** A stand-in for the router: it announces a navigation the way TanStack's `onBeforeLoad` does. */
export function routerWith() {
  let listener: ((event: NavigationEvent) => void) | undefined
  const unsubscribe = vi.fn()
  const place = (href: string) => new URL(href, 'https://manager.example')
  return {
    router: {
      subscribe: vi.fn((type: string, next: (event: NavigationEvent) => void) => {
        if (type === 'onBeforeLoad') listener = next
        return unsubscribe
      }),
    },
    /**
     * From one address of this site to another. `publicHref` is what the
     * router hands over as the target, when a test needs it to differ.
     */
    go: (from: string | undefined, to: string, publicHref = to) => {
      const before = from === undefined ? undefined : place(from)
      const after = place(to)
      listener?.({
        pathChanged: before?.pathname !== after.pathname,
        fromLocation: before && { searchStr: before.search, publicHref: from ?? '' },
        toLocation: { searchStr: after.search, publicHref },
      })
    },
    unsubscribe,
  }
}

export const staleClientError = () =>
  Object.assign(new Error('Reload'), {
    _tag: 'StaleClient',
    code: STALE_CLIENT_CODE,
    status: 409,
  })

/** A form control the person changed, on screen and in no field that says it is safe. */
export const changedControl = (overrides: Readonly<Partial<ChangedControl>> = {}) => ({
  isConnected: true,
  closest: () => null,
  ...overrides,
})

type ChangedControl = Parameters<ReturnType<typeof createStaleTab>['noteEdit']>[0]

/** What `closest` finds for a control inside a `data-reload-safe` field. */
export const reloadSafe = ((selector: string) =>
  selector === '[data-reload-safe="true"]' ? ({} as Element) : null) as Element['closest']

/** A stand-in for `window`: it keeps the listeners and hands them what a test dispatches. */
export function windowWith() {
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  return {
    target: {
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      removeEventListener: (type: string, listener: (event: unknown) => void) =>
        void listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== listener),
        ),
    },
    dispatch: (type: string, event: unknown) =>
      (listeners.get(type) ?? []).forEach((listener) => listener(event)),
    count: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
  }
}
