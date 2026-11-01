import { afterEach, describe, expect, it, vi } from 'vitest'
import { takeStaffAddressSlot } from './staff-address-slots'

afterEach(() => vi.useRealTimers())
describe('staff address concurrency admission', () => {
  it('isolates Organizations, caps waiters at twenty and releases them', async () => {
    const first = await takeStaffAddressSlot('busy')
    const second = await takeStaffAddressSlot('busy')
    const queued = Array.from({ length: 20 }, () => takeStaffAddressSlot('busy'))
    await expect(takeStaffAddressSlot('busy')).rejects.toMatchObject({
      code: 'rate_limited',
    })
    const separate = await takeStaffAddressSlot('another')
    separate()
    first()
    for (const pending of queued) (await pending)()
    second()
    const fresh = await takeStaffAddressSlot('busy')
    fresh()
  })
  it('times out a waiter after thirty seconds without leaking its slot', async () => {
    vi.useFakeTimers()
    const first = await takeStaffAddressSlot('timeout')
    const second = await takeStaffAddressSlot('timeout')
    const waiting = expect(takeStaffAddressSlot('timeout')).rejects.toMatchObject({
      code: 'rate_limited',
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await waiting
    first()
    second()
    const fresh = await takeStaffAddressSlot('timeout')
    fresh()
  })
})
