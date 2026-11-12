import { describe, expect, it, vi } from 'vitest'
import { canAutoOpen, createAutoOpenSession, planAutoOpen, winOpening } from './auto-open'

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

describe('when the modal may open by itself', () => {
  const dueThisWeek = { autoShow: true, shouldAutoOpen: true }
  // Inside the 7-day window, or nothing unseen: the server says it is not due.
  const notDue = { autoShow: true, shouldAutoOpen: false }

  it('follows the weekly rule, which has to win the server claim', () => {
    expect(planAutoOpen(dueThisWeek, false)).toEqual({ claim: true })
  })
  it('keeps the claim when an AI update is pending too, so the week is used up', () => {
    expect(planAutoOpen(dueThisWeek, true)).toEqual({ claim: true })
  })
  it('lets a pending AI update open it inside the weekly window, without the claim', () => {
    expect(planAutoOpen(notDue, true)).toEqual({ claim: false })
  })
  it('never lets an AI update open it by itself while updates are not shown automatically', () => {
    expect(planAutoOpen({ autoShow: false, shouldAutoOpen: false }, true)).toBeNull()
  })
  it('stays closed when nothing is due and no AI update is pending', () => {
    expect(planAutoOpen(notDue, false)).toBeNull()
  })
})

describe('winning the opening', () => {
  it('asks the server for the weekly rule and keeps its answer', async () => {
    expect(await winOpening({ claim: true }, async () => true)).toBe(true)
    expect(await winOpening({ claim: true }, async () => false)).toBe(false)
  })
  it('does not ask the server for an AI update', async () => {
    const serverClaim = vi.fn(async () => false)
    expect(await winOpening({ claim: false }, serverClaim)).toBe(true)
    expect(serverClaim).not.toHaveBeenCalled()
  })
  it('opens an AI update once per session and only on a screen that can take it', async () => {
    const session = createAutoOpenSession(),
      serverClaim = vi.fn(async () => false),
      open = vi.fn()
    const claim = () => winOpening({ claim: false }, serverClaim)
    await session.attempt('hidden-tab', () => ({ ...ready, visible: false }), claim, open)
    await session.attempt('hidden-tab', () => ready, claim, open)
    await session.attempt(
      'other-dialog',
      () => ({ ...ready, dialogOpen: true }),
      claim,
      open,
    )
    expect(open).not.toHaveBeenCalled()
    await session.attempt('admin', () => ready, claim, open)
    await session.attempt('admin', () => ready, claim, open)
    expect(open).toHaveBeenCalledOnce()
    expect(serverClaim).not.toHaveBeenCalled()
  })
})
