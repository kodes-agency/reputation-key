// The coordinator decides what "saved" means for a portal's draft: when a
// keystroke becomes a write, that two forms never write the same portal at
// once, and what status the header shows. Failure, flushing and teardown are in
// portal-draft-autosave-failure.test.ts. It is framework-free so these run in
// the Node unit project.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, saved } from './portal-draft-autosave-harness'
import type { PortalDraftSave } from './portal-draft-autosave'

afterEach(() => vi.useRealTimers())

describe('debouncing', () => {
  it('writes once, after the person stops, using the latest save for that key', async () => {
    const { autosave } = harness()
    const first = vi.fn(saved)
    const latest = vi.fn(saved)

    autosave.schedule('welcome', first)
    await vi.advanceTimersByTimeAsync(500)
    autosave.schedule('welcome', latest)
    await vi.advanceTimersByTimeAsync(799)
    expect(latest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it('debounces each key on its own clock', async () => {
    const { autosave } = harness()
    const welcome = vi.fn(saved)
    const note = vi.fn(saved)

    autosave.schedule('welcome', welcome)
    await vi.advanceTimersByTimeAsync(400)
    autosave.schedule('private-note', note)
    await vi.advanceTimersByTimeAsync(400)

    expect(welcome).toHaveBeenCalledTimes(1)
    expect(note).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(note).toHaveBeenCalledTimes(1)
  })
})

describe('serialising writes for one portal', () => {
  it('never runs two saves at the same time', async () => {
    const { autosave } = harness()
    let active = 0
    let peak = 0
    const slow: PortalDraftSave = async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 300))
      active -= 1
      return 'saved'
    }

    autosave.schedule('welcome', slow)
    autosave.schedule('theme', slow)
    autosave.schedule('private-note', slow)
    await vi.advanceTimersByTimeAsync(800)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(peak).toBe(1)
  })

  it('runs saves in the order their debounces fired', async () => {
    const { autosave } = harness()
    const order: string[] = []
    autosave.schedule('a', async () => (order.push('a'), 'saved'))
    await vi.advanceTimersByTimeAsync(100)
    autosave.schedule('b', async () => (order.push('b'), 'saved'))
    await vi.advanceTimersByTimeAsync(2_000)

    expect(order).toEqual(['a', 'b'])
  })

  it('writes an edit made during a save afterwards, not instead', async () => {
    const { autosave } = harness()
    const calls: string[] = []
    let releaseFirst: () => void = () => undefined
    const first: PortalDraftSave = () =>
      new Promise((resolve) => {
        calls.push('first:start')
        releaseFirst = () => {
          calls.push('first:end')
          resolve('saved')
        }
      })
    const second: PortalDraftSave = async () => (calls.push('second'), 'saved')

    autosave.schedule('welcome', first)
    await vi.advanceTimersByTimeAsync(800)
    autosave.schedule('welcome', second)
    await vi.advanceTimersByTimeAsync(800)
    expect(calls).toEqual(['first:start'])

    releaseFirst()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['first:start', 'first:end', 'second'])
  })
})

describe('status', () => {
  it('walks pending, saving, saved and records when it saved', async () => {
    const { autosave, statuses } = harness()
    expect(autosave.getState()).toEqual({ status: 'idle', savedAt: null, error: null })

    autosave.schedule('welcome', saved)
    await vi.advanceTimersByTimeAsync(800)

    expect(statuses()).toEqual(['pending', 'saving', 'saved'])
    expect(autosave.getState()).toEqual({ status: 'saved', savedAt: 1_000, error: null })
  })

  it('does not claim "Draft saved" for a save that wrote nothing', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', async () => 'unchanged')
    await vi.advanceTimersByTimeAsync(800)

    expect(autosave.getState()).toEqual({ status: 'idle', savedAt: null, error: null })
  })

  it('keeps the time of the last real write when a later save wrote nothing', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', saved)
    await vi.advanceTimersByTimeAsync(800)
    autosave.schedule('welcome', async () => 'unchanged')
    await vi.advanceTimersByTimeAsync(800)

    expect(autosave.getState()).toEqual({ status: 'saved', savedAt: 1_000, error: null })
  })

  it('clears "invalid" when a later save finds nothing to write', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', async () => 'invalid')
    await vi.advanceTimersByTimeAsync(800)
    autosave.schedule('welcome', async () => 'unchanged')
    await vi.advanceTimersByTimeAsync(800)

    expect(autosave.needsAttention()).toBe(false)
  })

  it('stays "saving" until every queued save is done', async () => {
    const { autosave } = harness()
    autosave.schedule('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return 'saved'
    })
    autosave.schedule('b', saved)
    await vi.advanceTimersByTimeAsync(800)
    expect(autosave.getState().status).toBe('saving')
    await vi.advanceTimersByTimeAsync(300)
    expect(autosave.getState().status).toBe('saved')
  })

  it('reports "invalid" when the form refused the values, and does not call that saved', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', async () => 'invalid')
    await vi.advanceTimersByTimeAsync(800)

    expect(autosave.getState()).toEqual({ status: 'invalid', savedAt: null, error: null })
    expect(autosave.needsAttention()).toBe(true)
  })

  it('clears "invalid" as soon as the person edits again, and again on a good save', async () => {
    const { autosave } = harness()
    autosave.schedule('welcome', async () => 'invalid')
    await vi.advanceTimersByTimeAsync(800)

    autosave.schedule('welcome', saved)
    expect(autosave.getState().status).toBe('pending')
    await vi.advanceTimersByTimeAsync(800)
    expect(autosave.getState().status).toBe('saved')
    expect(autosave.needsAttention()).toBe(false)
  })

  it('does not notify when nothing about the state changed', async () => {
    const { autosave, states } = harness()
    autosave.schedule('welcome', saved)
    autosave.schedule('welcome', saved)
    const afterTwoEdits = states.length

    expect(afterTwoEdits).toBe(1)
  })
})
