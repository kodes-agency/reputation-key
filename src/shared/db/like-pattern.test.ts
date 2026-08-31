import { describe, expect, it } from 'vitest'
import { escapeLikePattern } from './like-pattern'

describe('escapeLikePattern', () => {
  it('leaves an ordinary substring alone', () => {
    expect(escapeLikePattern('great stay, thanks')).toBe('great stay, thanks')
  })

  it('escapes the wildcards so they match literally', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
  })

  it('escapes the backslash FIRST, so a literal one cannot free a wildcard', () => {
    // The regression this helper exists for. Escaping `%` before `\` produced
    // `\\%` — an escaped backslash followed by an UNESCAPED wildcard — and the
    // filter silently matched every row instead of the one the operator typed.
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%')
    expect(escapeLikePattern('\\')).toBe('\\\\')
  })

  it('is idempotent in the only sense that matters: escaping stays literal', () => {
    const once = escapeLikePattern('50%_off')
    expect(once).toBe('50\\%\\_off')
    // Escaping an already-escaped value escapes the backslashes too, so the
    // result still matches the ESCAPED text literally rather than widening.
    expect(escapeLikePattern(once)).toBe('50\\\\\\%\\\\\\_off')
  })
})
