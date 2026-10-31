import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  isMerchantAiNoticeInForce,
  isMerchantAiNoticeInForceForCapabilities,
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
const NOTICE_2026_10_17 = Object.freeze({
  noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
  noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
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
    expect(MERCHANT_AI_NOTICE_VERSION).toBe('merchant-ai-notice-2026-11-01.v1')
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
      'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef',
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

  it('is a material change: it names Anthropic, lists what review analysis keeps and asks for consent again', () => {
    // The data use changed, so the notice before it cannot be carried forward: the text
    // a 2026-10-17 consent agreed to is not the text served now (a second provider, the
    // stored results, quality testing, the Urgent alert).
    const titles = MERCHANT_AI_NOTICE_PAYLOAD.sections.map((section) => section.id)
    expect(titles).toEqual([
      'data_and_features',
      'analysis_record',
      'provider_posture',
      'provider_posture_anthropic',
      'provider_use',
      'limits_and_retention',
      'how_results_are_used',
      'human_control_and_risk',
    ])
    expect(MERCHANT_AI_NOTICE_PAYLOAD.summary).toContain('OpenAI and Anthropic')
    expect(
      noticeDigestOf({
        ...MERCHANT_AI_NOTICE_PAYLOAD,
        ctaTemplate: 'Enable AI features for {propertyNames}',
      }),
    ).not.toBe(NOTICE_2026_09_15.noticeDigest)
    expect(MERCHANT_AI_NOTICE_DIGEST).not.toBe(NOTICE_2026_10_17.noticeDigest)
  })

  it('serves the three capabilities, three retention rows and six risks the owner approved', () => {
    expect(MERCHANT_AI_NOTICE_PAYLOAD.capabilities.map((entry) => entry.id)).toEqual([
      'review_analysis',
      'reply_drafting',
      'property_trends',
    ])
    expect(MERCHANT_AI_NOTICE_PAYLOAD.capabilities[0]?.description).toBe(
      'Analyze new and materially updated eligible Google reviews, including marking a review Urgent.',
    )
    expect(
      MERCHANT_AI_NOTICE_PAYLOAD.retentionAndRevocation.map((row) => row.label),
    ).toEqual([
      'RepKey raw review source',
      'RepKey de-identified insights',
      'Provider retention',
    ])
    expect(MERCHANT_AI_NOTICE_PAYLOAD.risks).toHaveLength(6)
  })

  it('serves no link without a target: the Anthropic subprocessor placeholder is not served', () => {
    const anthropic = MERCHANT_AI_NOTICE_PAYLOAD.sections.find(
      (section) => section.id === 'provider_posture_anthropic',
    )
    expect(anthropic?.links).toEqual([
      {
        label: 'Anthropic privacy centre, API data retention',
        target: 'https://privacy.claude.com/en/articles/7996868',
      },
    ])
    for (const section of MERCHANT_AI_NOTICE_PAYLOAD.sections) {
      for (const link of section.links) {
        expect(link.target).toMatch(/^(\/|https:\/\/)/)
        expect(link.target).not.toMatch(/[[\]]/)
      }
    }
  })

  it('requests renewal only for selected capabilities whose notice is no longer in force', () => {
    const notice = {
      noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
      noticeDigest: 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
    }
    expect(
      isMerchantAiNoticeInForceForCapabilities({
        ...notice,
        capabilities: ['review_analysis', 'property_trends'],
      }),
    ).toBe(true)
    expect(
      isMerchantAiNoticeInForceForCapabilities({
        ...notice,
        capabilities: ['review_analysis', 'property_trends', 'reply_drafting'],
      }),
    ).toBe(false)
  })
  it('keeps the served notice in force alone: every earlier consent lapses', () => {
    expect(MERCHANT_AI_NOTICES_IN_FORCE.reply_drafting).toEqual([
      {
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      },
    ])
    expect(
      isMerchantAiNoticeInForce(
        {
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        },
        'reply_drafting',
      ),
    ).toBe(true)

    for (const lapsed of [
      // 2026-10-17 and 2026-09-15 agreed to a record of aspects and one issue label
      // and to OpenAI alone; the served notice is not word for word the same use.
      NOTICE_2026_10_17,
      NOTICE_2026_09_15,
      {
        noticeVersion: 'merchant-ai-notice-2026-09-09.v1',
        noticeDigest: 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1',
      },
      // A version is in force only with its own digest.
      { ...NOTICE_2026_10_17, noticeDigest: MERCHANT_AI_NOTICE_DIGEST },
      {
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: NOTICE_2026_10_17.noticeDigest,
      },
    ]) {
      expect(isMerchantAiNoticeInForce(lapsed, 'reply_drafting')).toBe(false)
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

it('changes only the three drafting passages and keeps every other word of the prior notice', () => {
  const previous = JSON.parse(
    JSON.stringify(MERCHANT_AI_NOTICE_PAYLOAD)
      .replace(
        'property context needed for the selected feature, and facts your property chose to share with the AI.',
        'property context needed for the selected feature.',
      )
      .replace(
        "Drafts may be prepared when a manager opens a review or asks for one. The AI provider drafts the reply body from the review text (numbered sentences), the rating, the language, the tone, and facts your property chose to share with the AI. RepKey adds the property's greeting, contact line, closing and signature locally. The draft is verified for language before it is shown;",
        "A reply suggestion is drafted by the AI provider from the review text and the Property's public display name, grounded in exact excerpts of the review and verified for language before it is shown;",
      )
      .replace(
        'Prepare an editable reply suggestion when a manager opens a review or asks for one.',
        'Draft an editable, grounded reply suggestion from the review when a manager asks.',
      ),
  )
  expect(noticeDigestOf(previous)).toBe(
    'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
  )
})
