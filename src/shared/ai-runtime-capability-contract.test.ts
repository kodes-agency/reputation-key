import { describe, expect, it } from 'vitest'
import {
  AI_RUNTIME_CAPABILITIES_V1,
  AI_RUNTIME_CAPABILITIES_V1_DIGEST,
  isAiRuntimeNoticeInForce,
  parseAiRuntimeCapabilitiesV1,
  resolveAiRuntimeCapabilitySet,
} from './ai-runtime-capability-contract'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  RECORDED_RUNTIME_PROFILE_VERSIONS,
} from './domain/merchant-ai-capability'
import { REVIEW_ANALYSIS_V3_LIVE } from './review-analysis-live'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
  MERCHANT_AI_NOTICES_IN_FORCE,
} from './merchant-ai-notice-contract'

const NOTICE_2026_09_15 = {
  noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
  noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
}
const NOTICE_2026_10_17 = {
  noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
  noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
}

describe('AI runtime capability contract', () => {
  // Settings offers what only v3 produces while this holds (`REVIEW_ANALYSIS_V3_LIVE`).
  // Turning the runtime selection back turns the constant back, or this test fails.
  it('selects review analysis v3 exactly when the product says v3 is on', () => {
    const selected = AI_RUNTIME_CAPABILITIES_V1.find(
      (entry) => entry.capability === 'review_analysis',
    )

    expect(selected?.operationProfileVersion === 'review-analysis-v3').toBe(
      REVIEW_ANALYSIS_V3_LIVE,
    )
  })

  it('owns one canonical complete runtime mapping for every Merchant capability', () => {
    expect(CURRENT_MERCHANT_AI_CAPABILITIES).toEqual([
      'review_analysis',
      'reply_drafting',
      'property_trends',
    ])
    expect(AI_RUNTIME_CAPABILITIES_V1.map(({ capability }) => capability)).toEqual(
      CURRENT_MERCHANT_AI_CAPABILITIES,
    )
    expect(AI_RUNTIME_CAPABILITIES_V1_DIGEST).toMatch(/^[0-9a-f]{64}$/)
    for (const entry of AI_RUNTIME_CAPABILITIES_V1) {
      // Execution selection currently uses one deployment for every capability.
      expect(entry.providerDeploymentProfileVersion).toBe('private-beta-global-v2')
      expect(entry.noticesInForce).toEqual(MERCHANT_AI_NOTICES_IN_FORCE)
    }
  })

  it('serves review analysis as v3 on its v2 runtime and gateway profiles, and the other two as they were', () => {
    expect(
      AI_RUNTIME_CAPABILITIES_V1.map((entry) => [
        entry.capability,
        entry.operationProfileVersion,
        entry.runtimeProfileVersion,
        entry.gatewayProfileVersion,
      ]),
    ).toEqual([
      [
        'review_analysis',
        'review-analysis-v3',
        'review-analysis-runtime-v2',
        'review-analysis-gateway-v2',
      ],
      [
        'reply_drafting',
        'reply-suggestion-v1',
        'reply-drafting-runtime-v1',
        'reply-suggestion-gateway-v1',
      ],
      [
        'property_trends',
        'property-trend-v1',
        'property-trends-runtime-v1',
        'property-trend-gateway-v1',
      ],
    ])
  })

  // A grant is append-only evidence and a deploy rewrites none: the store reads a grant
  // under any runtime profile one has held, and the newest of them is the one served.
  it('serves, for every capability, the newest runtime profile a grant has been recorded under', () => {
    for (const entry of AI_RUNTIME_CAPABILITIES_V1) {
      expect(RECORDED_RUNTIME_PROFILE_VERSIONS[entry.capability].at(-1)).toBe(
        entry.runtimeProfileVersion,
      )
    }
    expect(RECORDED_RUNTIME_PROFILE_VERSIONS.review_analysis).toEqual([
      'review-analysis-runtime-v1',
      'review-analysis-runtime-v2',
    ])
  })

  // The switch-on notice changed what a merchant agrees to, so it is the only one in
  // force: consent recorded under any earlier notice lapses, however recent.
  it('admits consent under the served notice alone', () => {
    for (const entry of AI_RUNTIME_CAPABILITIES_V1) {
      expect(
        isAiRuntimeNoticeInForce(entry, {
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        }),
      ).toBe(true)
      expect(isAiRuntimeNoticeInForce(entry, NOTICE_2026_10_17)).toBe(false)
      expect(isAiRuntimeNoticeInForce(entry, NOTICE_2026_09_15)).toBe(false)
      expect(
        isAiRuntimeNoticeInForce(entry, {
          noticeVersion: 'merchant-ai-notice-2026-09-09.v1',
          noticeDigest:
            'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1',
        }),
      ).toBe(false)
      expect(
        isAiRuntimeNoticeInForce(entry, {
          ...NOTICE_2026_10_17,
          noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        }),
      ).toBe(false)
    }
  })

  it('resolves a requested set in canonical order with no mixed mapping', () => {
    expect(resolveAiRuntimeCapabilitySet(['property_trends', 'review_analysis'])).toEqual(
      {
        review_analysis: 'review-analysis-runtime-v2',
        property_trends: 'property-trends-runtime-v1',
      },
    )
  })

  it('rejects missing, extra, duplicate, reordered, and cross-wired entries', () => {
    const valid = AI_RUNTIME_CAPABILITIES_V1.map((entry) => ({ ...entry }))
    const candidates: unknown[] = [
      valid.slice(0, 2),
      [...valid, valid[0]],
      [valid[1], valid[0], valid[2]],
      valid.map((entry, index) =>
        index === 0 ? { ...entry, purpose: 'ai.generate_reply' } : entry,
      ),
      valid.map((entry, index) => (index === 0 ? { ...entry, unknown: true } : entry)),
      // A capability may not admit a notice the others do not.
      valid.map((entry, index) =>
        index === 0
          ? { ...entry, noticesInForce: [...entry.noticesInForce, NOTICE_2026_10_17] }
          : entry,
      ),
      // Review analysis is served as v3 on the v2 runtime profile, not the old pair.
      valid.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              operationProfileVersion: 'review-analysis-v2',
              runtimeProfileVersion: 'review-analysis-runtime-v1',
            }
          : entry,
      ),
      // And under the v2 deployment profile, whichever capability.
      valid.map((entry, index) =>
        index === 1
          ? { ...entry, providerDeploymentProfileVersion: 'private-beta-global-v1' }
          : entry,
      ),
    ]

    for (const candidate of candidates) {
      expect(() => parseAiRuntimeCapabilitiesV1(candidate)).toThrow(
        /AI runtime capability catalogue|expected|Unrecognized key/i,
      )
    }
  })

  it('rejects invalid capability sets and the trends-without-analysis dependency', () => {
    expect(() => resolveAiRuntimeCapabilitySet([])).toThrow(/at least one/i)
    expect(() =>
      resolveAiRuntimeCapabilitySet(['review_analysis', 'review_analysis']),
    ).toThrow(/duplicate/i)
    expect(() => resolveAiRuntimeCapabilitySet(['property_trends'])).toThrow(
      /review_analysis/,
    )
    expect(() => resolveAiRuntimeCapabilitySet(['unknown' as 'review_analysis'])).toThrow(
      /unknown capability/i,
    )
  })
})
