// What the coordinator leaves behind when a write fails or is refused, what a
// flush and a teardown write, and when leaving the page has to ask.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPortalDraftAutosave, type PortalDraftSave } from './portal-draft-autosave'
import { harness, saved } from './portal-draft-autosave-harness'

afterEach(() => vi.useRealTimers())

describe('a failed save', () => {
  it('keeps the error and asks for attention', async () => {
    const { autosave } = harness()
    const boom = new Error('offline')
    autosave.schedule('welcome', async () => {
      throw boom
    })
    await vi.advanceTimersByTimeAsync(800)

    expect(autosave.getState()).toEqual({ status: 'error', savedAt: null, error: boom })
    expect(autosave.needsAttention()).toBe(true)
    expect(autosave.hasUnsaved()).toBe(true)
  })

  it('does not stop later saves from other forms', async () => {
    const { autosave } = harness()
    const note = vi.fn(saved)
    autosave.schedule('welcome', async () => {
      throw new Error('offline')
    })
    autosave.schedule('private-note', note)
    await vi.advanceTimersByTimeAsync(800)

    expect(note).toHaveBeenCalledTimes(1)
    expect(autosave.getState().status).toBe('error')
  })

  it('retry writes the failed save again and clears the error when it works', async () => {
    const { autosave } = harness()
    const save = vi
      .fn<PortalDraftSave>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('saved')
    autosave.schedule('welcome', save)
    await vi.advanceTimersByTimeAsync(800)

    await autosave.retry()

    expect(save).toHaveBeenCalledTimes(2)
    expect(autosave.getState().status).toBe('saved')
    expect(autosave.needsAttention()).toBe(false)
  })

  it('drops a failure when the same form is edited again', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', async () => {
      throw new Error('offline')
    })
    await vi.advanceTimersByTimeAsync(800)

    autosave.schedule('welcome', saved)

    expect(autosave.needsAttention()).toBe(false)
    expect(autosave.getState().status).toBe('pending')
  })

  it('does not let a stale failure overwrite a newer edit that is already waiting', async () => {
    const { autosave } = harness()
    let failFirst: (reason: Error) => void = () => undefined
    const first: PortalDraftSave = () =>
      new Promise((_resolve, reject) => {
        failFirst = reject
      })
    autosave.schedule('welcome', first)
    await vi.advanceTimersByTimeAsync(800)

    autosave.schedule('welcome', saved)
    failFirst(new Error('late'))
    await vi.advanceTimersByTimeAsync(0)

    expect(autosave.needsAttention()).toBe(false)
    await vi.advanceTimersByTimeAsync(800)
    expect(autosave.getState().status).toBe('saved')
  })
})

describe('discard', () => {
  it('forgets failed and refused saves, so the header and the next navigation are clean', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', async () => {
      throw new Error('offline')
    })
    autosave.schedule('private-note', async () => 'invalid')
    await vi.advanceTimersByTimeAsync(800)
    expect(autosave.needsAttention()).toBe(true)

    autosave.discard()

    expect(autosave.needsAttention()).toBe(false)
    expect(autosave.hasUnsaved()).toBe(false)
    expect(autosave.getState().status).toBe('idle')
  })

  it('does not drop an edit that is still waiting out its debounce', async () => {
    const { autosave } = harness()
    const save = vi.fn(saved)
    autosave.schedule('welcome', save)

    autosave.discard()
    await vi.advanceTimersByTimeAsync(800)

    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('onDiscard', () => {
  async function failTheme(autosave: ReturnType<typeof harness>['autosave']) {
    autosave.schedule('theme', async () => {
      throw new Error('offline')
    })
    await vi.advanceTimersByTimeAsync(800)
  }

  it('tells every listener which saves were given up when the person chose to leave', async () => {
    const { autosave } = harness()
    const first = vi.fn()
    const second = vi.fn()
    autosave.onDiscard(first)
    autosave.onDiscard(second)
    await failTheme(autosave)
    autosave.schedule('private-note', async () => 'invalid')
    await vi.advanceTimersByTimeAsync(800)

    autosave.discard()

    expect(first).toHaveBeenCalledTimes(1)
    expect([...(first.mock.calls[0]?.[0] ?? [])].sort()).toEqual([
      'private-note',
      'theme',
    ])
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when nothing had failed', () => {
    const { autosave } = harness()
    const listener = vi.fn()
    autosave.onDiscard(listener)

    autosave.discard()

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops calling a listener once it has unsubscribed', async () => {
    const { autosave } = harness()
    const listener = vi.fn()
    const stop = autosave.onDiscard(listener)
    await failTheme(autosave)

    stop()
    autosave.discard()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('flush', () => {
  it('writes what is waiting now and resolves once every save is done', async () => {
    const { autosave } = harness()
    const order: string[] = []
    autosave.schedule('welcome', async () => (order.push('save'), 'saved'))

    await autosave.flush()
    order.push('flushed')

    expect(order).toEqual(['save', 'flushed'])
    expect(autosave.hasUnsaved()).toBe(false)
  })

  it('waits for a save that is already running', async () => {
    const { autosave } = harness()
    const order: string[] = []
    autosave.schedule('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      order.push('a')
      return 'saved'
    })
    await vi.advanceTimersByTimeAsync(800)

    const flushing = autosave.flush().then(() => order.push('flushed'))
    await vi.advanceTimersByTimeAsync(400)
    await flushing

    expect(order).toEqual(['a', 'flushed'])
  })

  it('never rejects, even when the save fails', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', async () => {
      throw new Error('offline')
    })

    await expect(autosave.flush()).resolves.toBeUndefined()
    expect(autosave.needsAttention()).toBe(true)
  })

  it('is a no-op when nothing is waiting', async () => {
    const { autosave, states } = harness()
    await autosave.flush()
    expect(states).toEqual([])
  })
})

describe('what leaving the page has to ask about', () => {
  it('counts a keystroke inside the debounce as unsaved but not as needing attention', () => {
    const { autosave } = harness()
    autosave.schedule('welcome', saved)

    expect(autosave.hasUnsaved()).toBe(true)
    expect(autosave.needsAttention()).toBe(false)
  })

  it('counts a form with an explicit Save that is dirty, and stops when it is not', () => {
    const { autosave } = harness()
    let dirty = true
    const release = autosave.guardExplicit('brand', () => dirty)

    expect(autosave.needsAttention()).toBe(true)
    expect(autosave.hasUnsaved()).toBe(true)
    dirty = false
    expect(autosave.needsAttention()).toBe(false)
    dirty = true
    release()
    expect(autosave.needsAttention()).toBe(false)
  })

  it('is quiet once everything has been written', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', saved)
    await vi.advanceTimersByTimeAsync(800)

    expect(autosave.hasUnsaved()).toBe(false)
    expect(autosave.needsAttention()).toBe(false)
  })
})

describe('teardown', () => {
  it('writes an edit still inside its debounce when the editor goes away', async () => {
    const { autosave } = harness()
    const save = vi.fn(saved)
    autosave.schedule('welcome', save)

    autosave.flushOnTeardown()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not retry a save that already failed', async () => {
    const { autosave } = harness()
    const save = vi.fn<PortalDraftSave>().mockRejectedValue(new Error('offline'))
    autosave.schedule('welcome', save)
    await vi.advanceTimersByTimeAsync(800)

    autosave.flushOnTeardown()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('is harmless when nothing is waiting, as in every StrictMode teardown', async () => {
    const { autosave, states } = harness()
    autosave.flushOnTeardown()
    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual([])
  })

  it('stops notifying a subscriber that unsubscribed', async () => {
    vi.useFakeTimers()
    const autosave = createPortalDraftAutosave({ delayMs: 10 })
    const listener = vi.fn()
    const unsubscribe = autosave.subscribe(listener)
    unsubscribe()

    autosave.schedule('welcome', saved)
    await vi.advanceTimersByTimeAsync(20)

    expect(listener).not.toHaveBeenCalled()
  })
})
