import { describe, expect, it } from 'vitest'
import {
  isHintBelow,
  UNKNOWN_VIEWPORT,
  VIEWPORT_COOKIE,
  viewportHintFromRequest,
} from './viewport-hint'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
// iPadOS asks for desktop sites, so its Safari sends the macOS string.
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

describe('viewportHintFromRequest', () => {
  it('reads the width the browser last reported from its cookie', () => {
    const hint = viewportHintFromRequest({
      cookie: `better-auth.session_token=abc; ${VIEWPORT_COOKIE}=390; sidebar_state=true`,
    })

    expect(hint.width).toBe(390)
  })

  it.each(['', 'abc', '390px', '3.5', '-5', '0', '99999'])(
    'ignores a cookie value it cannot trust (%j)',
    (value) => {
      const hint = viewportHintFromRequest({ cookie: `${VIEWPORT_COOKIE}=${value}` })

      expect(hint.width).toBeNull()
    },
  )

  it('does not mistake a cookie whose name only ends the same way', () => {
    const hint = viewportHintFromRequest({ cookie: `not_${VIEWPORT_COOKIE}=390` })

    expect(hint.width).toBeNull()
  })

  it('takes Chromium’s mobile client hint as the answer when it is sent', () => {
    expect(
      viewportHintFromRequest({ uaMobile: '?1', userAgent: DESKTOP_CHROME }).mobile,
    ).toBe(true)
    expect(
      viewportHintFromRequest({ uaMobile: '?0', userAgent: ANDROID_CHROME }).mobile,
    ).toBe(false)
  })

  it('falls back to the user agent when there is no client hint', () => {
    expect(viewportHintFromRequest({ userAgent: IPHONE_SAFARI }).mobile).toBe(true)
    expect(viewportHintFromRequest({ userAgent: ANDROID_CHROME }).mobile).toBe(true)
    expect(viewportHintFromRequest({ userAgent: IPAD_SAFARI }).mobile).toBe(false)
    expect(viewportHintFromRequest({ userAgent: DESKTOP_CHROME }).mobile).toBe(false)
  })

  it('knows nothing about a request that says nothing', () => {
    expect(viewportHintFromRequest({})).toEqual(UNKNOWN_VIEWPORT)
  })
})

describe('isHintBelow', () => {
  it('compares a known width with the breakpoint, exclusive of the breakpoint', () => {
    expect(isHintBelow({ width: 767, mobile: false }, 768)).toBe(true)
    expect(isHintBelow({ width: 768, mobile: false }, 768)).toBe(false)
    expect(isHintBelow({ width: 820, mobile: false }, 1078)).toBe(true)
    expect(isHintBelow({ width: 1440, mobile: false }, 1078)).toBe(false)
  })

  it('trusts a measured width over the mobile guess', () => {
    expect(isHintBelow({ width: 1024, mobile: true }, 768)).toBe(false)
  })

  it('treats a phone with no measured width as narrower than any breakpoint', () => {
    expect(isHintBelow({ width: null, mobile: true }, 768)).toBe(true)
    expect(isHintBelow({ width: null, mobile: true }, 1078)).toBe(true)
  })

  it('keeps the wide layout when nothing is known, as before the hint existed', () => {
    expect(isHintBelow(UNKNOWN_VIEWPORT, 768)).toBe(false)
    expect(isHintBelow(UNKNOWN_VIEWPORT, 1078)).toBe(false)
  })
})
