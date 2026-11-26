import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { keyedPseudonym } from './keyed-pseudonym'

describe('keyedPseudonym', () => {
  it('is the hex HMAC-SHA-256 of the domain followed by the value', () => {
    const expected = createHmac('sha256', 'secret')
      .update('repkey:test:v1\0')
      .update('value')
      .digest('hex')

    expect(keyedPseudonym('secret', 'repkey:test:v1\0', 'value')).toBe(expected)
  })

  it('differs by domain, value and secret', () => {
    const base = keyedPseudonym('secret', 'a\0', 'value')

    expect(keyedPseudonym('secret', 'b\0', 'value')).not.toBe(base)
    expect(keyedPseudonym('secret', 'a\0', 'other')).not.toBe(base)
    expect(keyedPseudonym('other', 'a\0', 'value')).not.toBe(base)
  })
})
