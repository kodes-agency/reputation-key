export const CURRENT_MERCHANT_AI_CAPABILITIES = Object.freeze([
  'review_analysis',
  'reply_drafting',
  'property_trends',
] as const)

export type MerchantAiCapability = (typeof CURRENT_MERCHANT_AI_CAPABILITIES)[number]

export type MerchantAiPurpose = 'ai.analyze' | 'ai.generate_reply' | 'ai.detect_trends'

export type CapabilityRuntimeProfileVersions = Readonly<
  Partial<Record<MerchantAiCapability, string>>
>

/**
 * Every runtime profile version may be recorded as Merchant AI grant evidence, per
 * capability, oldest first; the last is the one served now. Runtime/deployment evidence is historical, never execution permission (ADR 0074). A grant is append-only
 * evidence: a deploy rewrites none, so a Property enabled before the switch-on of
 * review analysis v3 (2026-10-30) still holds `review-analysis-runtime-v1` until an
 * AccountAdmin confirms the notice again, and the store must read it (the consent
 * that replaces it starts from it). The database CHECKs admit exactly these
 * (`merchant-ai-authorization.schema.ts`, migration 0083), and the runtime catalogue
 * serves the last (`ai-runtime-capability-contract.ts`); a test holds the three equal.
 */
export const RECORDED_RUNTIME_PROFILE_VERSIONS: Readonly<
  Record<MerchantAiCapability, readonly string[]>
> = Object.freeze({
  review_analysis: Object.freeze([
    'review-analysis-runtime-v1',
    'review-analysis-runtime-v2',
  ]),
  reply_drafting: Object.freeze(['reply-drafting-runtime-v1']),
  property_trends: Object.freeze(['property-trends-runtime-v1']),
})
