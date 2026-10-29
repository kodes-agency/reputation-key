// Fixtures for the review-analysis v3 evidence path, which is dark: the live
// catalogue holds no v3 profile and refuses a v3 request. The preparer takes its
// profiles as a dependency, so a test hands it one. This stand-in is the v2 profile
// with the v3 names, a payload limit sized for sentences and the v3 provider schema.
// The real profile (prompt and digests) is slice 3.5's and replaces it there.

import { generateKeyPairSync } from 'node:crypto'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { renderOpenAiStaticTokenBearingMaterial } from '#/shared/ai-openai-request-contract'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from '#/shared/ai-route-output-schemas'
import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import {
  analysisV3Request,
  receipt,
} from '#/shared/ai-gateway-transport-contract.test-fixtures'
import type { ReviewAnalysisGatewayRequestV1 } from '#/shared/ai-gateway-transport-contract'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  createAiGatewayRoutePreparer,
  type RoutePreparationProfile,
} from './route-preparer'

export function v3TestProfile(): RoutePreparationProfile {
  const v2 = AI_OPERATION_PROFILES.find(
    (profile) => profile.sourceRoute === 'review-analysis',
  )
  if (v2 === undefined) throw new Error('the v2 analysis profile is missing')
  const outputSchema = AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3']
  const developerPrompt = 'Test prompt for the dark review-analysis v3 profile.'
  const staticTokenBearing = renderOpenAiStaticTokenBearingMaterial({
    developerMessage: developerPrompt,
    format: Object.freeze({
      type: 'json_schema',
      name: 'review_analysis_v3',
      strict: true,
      schema: outputSchema,
    }),
  })
  return {
    ...v2,
    profileVersion: 'review-analysis-v3',
    capabilityRuntimeProfileVersion: 'review-analysis-runtime-v2',
    providerDeploymentProfileVersion: 'private-beta-global-v2',
    outputSchemaName: 'review_analysis_v3',
    outputSchema,
    developerPrompt,
    staticTokenBearingBytes: staticTokenBearing.byteLength,
    staticTokenBearingDigest: staticTokenBearing.digest,
    providerPayloadByteLimit: 32_768,
    maxOutputTokens: 4_096,
  }
}

/** The v3 evidence request the preparer can read: it names the language catalogue it holds. */
export function preparableV3Request(
  input: Parameters<typeof analysisV3Request>[0] = {},
): ReviewAnalysisGatewayRequestV1 {
  const request = analysisV3Request(input)
  return {
    ...request,
    binding: { ...request.binding, languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST },
  }
}

export function evidencePreparer(
  options: Readonly<{ profiles?: readonly RoutePreparationProfile[] }> = {},
) {
  const provenance = generateKeyPairSync('ed25519')
  return createAiGatewayRoutePreparer({
    requestBindingKeys: createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`),
    safetyIdentifierKey: Buffer.alloc(32, 7),
    replyLanguageDetector: {
      detect: () => ({ language: 'en', probability: 1, reliable: true }),
    },
    provenanceKid: 'provenance-v1',
    provenancePrivateKey: provenance.privateKey,
    ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
  })
}

export const fakeSettlementReceipt = () => receipt as never
export const fakeGrant = () => ({}) as never
