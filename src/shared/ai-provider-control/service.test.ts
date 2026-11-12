import { describe, expect, it } from 'vitest'
import { isGatewayOuterDeadlineValid } from './service'

describe('AI gateway absolute outer deadline', () => {
  it('accepts only a future deadline through its exact horizon', () => {
    const horizon = 70_000
    const now = 1_780_000_000_000
    expect(isGatewayOuterDeadlineValid(now + 1, now)).toBe(true)
    expect(isGatewayOuterDeadlineValid(now + horizon, now)).toBe(true)
    expect(isGatewayOuterDeadlineValid(now + horizon + 1, now)).toBe(false)
    expect(isGatewayOuterDeadlineValid(now, now)).toBe(false)
    expect(isGatewayOuterDeadlineValid(now - 1, now)).toBe(false)
  })

  it('rejects far-future and unsafe instants before a timer is constructed', () => {
    const now = 1_780_000_000_000
    expect(isGatewayOuterDeadlineValid(Number.MAX_SAFE_INTEGER, now)).toBe(false)
    expect(isGatewayOuterDeadlineValid(Number.MAX_SAFE_INTEGER + 1, now)).toBe(false)
    expect(isGatewayOuterDeadlineValid(Number.NaN, now)).toBe(false)
    expect(isGatewayOuterDeadlineValid(now + 1, Number.MAX_SAFE_INTEGER + 1)).toBe(false)
  })
})
