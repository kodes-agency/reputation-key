// A print code is the short credential written into a printed QR or an NFC tag
// (ADR 0069): 20 Crockford base32 characters, 100 bits. These are the pure
// format rules; the keyed derivation and hashing live in the token codec.

export const PRINT_CODE_LENGTH = 20
const BITS_PER_CHARACTER = 5
const PRINT_CODE_BITS = PRINT_CODE_LENGTH * BITS_PER_CHARACTER

/**
 * Crockford base32: the digits and the letters without I, L, O and U. Every
 * symbol is in the QR alphanumeric set, which is what keeps the printed address
 * a version 3 symbol.
 */
export const PRINT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const AS_TYPED = /^[0-9A-Za-z]{20}$/u
const CANONICAL = /^[0-9A-HJKMNP-TV-Z]{20}$/u

/** The first 100 bits of `bytes`, five bits to a character. */
export function printCodeFromBytes(bytes: Uint8Array): string {
  const neededBytes = Math.ceil(PRINT_CODE_BITS / 8)
  if (bytes.length < neededBytes) {
    throw new RangeError(`A print code needs at least ${PRINT_CODE_BITS} bits`)
  }
  let bits = 0n
  for (const byte of bytes.subarray(0, neededBytes)) bits = (bits << 8n) | BigInt(byte)
  bits >>= BigInt(neededBytes * 8 - PRINT_CODE_BITS)
  let code = ''
  for (let index = PRINT_CODE_LENGTH - 1; index >= 0; index--) {
    const symbol = Number((bits >> BigInt(index * BITS_PER_CHARACTER)) & 0b11111n)
    code += PRINT_CODE_ALPHABET.charAt(symbol)
  }
  return code
}

/**
 * The canonical (uppercase) print code for what a scanner or a tag handed us, or
 * null when it is not one.
 *
 * The raw input must already be 20 ASCII letters and digits. Folding first would
 * let `ſ`, `ı` and `ﬁ` become ASCII through `toUpperCase()` (and a compatibility
 * normalisation would do the same to fullwidth digits), so a string nobody printed
 * would reach the lookup. After that, case folds (a reader may lowercase the path)
 * and the look-alikes read as Crockford says: O is 0, I and L are 1. U is not in
 * the alphabet.
 *
 * The long address shape contains `_`, so the two shapes never overlap.
 */
export function normalizePrintCode(raw: string): string | null {
  if (!AS_TYPED.test(raw)) return null
  const folded = raw.toUpperCase().replaceAll('O', '0').replaceAll(/[IL]/gu, '1')
  return CANONICAL.test(folded) ? folded : null
}
