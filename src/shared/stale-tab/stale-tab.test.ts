// What a browser tab does once it learns its code is older than the server's.
// The tab keeps the release that served its page, arms a flag when the server
// says it has moved on (or when code it needs is gone), and reloads at a moment
// that costs the person nothing: the next page-to-page navigation, or a route
// that already failed to draw. It never reloads under a mutation in flight.
import { describe, expect, it, vi } from 'vitest'
import { STALE_CLIENT_CODE } from './release-skew'
import { createStaleTab, readReleaseMeta, watchBrowserFailures } from './stale-tab'

const RELEASE = 'a'.repeat(40)

function setup(release: string | null = RELEASE) {
  const items = new Map<string, string>()
  const reload = vi.fn()
  const tab = createStaleTab({
    storage: () => ({
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
    }),
    now: () => 5_000_000,
    reload,
  })
  if (release !== null) tab.remember(release)
  return { tab, reload, items }
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

describe('watching the browser for missing code', () => {
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
  type Event = { pathChanged: boolean; toLocation: { publicHref: string } }

  function routerWith() {
    let listener: ((event: Event) => void) | undefined
    const unsubscribe = vi.fn()
    return {
      router: {
        subscribe: vi.fn((type: string, next: (event: Event) => void) => {
          if (type === 'onBeforeLoad') listener = next
          return unsubscribe
        }),
      },
      navigate: (pathChanged: boolean, publicHref = '/properties/42?tab=a') =>
        listener?.({ pathChanged, toLocation: { publicHref } }),
      unsubscribe,
    }
  }

  it('loads the target afresh when an armed tab goes to another page', () => {
    const { tab, reload } = setup()
    const { router, navigate } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()

    navigate(true, '/properties/42?tab=a')

    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith('/properties/42?tab=a')
  })

  it.each([
    '//attacker.example/x',
    '/\\attacker.example/x',
    'https://attacker.example/x',
    'properties',
    '',
  ])(
    'never loads %j: anything that is not a path on this site reloads the current address',
    (target) => {
      const { tab, reload } = setup()
      const { router, navigate } = routerWith()
      tab.reloadOnNavigation(router)
      tab.markStale()

      navigate(true, target)

      expect(reload).toHaveBeenCalledWith(undefined)
    },
  )

  it('does nothing while the tab is current', () => {
    const { tab, reload } = setup()
    const { router, navigate } = routerWith()
    tab.reloadOnNavigation(router)

    navigate(true)

    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing when only the search, the hash or a refresh changed, so a page keeps its form', () => {
    const { tab, reload } = setup()
    const { router, navigate } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()

    navigate(false)

    expect(reload).not.toHaveBeenCalled()
  })

  it('lets the navigation go on when a mutation is still in flight', () => {
    const { tab, reload } = setup()
    const { router, navigate } = routerWith()
    tab.reloadOnNavigation(router)
    tab.markStale()
    void tab.trackMutation(new Promise(() => undefined))

    navigate(true)

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
