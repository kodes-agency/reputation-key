// What a browser tab does once it learns its code is older than the server's.
// The tab keeps the release that served its page, arms a flag when the server
// says it has moved on (or when code it needs is gone), and reloads at a moment
// that costs the person nothing: the next navigation to another view (a new
// path or new search), a read refused just after a navigation or just after they
// came back to the tab, a route that already failed to draw, or Try again pressed
// on a read that can only be refused again. It never reloads under a mutation in
// flight.
import { describe, expect, it, vi } from 'vitest'
import { STALE_CLIENT_CODE } from './release-skew'
import {
  FRESH_VIEW_MS,
  RELOAD_SETTLE_MS,
  createStaleTab,
  readReleaseMeta,
  watchBrowserFailures,
  watchPerson,
} from './stale-tab'

const RELEASE = 'a'.repeat(40)

function setup(release: string | null = RELEASE) {
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
function routerWith() {
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

const staleClientError = () =>
  Object.assign(new Error('Reload'), {
    _tag: 'StaleClient',
    code: STALE_CLIENT_CODE,
    status: 409,
  })

describe('remembering the release', () => {
  it('keeps a concrete release', () => {
    expect(setup().tab.release()).toBe(RELEASE)
  })

  it.each(['unknown', '', 'local-dev', undefined, null])(
    'knows no release from %j (dev, tests, Storybook, a server render)',
    (value) => {
      const { tab } = setup(null)
      tab.remember(value)

      expect(tab.release()).toBeUndefined()
    },
  )

  it('reads it from the page head once, whatever the head says later', () => {
    const { tab } = setup(null)
    const head = { content: RELEASE as string | null }
    const doc = {
      querySelector: (selector: string) =>
        selector === 'meta[name="repkey-release"]'
          ? { getAttribute: () => head.content }
          : null,
    }

    tab.remember(readReleaseMeta(doc))
    head.content = 'b'.repeat(40)

    expect(tab.release()).toBe(RELEASE)
  })

  it('reads nothing from a head without the tag', () => {
    expect(readReleaseMeta({ querySelector: () => null })).toBeUndefined()
  })
})

describe('arming', () => {
  it('starts unarmed', () => {
    expect(setup().tab.isStale()).toBe(false)
  })

  it('arms when told the server has moved on', () => {
    const { tab } = setup()
    tab.markStale()

    expect(tab.isStale()).toBe(true)
  })

  it('stays unarmed when it does not know its own release, so nothing can ever reload', () => {
    const { tab } = setup(null)
    tab.markStale()

    expect(tab.isStale()).toBe(false)
  })
})

describe('reloading', () => {
  it('has nothing to do without a release', () => {
    const { tab, reload } = setup(null)

    expect(tab.reload()).toBe('unavailable')
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads through the guard', () => {
    const { tab, reload } = setup()

    expect(tab.reload()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('is refused by the guard when this release already reloaded inside the window', () => {
    const { tab, reload, items } = setup()
    items.set(`repkey:stale-reload:${RELEASE}`, '5000000')

    expect(tab.reload()).toBe('refused')
    expect(reload).not.toHaveBeenCalled()
  })

  it('says so while it reloads, so a page can draw the loading state instead of an error', () => {
    const { tab } = setup()
    const heard = vi.fn()
    tab.onReloading(heard)

    expect(tab.isReloading()).toBe(false)
    tab.reload()
    tab.reload()

    expect(tab.isReloading()).toBe(true)
    expect(heard).toHaveBeenCalledOnce()
  })

  it('does not say it is reloading when the guard refused', () => {
    const { tab, items } = setup()
    items.set(`repkey:stale-reload:${RELEASE}`, '5000000')
    tab.reload()

    expect(tab.isReloading()).toBe(false)
  })

  it('stops telling a listener that has gone', () => {
    const { tab } = setup()
    const heard = vi.fn()
    tab.onReloading(heard)()

    tab.reload()

    expect(heard).not.toHaveBeenCalled()
  })

  it('asks for one reload per page, however often it is asked', () => {
    const { tab, reload } = setup()

    expect(tab.reload()).toBe('reloading')
    expect(tab.reload('/elsewhere')).toBe('reloading')

    expect(reload).toHaveBeenCalledOnce()
  })

  it('draws the failure again when the page outlives its reload (a navigation that was cancelled), and never asks twice inside the window', () => {
    const { tab, reload, timers, outlive } = setup()
    const heard = vi.fn()
    tab.onReloading(heard)
    tab.reload()

    expect(timers.map((timer) => timer.ms)).toEqual([RELOAD_SETTLE_MS])
    outlive()

    expect(tab.isReloading()).toBe(false)
    expect(heard).toHaveBeenCalledTimes(2)
    expect(tab.reload()).toBe('refused')
    expect(tab.isReloading()).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits while a mutation is in flight, so the call is never cut off', async () => {
    const { tab, reload } = setup()
    let finish: (value: string) => void = () => undefined
    const pending = tab.trackMutation(
      new Promise<string>((resolve) => {
        finish = resolve
      }),
    )

    expect(tab.reload()).toBe('deferred')
    expect(reload).not.toHaveBeenCalled()

    finish('saved')
    await expect(pending).resolves.toBe('saved')

    expect(tab.reload()).toBe('reloading')
  })

  it('stops waiting when the mutation fails too', async () => {
    const { tab } = setup()
    const failing = tab.trackMutation(Promise.reject(new Error('refused')))

    await expect(failing).rejects.toThrow('refused')

    expect(tab.reload()).toBe('reloading')
  })

  it('counts every mutation in flight, not only the last', async () => {
    const { tab } = setup()
    const finish: Array<() => void> = []
    const track = () =>
      tab.trackMutation(new Promise<void>((resolve) => void finish.push(resolve)))
    const first = track()
    const second = track()

    finish[0]?.()
    await first

    expect(tab.reload()).toBe('deferred')

    finish[1]?.()
    await second

    expect(tab.reload()).toBe('reloading')
  })
})

describe('reloadForFailure (a route that already failed to draw)', () => {
  it('reloads for a failure that says the code is stale, and arms the tab', () => {
    const { tab, reload } = setup()

    expect(tab.reloadForFailure(staleClientError())).toBe('reloading')
    expect(tab.isStale()).toBe(true)
    expect(reload).toHaveBeenCalledWith(undefined)
  })

  it('reloads an armed tab whatever the failure: its code is known to be old and the page is lost already', () => {
    const { tab, reload } = setup()
    tab.markStale()

    const outcome = tab.reloadForFailure(
      new TypeError("Cannot read properties of undefined (reading 'length')"),
    )

    expect(outcome).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('leaves an ordinary failure of a current tab to the error page', () => {
    const { tab, reload } = setup()

    expect(tab.reloadForFailure(new Error('boom'))).toBe('unrelated')
    expect(tab.isStale()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves every failure to the error page when it does not know its release', () => {
    const { tab, reload } = setup(null)

    expect(tab.reloadForFailure(new TypeError('Importing a module script failed.'))).toBe(
      'unrelated',
    )
    expect(reload).not.toHaveBeenCalled()
  })

  it('stays armed when a mutation in flight defers the reload, so the next navigation asks again', () => {
    const { tab, reload } = setup()
    void tab.trackMutation(new Promise(() => undefined))

    expect(tab.reloadForFailure(staleClientError())).toBe('deferred')
    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('needsFreshCode', () => {
  it('is true for the typed refusal', () => {
    expect(setup().tab.needsFreshCode(staleClientError())).toBe(true)
  })

  it.each([
    ['Chromium', 'Failed to fetch dynamically imported module: https://x/assets/a.js'],
    ['Firefox', 'error loading dynamically imported module: https://x/assets/a.js'],
    ['Safari', 'Importing a module script failed.'],
  ])('is true for a missing chunk in %s', (_browser, message) => {
    expect(setup().tab.needsFreshCode(new TypeError(message))).toBe(true)
  })

  it.each([
    ['a network failure', new TypeError('Load failed')],
    [
      'a plain bug',
      new TypeError("Cannot read properties of undefined (reading 'length')"),
    ],
    [
      'another refusal',
      Object.assign(new Error('no'), { _tag: 'T', code: 'forbidden', status: 403 }),
    ],
    ['a string', 'Importing a module script failed.'],
    ['nothing', undefined],
  ])('is false for %s', (_label, error) => {
    expect(setup().tab.needsFreshCode(error)).toBe(false)
  })
})

/** A form control the person changed, on screen and in no field that says it is safe. */
const changedControl = (overrides: Readonly<Partial<ChangedControl>> = {}) => ({
  isConnected: true,
  closest: () => null,
  ...overrides,
})

type ChangedControl = Parameters<ReturnType<typeof createStaleTab>['noteEdit']>[0]

/** What `closest` finds for a control inside a `data-reload-safe` field. */
const reloadSafe = ((selector: string) =>
  selector === '[data-reload-safe="true"]' ? ({} as Element) : null) as Element['closest']

/** A stand-in for `window`: it keeps the listeners and hands them what a test dispatches. */
function windowWith() {
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

describe('watching the browser for missing code', () => {
  it('arms, but does not reload, when the bundler reports a missing preload', () => {
    const { tab, reload } = setup()
    const page = windowWith()
    watchBrowserFailures(tab, page.target)

    page.dispatch('vite:preloadError', { payload: new Error('gone') })

    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('arms on an unhandled rejection that is a missing chunk', () => {
    const { tab, reload } = setup()
    const page = windowWith()
    watchBrowserFailures(tab, page.target)

    page.dispatch('unhandledrejection', {
      reason: new TypeError('Importing a module script failed.'),
    })

    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves every other rejection alone, and never swallows one', () => {
    const { tab } = setup()
    const page = windowWith()
    watchBrowserFailures(tab, page.target)
    const preventDefault = vi.fn()

    page.dispatch('unhandledrejection', {
      reason: new TypeError('Load failed'),
      preventDefault,
    })
    page.dispatch('unhandledrejection', {
      reason: new TypeError('Importing a module script failed.'),
      preventDefault,
    })

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('can be taken down', () => {
    const { tab } = setup()
    const page = windowWith()
    const stop = watchBrowserFailures(tab, page.target)

    expect(page.count()).toBe(2)
    stop()

    expect(page.count()).toBe(0)
  })
})

describe('reloading on the next navigation', () => {
  it('loads the target afresh when an armed tab goes to another page', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()

    go('/inbox', '/properties/42?tab=a')

    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith('/properties/42?tab=a')
  })

  it('loads the target afresh when an armed tab changes only the search, as the Inbox does to select an item', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()

    go('/inbox?itemId=1', '/inbox?itemId=2')

    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith('/inbox?itemId=2')
  })

  it('loads the target afresh when the search and the hash change together', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()

    go('/inbox?itemId=1#notes', '/inbox?itemId=2#reply')

    expect(reload).toHaveBeenCalledWith('/inbox?itemId=2#reply')
  })

  it('does nothing when only the hash changed: the same view, scrolled', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()

    go('/inbox?itemId=1', '/inbox?itemId=1#reply')

    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing for a refresh of the same address (Try again re-runs the loaders)', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()

    go('/inbox?itemId=1', '/inbox?itemId=1')

    expect(reload).not.toHaveBeenCalled()
  })

  it.each([
    '//attacker.example/x',
    '/\\attacker.example/x',
    'https://attacker.example/x',
    'properties',
    '',
    // The address parser drops tabs and line breaks and reads a backslash as a
    // slash, so the next three would become `//attacker.example`; a path the
    // router built never holds a raw one of them.
    '/\t/attacker.example/x',
    '/\r\n/attacker.example/x',
    '/\t\\attacker.example/x',
    '/properties\\x',
  ])(
    'never loads %j: anything that is not a path on this site reloads the current address',
    (target) => {
      const { tab, reload } = setup()
      const { router, go } = routerWith()
      tab.reloadOnNavigation(router)
      tab.markStale()

      go('/inbox', '/properties/42', target)

      expect(reload).toHaveBeenCalledWith(undefined)
    },
  )

  it('loads a path whose odd characters are already encoded', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()

    go('/inbox', '/properties/a%20b?q=%5C%09#x')

    expect(reload).toHaveBeenCalledWith('/properties/a%20b?q=%5C%09#x')
  })

  it('does nothing while the tab is current', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)

    go('/inbox', '/properties/42')
    go('/inbox?itemId=1', '/inbox?itemId=2')

    expect(reload).not.toHaveBeenCalled()
  })

  it('lets the navigation go on when a mutation is still in flight', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()
    void tab.trackMutation(new Promise(() => undefined))

    go('/inbox?itemId=1', '/inbox?itemId=2')

    expect(reload).not.toHaveBeenCalled()
    expect(tab.isStale()).toBe(true)
  })

  it('hands back the router subscription so it can be undone', () => {
    const { tab } = setup()
    const { router, unsubscribe } = routerWith()

    tab.reloadOnNavigation(router)()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('a read refused just after a navigation', () => {
  it('reloads the current address at once: the view was just drawn, so nothing in it is lost', () => {
    const { tab, reload, tick } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    go('/inbox?itemId=1', '/inbox?itemId=2')
    tick(FRESH_VIEW_MS - 1)

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith(undefined)
    expect(tab.isReloading()).toBe(true)
  })

  it('only arms the tab once the window has closed (a focus refetch, a poll, a late mount)', () => {
    const { tab, reload, tick } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    go('/inbox?itemId=1', '/inbox?itemId=2')
    tick(FRESH_VIEW_MS)

    expect(tab.readRefused()).toBe('armed')
    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('counts from the latest navigation', () => {
    const { tab, reload, tick } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    go('/inbox', '/properties/42')
    tick(FRESH_VIEW_MS * 5)
    go('/properties/42', '/inbox?itemId=2')
    tick(FRESH_VIEW_MS - 1)

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('only arms the tab when there was no navigation at all', () => {
    const { tab, reload } = setup()

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not count a change of hash alone, which draws no new view', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    go('/inbox?itemId=2', '/inbox?itemId=2#reply')

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not count a refresh of the same address', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    go('/inbox?itemId=2', '/inbox?itemId=2')

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not take a clock set back as a fresh view', () => {
    const { tab, reload, tick } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    go('/inbox?itemId=1', '/inbox?itemId=2')
    tick(-1)

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('waits for a mutation in flight and stays armed, so the next navigation asks again', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    void tab.trackMutation(new Promise(() => undefined))
    go('/inbox?itemId=1', '/inbox?itemId=2')

    expect(tab.readRefused()).toBe('deferred')
    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('is refused by the guard when this release already reloaded inside its window, and stays armed', () => {
    const { tab, reload, items } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    items.set(`repkey:stale-reload:${RELEASE}`, '5000000')
    go('/inbox?itemId=1', '/inbox?itemId=2')

    expect(tab.readRefused()).toBe('refused')
    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('only arms the tab when the person has already changed something in the view just drawn', () => {
    const { tab, reload } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    go('/inbox', '/settings/profile')
    tab.noteEdit(changedControl())

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads with a dialog open: one the view opened by itself is nothing the person started', () => {
    const { tab, reload, page } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    page.dialogOpen = true
    go('/inbox', '/properties/42')

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does nothing when the tab does not know its release', () => {
    const { tab, reload } = setup(null)
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    go('/inbox?itemId=1', '/inbox?itemId=2')

    expect(tab.readRefused()).toBe('unavailable')
    expect(tab.isStale()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('coming back to the tab', () => {
  it('reloads the current address when a read is refused just after the person came back: everything the page reads is about to fail, and they have not started anything yet', () => {
    const { tab, reload, tick } = setup()
    tab.noteReturn()
    tick(FRESH_VIEW_MS - 1)

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith(undefined)
    expect(tab.isReloading()).toBe(true)
  })

  it('only arms the tab once the window has closed (a poll while they read)', () => {
    const { tab, reload, tick } = setup()
    tab.noteReturn()
    tick(FRESH_VIEW_MS)

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('counts from the latest return', () => {
    const { tab, reload, tick } = setup()
    tab.noteReturn()
    tick(FRESH_VIEW_MS * 5)
    tab.noteReturn()
    tick(FRESH_VIEW_MS - 1)

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not take a clock set back as a return', () => {
    const { tab, reload, tick } = setup()
    tab.noteReturn()
    tick(-1)

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('only arms the tab when the person has changed something only the page holds', () => {
    const { tab, reload } = setup()
    tab.noteEdit(changedControl())
    tab.noteReturn()

    expect(tab.readRefused()).toBe('armed')
    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('only arms the tab while a dialog is open: the person is in the middle of something', () => {
    const { tab, reload, page } = setup()
    page.dialogOpen = true
    tab.noteReturn()

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once what was changed has left the page: a form that closed took its words with it', () => {
    const { tab, reload } = setup()
    tab.noteEdit(changedControl({ isConnected: false }))
    tab.noteReturn()

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('keeps holding through a navigation while what was changed is on screen: a filter above a form', () => {
    const { tab, reload, tick } = setup()
    const { router, go } = routerWith()
    tab.reloadOnNavigation(router)
    tab.noteEdit(changedControl())
    go('/inbox', '/inbox?queue=open')
    tick(FRESH_VIEW_MS)
    tab.noteReturn()

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads when every change is in a field that says a reload cannot lose it', () => {
    const { tab, reload } = setup()
    tab.noteEdit(changedControl({ closest: reloadSafe }))
    tab.noteReturn()

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('holds as soon as that field stops saying so: its save failed, or it refuses to save', () => {
    const { tab, reload } = setup()
    const field = { isConnected: true, closest: reloadSafe as Element['closest'] }
    tab.noteEdit(field)
    field.closest = () => null
    tab.noteReturn()

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('holds for the one field that is not safe among those that are', () => {
    const { tab, reload } = setup()
    tab.noteEdit(changedControl({ closest: reloadSafe }))
    tab.noteEdit(changedControl())
    tab.noteReturn()

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('waits for a mutation in flight and stays armed, so the next navigation asks again', () => {
    const { tab, reload } = setup()
    void tab.trackMutation(new Promise(() => undefined))
    tab.noteReturn()

    expect(tab.readRefused()).toBe('deferred')
    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('is refused by the guard when this release already reloaded inside its window, and stays armed', () => {
    const { tab, reload, items } = setup()
    items.set(`repkey:stale-reload:${RELEASE}`, '5000000')
    tab.noteReturn()

    expect(tab.readRefused()).toBe('refused')
    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing when the tab does not know its release', () => {
    const { tab, reload } = setup(null)
    tab.noteReturn()

    expect(tab.readRefused()).toBe('unavailable')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('Try again, pressed on a read that failed', () => {
  it('runs the read in a current tab, and never reloads it', () => {
    const { tab, reload } = setup()
    const retry = vi.fn()

    tab.tryAgain(retry)

    expect(retry).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
    expect(tab.isReloading()).toBe(false)
  })

  it('loads the page afresh in an armed tab instead: the read would only be refused again', () => {
    const { tab, reload } = setup()
    const retry = vi.fn()
    tab.markStale()

    tab.tryAgain(retry)

    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith(undefined)
    expect(retry).not.toHaveBeenCalled()
    expect(tab.isReloading()).toBe(true)
  })

  it('still loads it afresh when the guard would refuse a reload of its own: a press cannot loop', () => {
    const { tab, reload, items } = setup()
    items.set(`repkey:stale-reload:${RELEASE}`, '5000000')
    tab.markStale()
    expect(tab.reload()).toBe('refused')

    tab.tryAgain(vi.fn())

    expect(reload).toHaveBeenCalledOnce()
  })

  it('is counted by the guard, so a reload of the tab’s own after it is still refused', () => {
    const { tab, reload, items, outlive } = setup()
    tab.markStale()
    tab.tryAgain(vi.fn())
    outlive()

    expect(items.get(`repkey:stale-reload:${RELEASE}`)).toBe('5000000')
    expect(tab.reload()).toBe('refused')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('asks for one reload per page, however often it is pressed', () => {
    const { tab, reload } = setup()
    tab.markStale()
    const retry = vi.fn()

    tab.tryAgain(retry)
    tab.tryAgain(retry)

    expect(reload).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('can be pressed again when the page outlives its reload (the person stayed on the browser’s question)', () => {
    const { tab, reload, outlive } = setup()
    tab.markStale()
    tab.tryAgain(vi.fn())
    outlive()

    expect(tab.isReloading()).toBe(false)
    tab.tryAgain(vi.fn())

    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('has the browser ask first, before it leaves, when the person has changed something only the page holds', () => {
    const { tab, reload, askBeforeLeaving } = setup()
    const order: string[] = []
    askBeforeLeaving.mockImplementation(() => order.push('ask'))
    reload.mockImplementation(() => order.push('reload'))
    tab.noteEdit(changedControl())
    tab.markStale()

    tab.tryAgain(vi.fn())

    expect(order).toEqual(['ask', 'reload'])
  })

  it('asks nothing when what was changed cannot be lost: a press is not a false alarm', () => {
    const { tab, reload, askBeforeLeaving } = setup()
    tab.noteEdit(changedControl({ closest: reloadSafe }))
    tab.noteEdit(changedControl({ isConnected: false }))
    tab.markStale()

    tab.tryAgain(vi.fn())

    expect(askBeforeLeaving).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('asks nothing when nothing was changed, even with a dialog open: the press came from inside it', () => {
    const { tab, reload, askBeforeLeaving, page } = setup()
    page.dialogOpen = true
    tab.markStale()

    tab.tryAgain(vi.fn())

    expect(askBeforeLeaving).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('runs the read instead while a mutation is in flight, so the call is never cut off', () => {
    const { tab, reload } = setup()
    const retry = vi.fn()
    tab.markStale()
    void tab.trackMutation(new Promise(() => undefined))

    tab.tryAgain(retry)

    expect(retry).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })

  it('loads the page afresh when the read it ran is refused, once the mutation has settled', async () => {
    const { tab, reload } = setup()
    let settle = (): void => undefined
    tab.markStale()
    void tab.trackMutation(
      new Promise<void>((resolve) => {
        settle = resolve
      }),
    )
    tab.tryAgain(vi.fn())
    settle()
    await Promise.resolve()
    await Promise.resolve()

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('loads the page afresh when the press is what shows the tab is stale', () => {
    const { tab, reload, tick } = setup()
    tab.tryAgain(vi.fn())
    tick(FRESH_VIEW_MS - 1)

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('still loads it afresh after a refused read when the guard would refuse: that press cannot loop either', () => {
    const { tab, reload, items } = setup()
    items.set(`repkey:stale-reload:${RELEASE}`, '5000000')
    tab.tryAgain(vi.fn())

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('only arms the tab for a refusal long after the press: that read is someone else’s', () => {
    const { tab, reload, tick } = setup()
    tab.tryAgain(vi.fn())
    tick(FRESH_VIEW_MS)

    expect(tab.readRefused()).toBe('armed')
    expect(reload).not.toHaveBeenCalled()
  })

  it('runs the read when the tab does not know its release (a development server, Storybook)', () => {
    const { tab, reload } = setup(null)
    const retry = vi.fn()

    tab.tryAgain(retry)

    expect(retry).toHaveBeenCalledOnce()
    expect(tab.readRefused()).toBe('unavailable')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('watching the person', () => {
  function watched(visibilityState: DocumentVisibilityState = 'visible') {
    const { tab, reload } = setup()
    const page = windowWith()
    const document = { visibilityState }
    const stop = watchPerson(tab, { ...page.target, document })
    return { tab, reload, page, document, stop }
  }
  const field = (overrides: Readonly<Record<string, unknown>> = {}) => ({
    type: 'text',
    isConnected: true,
    closest: () => null,
    ...overrides,
  })

  it('notes a return when the tab becomes visible', () => {
    const { tab, reload, page } = watched()

    page.dispatch('visibilitychange', {})

    expect(tab.readRefused()).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('notes no return when the tab is hidden: nobody is looking, and they may come back to something', () => {
    const { tab, page } = watched('hidden')

    page.dispatch('visibilitychange', {})

    expect(tab.readRefused()).toBe('armed')
  })

  it('notes a return when the network comes back, which reads everything again too', () => {
    const { tab, page } = watched()

    page.dispatch('online', {})

    expect(tab.readRefused()).toBe('reloading')
  })

  it.each(['input', 'change'])(
    'takes %s in a form control as something only the page holds',
    (type) => {
      const { tab, page } = watched()

      page.dispatch(type, { target: field() })
      page.dispatch('visibilitychange', {})

      expect(tab.readRefused()).toBe('armed')
    },
  )

  it('does not count a search: the address keeps it', () => {
    const { tab, page } = watched()

    page.dispatch('input', { target: field({ type: 'search' }) })
    page.dispatch('visibilitychange', {})

    expect(tab.readRefused()).toBe('reloading')
  })

  it('does not count a field that says a reload cannot lose it', () => {
    const { tab, page } = watched()

    page.dispatch('input', { target: field({ closest: reloadSafe }) })
    page.dispatch('visibilitychange', {})

    expect(tab.readRefused()).toBe('reloading')
  })

  it('takes a press on a control that fires no event of its own (Radix) as a change', () => {
    const { tab, page } = watched()
    const checkbox = field()
    const closest = vi.fn(() => checkbox)

    page.dispatch('click', { target: { closest } })
    page.dispatch('visibilitychange', {})

    expect(closest).toHaveBeenCalledWith(
      '[role="checkbox"], [role="switch"], form [role="radio"]',
    )
    expect(tab.readRefused()).toBe('armed')
  })

  it('does not take a press on anything else as a change', () => {
    const { tab, page } = watched()

    page.dispatch('click', { target: { closest: () => null } })
    page.dispatch('click', { target: {} })
    page.dispatch('click', { target: null })
    page.dispatch('visibilitychange', {})

    expect(tab.readRefused()).toBe('reloading')
  })

  it('can be taken down', () => {
    const { page, stop } = watched()

    expect(page.count()).toBe(5)
    stop()

    expect(page.count()).toBe(0)
  })
})
