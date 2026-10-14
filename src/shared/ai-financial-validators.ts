// Check-digit validators of structured-marker-detectors-v1 (`luhn-v1`, `iban-mod97-v1`).

export function luhnValid(digits: string): boolean {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 0x30
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

export function ibanValid(value: string): boolean {
  const compact = value.replace(/[ -]/gu, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(compact) || compact.length > 34) {
    return false
  }
  const rearranged = compact.slice(4) + compact.slice(0, 4)
  let remainder = 0
  for (const character of rearranged) {
    const expanded = /[A-Z]/u.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

export const IBAN_GROUP_SEPARATOR_RE = /[ -]/gu

/*
 * The IBAN pattern is greedy, so the words after an IBAN ("… 3456 78 please")
 * join the match and fail the checksum. A failed match retries each shorter
 * prefix that ends where a group does, longest first; ibanValid holds every
 * try to the 15 to 34 characters an IBAN takes.
 */
export function longestValidIban(raw: string): string | null {
  if (ibanValid(raw)) return raw
  const groupEnds = Array.from(
    raw.matchAll(IBAN_GROUP_SEPARATOR_RE),
    (separator) => separator.index,
  )
  for (let index = groupEnds.length - 1; index >= 0; index -= 1) {
    const prefix = raw.slice(0, groupEnds[index])
    if (ibanValid(prefix)) return prefix
  }
  return null
}
