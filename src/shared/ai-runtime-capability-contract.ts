import { materiallyChangedMerchantAiCapabilities } from './merchant-ai-notice-change'
import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  MERCHANT_AI_NOTICES_IN_FORCE,
  canonicalizeRfc8785,
  isMerchantAiNoticeInForce,
  type MerchantAiNoticeReference,
} from './merchant-ai-notice-contract'
import { REVIEW_ANALYSIS_V3_VERSIONS } from './review-analysis-v3'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type CapabilityRuntimeProfileVersions,
  type MerchantAiCapability,
} from './domain/merchant-ai-capability'

// Execution selection, independent of the deployment recorded as consent evidence.
const SERVED_PROVIDER_DEPLOYMENT_PROFILE = REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment

const noticeInForceSchema = z
  .object({
    noticeVersion: z.string().min(1).max(100),
    noticeDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

const runtimeEntrySchema = z
  .object({
    capability: z.enum(CURRENT_MERCHANT_AI_CAPABILITIES),
    runtimeProfileVersion: z.enum([
      'review-analysis-runtime-v2',
      'reply-drafting-runtime-v1',
      'reply-drafting-runtime-v2',
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
      'review-analysis-gateway-v2',
      'reply-suggestion-gateway-v1',
      'reply-suggestion-gateway-v2',
      'property-trend-gateway-v1',
    ]),
    caller: z.enum(['web', 'worker']),
    operationProfileVersion: z.enum([
      'review-analysis-v3',
      'reply-suggestion-v1',
      'reply-suggestion-v2',
      'property-trend-v1',
    ]),
    providerDeploymentProfileVersion: z.enum([
      SERVED_PROVIDER_DEPLOYMENT_PROFILE,
      'private-beta-global-v3',
    ]),
    // The notices whose consent admits this capability: the served one first,
    // then each earlier one it keeps in force (merchant-ai-notice-contract.ts).
    noticesInForce: z.array(noticeInForceSchema).min(1),
  })
  .strict()

export type AiRuntimeCapabilityV1 = Readonly<
  Omit<z.infer<typeof runtimeEntrySchema>, 'noticesInForce'> & {
    noticesInForce: ReadonlyArray<MerchantAiNoticeReference>
  }
>

/** Registered profiles; only an explicit serving selection authorizes execution. */
export const AI_RUNTIME_CAPABILITY_CATALOGUE = Object.freeze([
  Object.freeze({
    capability: 'review_analysis',
    runtimeProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.capabilityRuntime,
    purpose: 'ai.analyze',
    sourceRoute: 'review-analysis',
    gatewayPath: '/v1/review-analysis',
    gatewayProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.gatewayProfile,
    caller: 'worker',
    operationProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
    providerDeploymentProfileVersion: SERVED_PROVIDER_DEPLOYMENT_PROFILE,
    noticesInForce: MERCHANT_AI_NOTICES_IN_FORCE.review_analysis,
    served: true,
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
    providerDeploymentProfileVersion: SERVED_PROVIDER_DEPLOYMENT_PROFILE,
    noticesInForce: MERCHANT_AI_NOTICES_IN_FORCE.reply_drafting,
    served: false,
  }),
  Object.freeze({
    capability: 'reply_drafting',
    runtimeProfileVersion: 'reply-drafting-runtime-v2',
    purpose: 'ai.generate_reply',
    sourceRoute: 'reply-suggestion',
    gatewayPath: '/v1/reply-suggestion',
    gatewayProfileVersion: 'reply-suggestion-gateway-v2',
    caller: 'web',
    operationProfileVersion: 'reply-suggestion-v2',
    providerDeploymentProfileVersion: 'private-beta-global-v3',
    noticesInForce: MERCHANT_AI_NOTICES_IN_FORCE.reply_drafting,
    served: true,
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
    providerDeploymentProfileVersion: SERVED_PROVIDER_DEPLOYMENT_PROFILE,
    noticesInForce: MERCHANT_AI_NOTICES_IN_FORCE.property_trends,
    served: true,
  }),
] as const)

const EXPECTED_RUNTIME_CAPABILITIES = AI_RUNTIME_CAPABILITY_CATALOGUE.filter(
  (entry) => entry.served,
).map(({ served: _served, ...entry }) => entry)

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
  return Object.freeze(
    parsed.map((entry) =>
      Object.freeze({
        ...entry,
        noticesInForce: Object.freeze(
          entry.noticesInForce.map((notice) => Object.freeze(notice)),
        ),
      }),
    ),
  )
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

/**
 * Whether consent recorded under `notice` admits `entry`'s capability: the
 * notice, by version and its own digest, is one the catalogue holds in force.
 * The use cases ask it before claiming work and the gateway's request check
 * asks it again, so the two cannot disagree.
 */
export function isAiRuntimeNoticeInForce(
  entry: Pick<AiRuntimeCapabilityV1, 'capability' | 'noticesInForce'>,
  notice: MerchantAiNoticeReference,
): boolean {
  return isMerchantAiNoticeInForce(notice, entry.capability, entry.noticesInForce)
}

export type AiConsentExecution = Readonly<{
  runtimeProfileVersion: string
  operationProfileVersion: string
  providerDeploymentProfileVersion: string
}>

export type AiConsentCompatibility = AiConsentExecution &
  Readonly<{
    capability: MerchantAiCapability
    noticesInForce: ReadonlyArray<MerchantAiNoticeReference>
  }>

/** Compatibility is registered independently of serving; gateway serving remains exact. */
const AI_CONSENT_COMPATIBILITY: ReadonlyArray<AiConsentCompatibility> =
  AI_RUNTIME_CAPABILITY_CATALOGUE

/**
 * Consent follows the notice. Recorded runtime/deployment evidence is deliberately
 * absent: only an in-force version/digest and an explicitly listed execution pair
 * authorize work. The optional catalogue is a pure seam for contract regressions.
 */
export function isExecutionCompatibleWithConsent(
  input: Readonly<{
    capability: MerchantAiCapability
    acknowledgedNotice: MerchantAiNoticeReference
    servedExecution: AiConsentExecution
    /** Original operation notice, when settling provider work. */
    recordedNotice?: MerchantAiNoticeReference
  }>,
  catalogue: ReadonlyArray<AiConsentCompatibility> = AI_CONSENT_COMPATIBILITY,
): boolean {
  const { capability, acknowledgedNotice, servedExecution } = input
  return (
    isMerchantAiNoticeInForce(acknowledgedNotice, capability) &&
    (!input.recordedNotice ||
      !materiallyChangedMerchantAiCapabilities(
        input.recordedNotice,
        acknowledgedNotice,
      ).includes(capability)) &&
    catalogue.some(
      (entry) =>
        entry.capability === capability &&
        entry.runtimeProfileVersion === servedExecution.runtimeProfileVersion &&
        entry.operationProfileVersion === servedExecution.operationProfileVersion &&
        entry.providerDeploymentProfileVersion ===
          servedExecution.providerDeploymentProfileVersion &&
        isAiRuntimeNoticeInForce(entry, acknowledgedNotice),
    )
  )
}
