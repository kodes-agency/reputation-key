import { describe, expect, it } from 'vitest'
import { ibanValid, longestValidIban, luhnValid } from './ai-financial-validators'

describe('ibanValid', () => {
  it.each([
    'GB82 WEST 1234 5698 7654 32',
    'bg80-bnbg-9661-1020-3456-78',
    'NO9386011117947',
  ])('accepts %s', (value) => {
    expect(ibanValid(value)).toBe(true)
  })

  it.each(['GB00 WEST 1234 5698 7654 32', 'BG80 BNBG 9661 1020 3456 78 please', 'BG80'])(
    'refuses %s',
    (value) => {
      expect(ibanValid(value)).toBe(false)
    },
  )
})

describe('longestValidIban', () => {
  it('keeps a match that validates whole', () => {
    expect(longestValidIban('GB82 WEST 1234 5698 7654 32')).toBe(
      'GB82 WEST 1234 5698 7654 32',
    )
  })

  it.each([
    ['BG80 BNBG 9661 1020 3456 78 please', 'BG80 BNBG 9661 1020 3456 78'],
    ['BG80 BNBG 9661 1020 3456 78 thank you', 'BG80 BNBG 9661 1020 3456 78'],
    ['GB82-WEST-1234-5698-7654-32-please', 'GB82-WEST-1234-5698-7654-32'],
    ['BG80BNBG96611020345678 please', 'BG80BNBG96611020345678'],
  ])('drops the words after the IBAN in %s', (raw, expected) => {
    expect(longestValidIban(raw)).toBe(expected)
  })

  it('takes the longest prefix when a shorter one also validates', () => {
    expect(ibanValid('NO93 8601 1117 947')).toBe(true)
    expect(longestValidIban('NO93 8601 1117 947 0074 please')).toBe(
      'NO93 8601 1117 947 0074',
    )
  })

  it('cuts only where a group ends', () => {
    expect(longestValidIban('BG80 BNBG 9661 1020 3456 78please')).toBeNull()
  })

  it('finds nothing in prose', () => {
    expect(longestValidIban('BG80 was sent to the front desk')).toBeNull()
  })
})

describe('luhnValid', () => {
  it('checks the Luhn digit', () => {
    expect(luhnValid('4111111111111111')).toBe(true)
    expect(luhnValid('4111111111111112')).toBe(false)
  })
})
