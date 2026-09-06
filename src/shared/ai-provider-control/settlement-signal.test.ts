import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AI_SETTLEMENT_TIMEOUT_MILLIS,
  createAiSettlementSignal,
} from './settlement-signal'

afterEach(() => {
  vi.useRealTimers()
})

describe('AI settlement deadline', () => {
  it('uses the smaller of the settlement budget and remaining outer deadline', () => {
    vi.useFakeTimers()
    const bounded = createAiSettlementSignal(100)
    vi.advanceTimersByTime(99)
    expect(bounded.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(bounded.signal.aborted).toBe(true)
    expect(bounded.signal.reason).toBe('settlement_deadline')
    bounded.dispose()

    const capped = createAiSettlementSignal(AI_SETTLEMENT_TIMEOUT_MILLIS + 1_000)
    vi.advanceTimersByTime(AI_SETTLEMENT_TIMEOUT_MILLIS - 1)
    expect(capped.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(capped.signal.aborted).toBe(true)
    capped.dispose()
  })

  it('is already aborted when no outer deadline remains', () => {
    const value = createAiSettlementSignal(0)
    expect(value.signal.aborted).toBe(true)
    expect(value.signal.reason).toBe('settlement_deadline')
    value.dispose()
  })

  it('rejects invalid remaining deadlines', () => {
    const invalid = new TypeError('AI settlement remaining deadline is invalid')
    expect(() => createAiSettlementSignal(-1)).toThrow(invalid)
    expect(() => createAiSettlementSignal(Number.NaN)).toThrow(invalid)
  })
})
