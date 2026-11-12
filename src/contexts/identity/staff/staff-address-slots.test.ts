import { afterEach, describe, expect, it, vi } from 'vitest'
import { takeStaffOnboardingSlot } from './staff-address-slots.server'

afterEach(() => vi.useRealTimers())
const takeActive = () => Promise.all(Array.from({ length: 4 }, takeStaffOnboardingSlot))

describe('staff onboarding concurrency admission', () => {
  it('shares four slots across the process, caps waiters at forty and hands slots on', async () => {
    const held = await takeActive()
    let admitted = 0
    const queued = Array.from({ length: 40 }, () =>
      takeStaffOnboardingSlot().then((release) => {
        admitted += 1
        return release
      }),
    )
    await expect(takeStaffOnboardingSlot()).rejects.toMatchObject({
      code: 'rate_limited',
    })
    await Promise.resolve()
    expect(admitted).toBe(0)
    held[0]!()
    held[0]!()
    const first = await queued[0]!
    expect(admitted).toBe(1)
    for (const release of held.slice(1)) release()
    first()
    for (const pending of queued.slice(1)) (await pending)()
    const fresh = await takeActive()
    for (const release of fresh) release()
  })
  it('times out a waiter after thirty seconds without leaking its slot', async () => {
    vi.useFakeTimers()
    const held = await takeActive()
    const waiting = expect(takeStaffOnboardingSlot()).rejects.toMatchObject({
      code: 'rate_limited',
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await waiting
    for (const release of held) release()
    const fresh = await takeActive()
    for (const release of fresh) release()
  })
})
