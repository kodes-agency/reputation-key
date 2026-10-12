// The app shell is replaced when a refusal is drawn, and a person's choice of
// sidebar must not go with it. The store is plain, so its rules are checked here;
// the shell being replaced is the Patterns/Route states story.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sidebarStore } from './shell-continuity'

afterEach(() => {
  sidebarStore.set(true)
})

describe('the sidebar store', () => {
  it('starts open, which is what the server renders', () => {
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
