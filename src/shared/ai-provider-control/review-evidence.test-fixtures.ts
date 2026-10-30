// Fixtures for the review-analysis v3 evidence path. The live catalogue serves v3,
// and the preparer also takes its profiles as a dependency, so a test can hand it
// the v3 profile itself as the catalogue entry (the logical profile served by
// OpenAI), with the real prompt, schema and limits, and add what a test needs, such
// as a second attested provider.

import { generateKeyPairSync } from 'node:crypto'
import { operationProfileForCatalogue } from '#/shared/ai-operation-profile-views'
import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import {
  analysisV3Request,
  receipt,
} from '#/shared/ai-gateway-transport-contract.test-fixtures'
import type { ReviewAnalysisGatewayRequestV1 } from '#/shared/ai-gateway-transport-contract'
import {
  REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
  REVIEW_ANALYSIS_V3_OPENAI_PAIRING,
} from '#/shared/review-analysis-v3-profile'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { PreparedGatewayRouteExecution } from './contracts'
import type { PreparedAiInvocation } from './prepared-invocation'
import {
  createAiGatewayRoutePreparer,
  type RoutePreparationProfile,
} from './route-preparer'

/** The OpenAI request a route prepared; another provider's request has its own shape. */
export function openAiRequestOf(
  prepared: Pick<PreparedGatewayRouteExecution, 'invocation'>,
): PreparedAiInvocation['sdkRequest'] {
  return (prepared.invocation as PreparedAiInvocation).sdkRequest
}

/** The v3 profile as a catalogue entry served by OpenAI. */
export function v3TestProfile(): RoutePreparationProfile {
  return operationProfileForCatalogue(
    REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
    REVIEW_ANALYSIS_V3_OPENAI_PAIRING,
  )
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
  options: Readonly<{
    profiles?: readonly RoutePreparationProfile[]
    providers?: Parameters<typeof createAiGatewayRoutePreparer>[0]['providers']
  }> = {},
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
    ...(options.providers === undefined ? {} : { providers: options.providers }),
  })
}

export const fakeSettlementReceipt = () => receipt as never
export const fakeGrant = () => ({}) as never
