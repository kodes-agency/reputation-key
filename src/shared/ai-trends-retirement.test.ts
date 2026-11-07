import { describe, expect, it } from 'vitest'
import {
  AI_RUNTIME_CAPABILITIES_V1,
  getAiRuntimeCapability,
  resolveAiRuntimeCapabilitySet,
} from './ai-runtime-capability-contract'
import {
  CURRENT_MERCHANT_AI_NOTICE,
  isMerchantAiNoticeInForce,
} from './merchant-ai-notice-contract'
import { materiallyChangedMerchantAiCapabilities } from './merchant-ai-notice-change'

const previousNotice = {
  noticeVersion: 'merchant-ai-notice-2026-11-06.v1',
  noticeDigest: 'eb810fedbb445bf9361d03280cfa44f31c3a8a8563a905549c3a7bdaed1a88f3',
}

describe('retired Property Trends', () => {
  it('offers and serves analysis and drafting only', () => {
    expect(CURRENT_MERCHANT_AI_NOTICE.payload.capabilities.map(({ id }) => id)).toEqual([
      'review_analysis',
      'reply_drafting',
    ])
    expect(AI_RUNTIME_CAPABILITIES_V1.map(({ capability }) => capability)).toEqual([
      'review_analysis',
      'reply_drafting',
    ])
    expect(() => getAiRuntimeCapability('property_trends')).toThrow(
      'Invalid AI runtime capability catalogue: unknown capability property_trends',
    )
    expect(() =>
      resolveAiRuntimeCapabilitySet(['review_analysis', 'property_trends']),
    ).toThrow(
      'Invalid AI runtime capability catalogue: unavailable capability property_trends',
    )
  })

  it('changes only retired processing without invalidating analysis or drafts', () => {
    const served = {
      noticeVersion: CURRENT_MERCHANT_AI_NOTICE.version,
      noticeDigest: CURRENT_MERCHANT_AI_NOTICE.digest,
    }
    expect(materiallyChangedMerchantAiCapabilities(previousNotice, served)).toEqual([
      'property_trends',
    ])
    expect(isMerchantAiNoticeInForce(previousNotice, 'review_analysis')).toBe(true)
    expect(isMerchantAiNoticeInForce(previousNotice, 'reply_drafting')).toBe(true)
  })
})
