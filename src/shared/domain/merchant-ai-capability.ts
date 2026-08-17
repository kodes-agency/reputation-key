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
