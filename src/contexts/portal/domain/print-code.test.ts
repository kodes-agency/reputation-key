import { describe, expect, it } from 'vitest'
import {
  PRINT_CODE_ALPHABET,
  PRINT_CODE_LENGTH,
  normalizePrintCode,
  printCodeFromBytes,
} from './print-code'

describe('print code alphabet', () => {
  it('is Crockford base32: 32 symbols, none of I, L, O or U, all QR-alphanumeric', () => {
    expect(PRINT_CODE_ALPHABET).toHaveLength(32)
    expect(new Set(PRINT_CODE_ALPHABET).size).toBe(32)
    expect(PRINT_CODE_ALPHABET).not.toMatch(/[ILOU]/u)
    expect(PRINT_CODE_ALPHABET).toMatch(/^[0-9A-Z]+$/u)
    expect(PRINT_CODE_LENGTH * Math.log2(PRINT_CODE_ALPHABET.length)).toBe(100)
  })
})

describe('printCodeFromBytes', () => {
  it('reads the first 100 bits, five at a time', () => {
    expect(printCodeFromBytes(new Uint8Array(32))).toBe('0'.repeat(20))
    expect(printCodeFromBytes(new Uint8Array(32).fill(0xff))).toBe('Z'.repeat(20))
    const bits = Array.from({ length: 20 }, (_, i) =>
      (i + 1).toString(2).padStart(5, '0'),
    ).join('')
    const bytes = Uint8Array.from(
      (bits.padEnd(104, '0').match(/.{8}/gu) ?? []).map((byte) =>
        Number.parseInt(byte, 2),
      ),
    )
    expect(printCodeFromBytes(bytes)).toBe('123456789ABCDEFGHJKM')
  })

  it('ignores every bit after the 100th', () => {
    const base = new Uint8Array(32)
    const tail = new Uint8Array(32)
    tail[12] = 0b0000_1111
    tail.fill(0xff, 13)
    expect(printCodeFromBytes(tail)).toBe(printCodeFromBytes(base))
  })

  it('refuses fewer than 100 bits', () => {
    expect(() => printCodeFromBytes(new Uint8Array(12))).toThrow(RangeError)
  })
})

describe('normalizePrintCode', () => {
  const CODE = '7K3QZ0VD9MWX4HT2BN6R'

  it('accepts the canonical form unchanged', () => {
    expect(normalizePrintCode(CODE)).toBe(CODE)
  })

  it('folds case, so a lowercase scan address reaches the same code', () => {
    expect(normalizePrintCode(CODE.toLowerCase())).toBe(CODE)
    expect(normalizePrintCode('7k3qZ0vD9mWx4hT2bN6r')).toBe(CODE)
  })

  it('reads O as 0 and I or L as 1, either case', () => {
    expect(normalizePrintCode('OoIiLl' + '2'.repeat(14))).toBe('001111' + '2'.repeat(14))
  })

  it.each([
    ['too short', CODE.slice(0, 19)],
    ['too long', CODE + '2'],
    ['empty', ''],
    ['U is not in the alphabet', 'U' + CODE.slice(1)],
    ['lowercase u is not in the alphabet', 'u' + CODE.slice(1)],
    ['underscore', '_' + CODE.slice(1)],
    ['hyphen', '-' + CODE.slice(1)],
    ['space', ' ' + CODE.slice(1)],
    ['trailing newline', CODE.slice(0, 19) + '\n'],
    ['the long address shape', 'pt_AQEBAQEBAQEBAQEB_' + 'A'.repeat(43)],
  ])('refuses %s', (_name, raw) => {
    expect(normalizePrintCode(raw)).toBeNull()
  })

  // Folding before checking would turn these into ASCII letters or digits:
  // toUpperCase() maps ſ to S, ı to I and ﬁ to FI.
  it.each([
    ['long s', 'ſ' + CODE.slice(1)],
    ['dotless i', 'ı' + CODE.slice(1)],
    ['fi ligature, one char short', 'ﬁ' + CODE.slice(2)],
    ['fi ligature, 20 chars', 'ﬁ' + CODE.slice(1)],
    ['fullwidth digit', '７' + CODE.slice(1)],
    ['fullwidth letter', 'Ｋ' + CODE.slice(1)],
    ['Kelvin sign', 'K' + CODE.slice(1)],
    ['Turkish dotted I', 'İ' + CODE.slice(1)],
  ])('refuses %s without folding it into ASCII', (_name, raw) => {
    expect(normalizePrintCode(raw)).toBeNull()
  })
})
