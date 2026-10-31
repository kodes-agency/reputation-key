import { describe, expect, it, vi } from 'vitest'
import { canAutoOpen, createAutoOpenSession } from './auto-open'

const ready = { shouldAutoOpen: true, visible: true, focused: true, dialogOpen: false }
describe('idle automatic update controller', () => {
  it.each([
    { shouldAutoOpen: false },
    { visible: false },
    { focused: false },
    { dialogOpen: true },
  ])('does not claim or open while gated by %j', async (override) => {
    const claim = vi.fn(async () => true),
      open = vi.fn()
    await createAutoOpenSession().attempt(
      'person',
      () => ({ ...ready, ...override }),
      claim,
      open,
    )
    expect(claim).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
  it('requires a winning claim and rechecks the screen after the request', async () => {
    const open = vi.fn()
    await createAutoOpenSession().attempt(
      'person',
      () => ready,
      async () => false,
      open,
    )
    const conditions = { ...ready }
    await createAutoOpenSession().attempt(
      'person',
      () => conditions,
      async () => {
        conditions.dialogOpen = true
        return true
      },
      open,
    )
    expect(open).not.toHaveBeenCalled()
  })
  it('attempts once despite concurrent mounts, remounts and later focus', async () => {
    const session = createAutoOpenSession(),
      claim = vi.fn(async () => true),
      open = vi.fn()
    await Promise.all([
      session.attempt('one', () => ready, claim, open),
      session.attempt('one', () => ready, claim, open),
    ])
    await session.attempt('one', () => ready, claim, open)
    expect(open).toHaveBeenCalledOnce()
    await session.attempt('two', () => ({ ...ready, focused: false }), claim, open)
    await session.attempt('two', () => ready, claim, open)
    expect(claim).toHaveBeenCalledOnce()
    expect(canAutoOpen(ready)).toBe(true)
  })
})
