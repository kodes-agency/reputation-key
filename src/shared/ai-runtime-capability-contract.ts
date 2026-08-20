import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
  canonicalizeRfc8785,
} from './merchant-ai-notice-contract'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type CapabilityRuntimeProfileVersions,
  type MerchantAiCapability,
} from './domain/merchant-ai-capability'

const runtimeEntrySchema = z
  .object({
    capability: z.enum(CURRENT_MERCHANT_AI_CAPABILITIES),
    runtimeProfileVersion: z.enum([
      'review-analysis-runtime-v1',
      'reply-drafting-runtime-v1',
      'property-trends-runtime-v1',
    ]),
    purpose: z.enum(['ai.analyze', 'ai.generate_reply', 'ai.detect_trends']),
    sourceRoute: z.enum(['review-analysis', 'reply-suggestion', 'property-trend']),
    gatewayPath: z.enum([
      '/v1/review-analysis',
      '/v1/reply-suggestion',
      '/v1/property-trend',
    ]),
    gatewayProfileVersion: z.enum([
      'review-analysis-gateway-v1',
      'reply-suggestion-gateway-v1',
      'property-trend-gateway-v1',
    ]),
    caller: z.enum(['web', 'worker']),
    operationProfileVersion: z.enum([
      'review-analysis-v1',
      'reply-suggestion-v1',
      'property-trend-v1',
    ]),
    providerDeploymentProfileVersion: z.literal('private-beta-global-v1'),
    noticeVersion: z.literal(MERCHANT_AI_NOTICE_VERSION),
    noticeDigest: z.literal(MERCHANT_AI_NOTICE_DIGEST),
  })
  .strict()

export type AiRuntimeCapabilityV1 = Readonly<z.infer<typeof runtimeEntrySchema>>

const EXPECTED_RUNTIME_CAPABILITIES = Object.freeze([
  Object.freeze({
    capability: 'review_analysis',
    runtimeProfileVersion: 'review-analysis-runtime-v1',
    purpose: 'ai.analyze',
    sourceRoute: 'review-analysis',
    gatewayPath: '/v1/review-analysis',
    gatewayProfileVersion: 'review-analysis-gateway-v1',
    caller: 'worker',
    operationProfileVersion: 'review-analysis-v1',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  }),
  Object.freeze({
    capability: 'reply_drafting',
    runtimeProfileVersion: 'reply-drafting-runtime-v1',
    purpose: 'ai.generate_reply',
    sourceRoute: 'reply-suggestion',
    gatewayPath: '/v1/reply-suggestion',
    gatewayProfileVersion: 'reply-suggestion-gateway-v1',
    caller: 'web',
    operationProfileVersion: 'reply-suggestion-v1',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  }),
  Object.freeze({
    capability: 'property_trends',
    runtimeProfileVersion: 'property-trends-runtime-v1',
    purpose: 'ai.detect_trends',
    sourceRoute: 'property-trend',
    gatewayPath: '/v1/property-trend',
    gatewayProfileVersion: 'property-trend-gateway-v1',
    caller: 'worker',
    operationProfileVersion: 'property-trend-v1',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  }),
] as const)

function failContract(message: string): never {
  throw new TypeError(`Invalid AI runtime capability catalogue: ${message}`)
}

export function parseAiRuntimeCapabilitiesV1(
  value: unknown,
): ReadonlyArray<AiRuntimeCapabilityV1> {
  const parsed = z
    .array(runtimeEntrySchema)
    .length(EXPECTED_RUNTIME_CAPABILITIES.length)
    .parse(value)
  const seen = new Set<string>()
  for (let index = 0; index < EXPECTED_RUNTIME_CAPABILITIES.length; index += 1) {
    const actual = parsed[index]
    const expected = EXPECTED_RUNTIME_CAPABILITIES[index]
    if (seen.has(actual.capability)) failContract(`duplicate ${actual.capability}`)
    seen.add(actual.capability)
    if (canonicalizeRfc8785(actual) !== canonicalizeRfc8785(expected)) {
      failContract(`entry ${index} is missing, reordered, or cross-wired`)
    }
  }
  return Object.freeze(parsed.map((entry) => Object.freeze(entry)))
}

export const AI_RUNTIME_CAPABILITIES_V1 = parseAiRuntimeCapabilitiesV1(
  EXPECTED_RUNTIME_CAPABILITIES,
)

export const AI_RUNTIME_CAPABILITIES_V1_DIGEST = createHash('sha256')
  .update('ai-runtime-capabilities-v1\0', 'utf8')
  .update(canonicalizeRfc8785(AI_RUNTIME_CAPABILITIES_V1), 'utf8')
  .digest('hex')

const CAPABILITY_SET = new Set<string>(CURRENT_MERCHANT_AI_CAPABILITIES)

export function resolveAiRuntimeCapabilitySet(
  requestedCapabilities: ReadonlyArray<MerchantAiCapability>,
): CapabilityRuntimeProfileVersions {
  if (requestedCapabilities.length === 0) {
    failContract('at least one capability is required')
  }
  const requested = new Set<string>()
  for (const capability of requestedCapabilities) {
    if (!CAPABILITY_SET.has(capability)) failContract(`unknown capability ${capability}`)
    if (requested.has(capability)) failContract(`duplicate capability ${capability}`)
    requested.add(capability)
  }
  if (requested.has('property_trends') && !requested.has('review_analysis')) {
    failContract('property_trends requires review_analysis')
  }

  const mapping: Partial<Record<MerchantAiCapability, string>> = {}
  for (const entry of AI_RUNTIME_CAPABILITIES_V1) {
    if (requested.has(entry.capability)) {
      mapping[entry.capability] = entry.runtimeProfileVersion
    }
  }
  return Object.freeze(mapping)
}

export function getAiRuntimeCapability(
  capability: MerchantAiCapability,
): AiRuntimeCapabilityV1 {
  const entry = AI_RUNTIME_CAPABILITIES_V1.find(
    (candidate) => candidate.capability === capability,
  )
  if (!entry) failContract(`unknown capability ${capability}`)
  return entry
}
