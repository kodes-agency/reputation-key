import { describe, expect, it } from 'vitest'
import { safeReturnPath } from './safe-return-path'

describe('safeReturnPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/properties/prop-1?tab=reviews#latest', '/properties/prop-1?tab=reviews#latest'],
    ['/', '/'],
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
  ])('rejects an unsafe return target: %s', (candidate) => {
    expect(safeReturnPath(candidate)).toBeUndefined()
  })

  it('rejects an unreasonably large history target', () => {
    expect(safeReturnPath(`/${'a'.repeat(2048)}`)).toBeUndefined()
  })
})
