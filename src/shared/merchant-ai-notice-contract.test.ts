import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
  parseMerchantAiNoticeCatalogueEntry,
} from './merchant-ai-notice-contract'
import { canonicalizeRfc8785 } from './canonical-json'

describe('Merchant AI notice contract', () => {
  it('canonicalizes the RFC 8785 primitive serialization vector', () => {
    const value = {
      numbers: [Number('333333333.33333329'), 1e30, 4.5, 2e-3, 1e-27],
      string: `€$\u000f\nA'B"\\"/`,
      literals: [null, true, false],
    }

    expect(canonicalizeRfc8785(value)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\"/"}',
    )
  })

  it('rejects hidden, accessor, symbol, and lone-surrogate input without invoking traps', () => {
    const hidden = { visible: true }
    Object.defineProperty(hidden, 'hidden', { value: 'not-hashed', enumerable: false })
    expect(() => canonicalizeRfc8785(hidden)).toThrow(/unsafe property/)

    let invoked = false
    const accessor = {}
    Object.defineProperty(accessor, 'unsafe', {
      enumerable: true,
      get() {
        invoked = true
        return 'not-hashed'
      },
    })
    expect(() => canonicalizeRfc8785(accessor)).toThrow(/unsafe property/)
    expect(invoked).toBe(false)

    expect(() => canonicalizeRfc8785({ [Symbol('hidden')]: true })).toThrow(
      /symbol properties/,
    )
    expect(() => canonicalizeRfc8785('\ud800')).toThrow(/Unicode scalar/)
    expect(() => canonicalizeRfc8785('\udc00')).toThrow(/Unicode scalar/)
    expect(() => canonicalizeRfc8785({ ['bad\ud800']: true })).toThrow(/Unicode scalar/)
    expect(canonicalizeRfc8785({ valid: 'A😀Z', decimal: 0.85 })).toBe(
      '{"decimal":0.85,"valid":"A😀Z"}',
    )
  })

  it('binds the immutable notice version and structured payload into the digest', () => {
    expect(MERCHANT_AI_NOTICE_VERSION).toBe('merchant-ai-notice-2026-09-06.v1')
    expect(MERCHANT_AI_NOTICE_DIGEST).toMatch(/^[0-9a-f]{64}$/)
    expect(MERCHANT_AI_NOTICE_DIGEST).toBe(
      createHash('sha256')
        .update('merchant-ai-notice-v1\0', 'utf8')
        .update(
          canonicalizeRfc8785(
            parseMerchantAiNoticeCatalogueEntry({
              version: MERCHANT_AI_NOTICE_VERSION,
              digest: MERCHANT_AI_NOTICE_DIGEST,
            }).payload,
          ),
          'utf8',
        )
        .digest('hex'),
    )
  })

  it('rejects unknown versions, tampered digests, and unknown fields', () => {
    expect(() =>
      parseMerchantAiNoticeCatalogueEntry({
        version: 'merchant-ai-notice-future.v1',
        digest: MERCHANT_AI_NOTICE_DIGEST,
      }),
    ).toThrow(/Invalid input|merchant-ai-notice/i)
    expect(() =>
      parseMerchantAiNoticeCatalogueEntry({
        version: MERCHANT_AI_NOTICE_VERSION,
        digest: '0'.repeat(64),
      }),
    ).toThrow(/digest/i)
    expect(() =>
      parseMerchantAiNoticeCatalogueEntry({
        version: MERCHANT_AI_NOTICE_VERSION,
        digest: MERCHANT_AI_NOTICE_DIGEST,
        copy: 'browser selected copy',
      }),
    ).toThrow(/Unrecognized key|copy/i)
  })
})
