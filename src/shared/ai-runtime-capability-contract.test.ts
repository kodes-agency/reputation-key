import { describe, expect, it } from 'vitest'
import {
  AI_RUNTIME_CAPABILITIES_V1,
  AI_RUNTIME_CAPABILITIES_V1_DIGEST,
  parseAiRuntimeCapabilitiesV1,
  resolveAiRuntimeCapabilitySet,
} from './ai-runtime-capability-contract'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from './domain/merchant-ai-capability'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from './merchant-ai-notice-contract'

describe('AI runtime capability contract', () => {
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
      expect(entry.providerDeploymentProfileVersion).toBe('private-beta-global-v1')
      expect(entry.noticeVersion).toBe(MERCHANT_AI_NOTICE_VERSION)
      expect(entry.noticeDigest).toBe(MERCHANT_AI_NOTICE_DIGEST)
    }
  })

  it('resolves a requested set in canonical order with no mixed mapping', () => {
    expect(resolveAiRuntimeCapabilitySet(['property_trends', 'review_analysis'])).toEqual(
      {
        review_analysis: 'review-analysis-runtime-v1',
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
