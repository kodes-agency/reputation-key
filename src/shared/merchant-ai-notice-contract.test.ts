import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  isMerchantAiNoticeInForce,
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_PAYLOAD,
  MERCHANT_AI_NOTICE_VERSION,
  MERCHANT_AI_NOTICES_IN_FORCE,
  parseMerchantAiNoticeCatalogueEntry,
} from './merchant-ai-notice-contract'
import { canonicalizeRfc8785 } from './canonical-json'

/** How the catalogue digest is made: a domain prefix over the canonical payload. */
function noticeDigestOf(payload: unknown): string {
  return createHash('sha256')
    .update('merchant-ai-notice-v1\0', 'utf8')
    .update(canonicalizeRfc8785(payload), 'utf8')
    .digest('hex')
}

const NOTICE_2026_09_15 = Object.freeze({
  noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
  noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
})

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
    expect(MERCHANT_AI_NOTICE_VERSION).toBe('merchant-ai-notice-2026-10-17.v1')
    expect(MERCHANT_AI_NOTICE_DIGEST).toMatch(/^[0-9a-f]{64}$/)
    expect(MERCHANT_AI_NOTICE_DIGEST).toBe(
      noticeDigestOf(
        parseMerchantAiNoticeCatalogueEntry({
          version: MERCHANT_AI_NOTICE_VERSION,
          digest: MERCHANT_AI_NOTICE_DIGEST,
        }).payload,
      ),
    )
    expect(MERCHANT_AI_NOTICE_DIGEST).toBe(
      '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
    )
  })

  it('consents by acknowledgement, for one or several properties, without a step-up', () => {
    expect(MERCHANT_AI_NOTICE_PAYLOAD.requiresStepUp).toBe(false)
    expect(MERCHANT_AI_NOTICE_PAYLOAD.summary).not.toMatch(/this property/i)
  })

  it('calls to action without naming a property, however many the consent covers', () => {
    // The acknowledgement names every Property; the button only says what it does.
    expect(MERCHANT_AI_NOTICE_PAYLOAD.ctaTemplate).toBe('Enable AI features')
  })

  it('differs from the 2026-09-15 notice in its call to action alone', () => {
    // Put the old call to action back and the old digest comes out: the data
    // use, capabilities, retention and risks a 2026-09-15 consent agreed to are
    // word for word the ones served now.
    expect(
      noticeDigestOf({
        ...MERCHANT_AI_NOTICE_PAYLOAD,
        ctaTemplate: 'Enable AI features for {propertyNames}',
      }),
    ).toBe(NOTICE_2026_09_15.noticeDigest)
  })

  it('keeps consent recorded under the 2026-09-15 notice in force, and no earlier one', () => {
    expect(MERCHANT_AI_NOTICES_IN_FORCE).toEqual([
      {
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      },
      NOTICE_2026_09_15,
    ])
    expect(
      isMerchantAiNoticeInForce({
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      }),
    ).toBe(true)
    expect(isMerchantAiNoticeInForce(NOTICE_2026_09_15)).toBe(true)

    for (const lapsed of [
      // 2026-09-15 changed the consent itself (no password, one ceremony for
      // several Properties), so the consent before it re-consented.
      {
        noticeVersion: 'merchant-ai-notice-2026-09-09.v1',
        noticeDigest: 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1',
      },
      // A version is in force only with its own digest.
      { ...NOTICE_2026_09_15, noticeDigest: MERCHANT_AI_NOTICE_DIGEST },
      {
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: NOTICE_2026_09_15.noticeDigest,
      },
    ]) {
      expect(isMerchantAiNoticeInForce(lapsed)).toBe(false)
    }
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
