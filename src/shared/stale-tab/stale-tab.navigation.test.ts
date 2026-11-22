// What a browser tab does once it learns its code is older than the server's.
// The tab keeps the release that served its page, arms a flag when the server
// says it has moved on (or when code it needs is gone), and reloads at a moment
// that costs the person nothing: the next navigation to another view (a new
// path or new search), a read refused just after a navigation or just after they
// came back to the tab, a route that already failed to draw, or Try again pressed
// on a read that can only be refused again. It never reloads under a mutation in
// flight.
import { describe, expect, it, vi } from 'vitest'
import { FRESH_VIEW_MS, watchPerson } from './stale-tab'
import {
  RELEASE,
  changedControl,
  reloadSafe,
  routerWith,
  setup,
  windowWith,
} from './stale-tab.test-fixtures'

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
