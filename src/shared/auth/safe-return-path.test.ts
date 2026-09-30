import { describe, expect, it } from 'vitest'
import { safeReturnPath } from './safe-return-path'

describe('safeReturnPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/properties/prop-1?tab=reviews#latest', '/properties/prop-1?tab=reviews#latest'],
    ['/', '/'],
    // The portal workspace and its review page, with the tab and hash a
    // signed-out manager was on: both must survive the sign-in round trip.
    [
      '/properties/prop-1/portals/portal-1?tab=share',
      '/properties/prop-1/portals/portal-1?tab=share',
    ],
    [
      '/properties/prop-1/portals/portal-1/review#changes',
      '/properties/prop-1/portals/portal-1/review#changes',
    ],
  ])('accepts the internal return path %s', (candidate, expected) => {
    expect(safeReturnPath(candidate)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    'dashboard',
    'https://attacker.example/dashboard',
    '//attacker.example/dashboard',
    '/%2f%2fattacker.example/dashboard',
    '/%255c%255cattacker.example/dashboard',
    '/bad-percent-%zz',
    '/\\attacker.example/dashboard',
    '\\attacker.example\\dashboard',
    'javascript:alert(1)',
    '/dashboard\u0000',
    // A dot-segment that would collapse to a protocol-relative URL.
    '/properties/prop-1/portals/portal-1/..//attacker.example/review',
  ])('rejects an unsafe return target: %s', (candidate) => {
    expect(safeReturnPath(candidate)).toBeUndefined()
  })

  it('rejects an unreasonably large history target', () => {
    expect(safeReturnPath(`/${'a'.repeat(2048)}`)).toBeUndefined()
  })
})
