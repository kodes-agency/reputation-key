import { describe, expect, it } from 'vitest'
import { isGatewayOuterDeadlineValid } from './service'

describe('AI gateway absolute outer deadline', () => {
  it.each([
    ['review-analysis', 70_000],
    ['reply-suggestion', 70_000],
    ['property-trend', 100_000],
  ] as const)(
    'accepts only a future %s deadline through its exact horizon',
    (route, horizon) => {
      const now = 1_780_000_000_000
      expect(isGatewayOuterDeadlineValid(route, now + 1, now)).toBe(true)
      expect(isGatewayOuterDeadlineValid(route, now + horizon, now)).toBe(true)
      expect(isGatewayOuterDeadlineValid(route, now + horizon + 1, now)).toBe(false)
      expect(isGatewayOuterDeadlineValid(route, now, now)).toBe(false)
      expect(isGatewayOuterDeadlineValid(route, now - 1, now)).toBe(false)
    },
  )

  it('rejects far-future and unsafe instants before a timer is constructed', () => {
    const now = 1_780_000_000_000
    expect(
      isGatewayOuterDeadlineValid('review-analysis', Number.MAX_SAFE_INTEGER, now),
    ).toBe(false)
    expect(
      isGatewayOuterDeadlineValid('review-analysis', Number.MAX_SAFE_INTEGER + 1, now),
    ).toBe(false)
    expect(isGatewayOuterDeadlineValid('review-analysis', Number.NaN, now)).toBe(false)
    expect(
      isGatewayOuterDeadlineValid(
        'review-analysis',
        now + 1,
        Number.MAX_SAFE_INTEGER + 1,
      ),
    ).toBe(false)
  })
})
