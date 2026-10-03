// A dialog that is committing something cannot be dismissed (UI consistency scan:
// SURF-03, FORM-16). Three dialogs did it (the upload shell, the batch publish
// and the reopen dialog), seven only disabled their Cancel, and six did nothing:
// Escape, the overlay and the close button put a half-committed form out of
// sight, and the refusal it was about to show was never read. The rule is one
// pure function and one counter, so it can be pinned here without a browser;
// `dialog.stories.tsx` plays it through a real dialog.
import { describe, expect, it, vi } from 'vitest'
import { createBusyStore, guardDismissal } from './dialog-dismissal'

describe('createBusyStore', () => {
  it('is idle until something holds it', () => {
    expect(createBusyStore().isBusy()).toBe(false)
  })

  it('is busy while a hold is open, and idle once it is released', () => {
    const store = createBusyStore()
    const release = store.hold()

    expect(store.isBusy()).toBe(true)
    release()
    expect(store.isBusy()).toBe(false)
  })

  it('stays busy until every hold is released', () => {
    const store = createBusyStore()
    const releaseFirst = store.hold()
    const releaseSecond = store.hold()

    releaseFirst()
    expect(store.isBusy()).toBe(true)
    releaseSecond()
    expect(store.isBusy()).toBe(false)
  })

  it('ignores a hold released twice', () => {
    const store = createBusyStore()
    const release = store.hold()
    const other = store.hold()

    release()
    release()
    expect(store.isBusy()).toBe(true)
    other()
    expect(store.isBusy()).toBe(false)
  })

  it('tells a subscriber when it changes, and stops once unsubscribed', () => {
    const store = createBusyStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    const release = store.hold()
    release()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    store.hold()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('guardDismissal', () => {
  it('lets a dialog close when nothing is in flight', () => {
    const onOpenChange = vi.fn()

    guardDismissal(() => false, onOpenChange)(false)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('refuses to close while busy: Escape, the overlay and the close button', () => {
    const onOpenChange = vi.fn()

    guardDismissal(() => true, onOpenChange)(false)

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('still lets a dialog open while busy', () => {
    const onOpenChange = vi.fn()

    guardDismissal(() => true, onOpenChange)(true)

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('asks again at each attempt, so a request that settled lets go', () => {
    const onOpenChange = vi.fn()
    let busy = true
    const guarded = guardDismissal(() => busy, onOpenChange)

    guarded(false)
    busy = false
    guarded(false)

    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })
})
