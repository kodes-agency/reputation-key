import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { keyedPseudonym } from './keyed-pseudonym'

describe('keyedPseudonym', () => {
  it('is the hex HMAC-SHA256 of the NUL-terminated domain followed by the value', () => {
    const expected = createHmac('sha256', 'secret')
      .update('repkey:test:v1\0')
      .update('value')
      .digest('hex')

    expect(keyedPseudonym('secret', 'repkey:test:v1', 'value')).toBe(expected)
  })

  it('differs by domain, by secret and by value', () => {
    const base = keyedPseudonym('secret', 'repkey:a:v1', 'value')

    expect(keyedPseudonym('secret', 'repkey:b:v1', 'value')).not.toBe(base)
    expect(keyedPseudonym('other', 'repkey:a:v1', 'value')).not.toBe(base)
    expect(keyedPseudonym('secret', 'repkey:a:v1', 'other')).not.toBe(base)
  })
})
