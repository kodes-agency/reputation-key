// The app shell is replaced when a refusal is drawn, and a person's choice of
// sidebar must not go with it. The store is plain, so its rules are checked here;
// the shell being replaced is the Patterns/Route states story.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appLocationStore, createSidebarStore, sidebarStore } from './shell-continuity'
import { sidebarCookie, sidebarOpenFromCookie } from './sidebar-cookie'

afterEach(() => {
  sidebarStore.set(true)
})

describe('the sidebar store', () => {
  it('starts open when there is no cookie, which is what the server renders', () => {
    // Vitest runs the module in Node: no document, so no cookie to read.
    expect(sidebarStore.get()).toBe(true)
  })

  it('remembers a collapse for the shell that replaces the one that set it', () => {
    sidebarStore.set(false)

    expect(sidebarStore.get()).toBe(false)
  })

  it('tells a subscriber when the sidebar changes, and not when it does not', () => {
    const listener = vi.fn()
    const unsubscribe = sidebarStore.subscribe(listener)

    sidebarStore.set(true)
    expect(listener).not.toHaveBeenCalled()

    sidebarStore.set(false)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    sidebarStore.set(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('a sidebar store seeded from the cookie', () => {
  it('starts where the cookie said, so the browser agrees with the server', () => {
    const header = sidebarCookie(false, false).split(';')[0]
    const store = createSidebarStore(sidebarOpenFromCookie(header) ?? true, vi.fn())

    expect(store.get()).toBe(false)
  })

  it('writes each change, once, and nothing for a change that is not one', () => {
    const persist = vi.fn()
    const store = createSidebarStore(true, persist)

    store.set(true)
    expect(persist).not.toHaveBeenCalled()

    store.set(false)
    store.set(false)
    store.set(true)
    expect(persist.mock.calls).toEqual([[false], [true]])
  })

  it('has written before a subscriber hears of the change', () => {
    const order: string[] = []
    const store = createSidebarStore(true, () => order.push('written'))
    store.subscribe(() => order.push('heard'))

    store.set(false)

    expect(order).toEqual(['written', 'heard'])
  })
})

describe('the last app page, for "Back to app"', () => {
  it('is the last page outside Settings', () => {
    appLocationStore.remember({ pathname: '/inbox', search: { queue: 'new' } })
    appLocationStore.remember({ pathname: '/settings/profile', search: {} })
    appLocationStore.remember({ pathname: '/settings/members', search: {} })

    expect(appLocationStore.get()).toEqual({
      pathname: '/inbox',
      search: { queue: 'new' },
    })
  })

  it('does not take a path that only starts like Settings for Settings', () => {
    appLocationStore.remember({ pathname: '/settings-help', search: {} })

    expect(appLocationStore.get()?.pathname).toBe('/settings-help')
  })
})
