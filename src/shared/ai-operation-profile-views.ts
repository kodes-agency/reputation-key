import {
  defineLogicalOperationProfile,
  type LogicalOperationProfile,
} from './ai-logical-operation-profile'
import {
  SDK_ATTESTATION,
  defineOperationProfile,
  type AiOperationProfile,
} from './ai-operation-profile-core'
import type { AiOperationProviderPairing } from './ai-provider-attestations'

// The two directions between an operation profile as the catalogue holds it today
// (one object that hashes OpenAI's request shape beside the prompt) and the split
// form (a logical profile and a provider's pairing with it). They exist so the
// split is demonstrably lossless: every profile in force survives the round trip
// with every digest intact (`ai-operation-profile-views.test.ts`), and a profile
// that is only logical, like the dark v3 one, can enter the catalogue as the same
// kind of object without a second, hand-written set of OpenAI fields.

/**
 * A catalogue entry seen without its provider: its artifacts minus the `sdk` entry
 * (OpenAI's request shape, which belongs to OpenAI's attestation) and its limits.
 * Nothing about the entry changes; this reads it.
 */
export function logicalOperationProfileOf(
  profile: AiOperationProfile,
): LogicalOperationProfile {
  const { sdk: _sdk, ...logicalArtifacts } = profile.artifactAttestations
  return defineLogicalOperationProfile({
    profileVersion: profile.profileVersion,
    command: profile.command,
    capability: profile.capability,
    purpose: profile.purpose,
    sourceRoute: profile.sourceRoute,
    gatewayPath: profile.gatewayPath,
    callerRole: profile.callerRole,
    capabilityRuntimeProfileVersion: profile.capabilityRuntimeProfileVersion,
    providerDeploymentProfileVersion: profile.providerDeploymentProfileVersion,
    outputSchemaName: profile.outputSchemaName,
    outputSchema: profile.outputSchema,
    developerPrompt: profile.developerPrompt,
    logicalArtifacts,
    limits: {
      sourceByteLimit: profile.sourceByteLimit,
      providerPayloadByteLimit: profile.providerPayloadByteLimit,
      preparedRequestByteLimit: profile.preparedRequestByteLimit,
      responseByteLimit: profile.responseByteLimit,
      maxOutputTokens: profile.maxOutputTokens,
      reasoningEffort: profile.reasoningEffort,
      providerDeadlineMs: profile.providerDeadlineMs,
      requestDeadlineMs: profile.requestDeadlineMs,
      executionLeaseMs: profile.executionLeaseMs,
    },
  })
}

/**
 * The catalogue entry for a logical profile served by OpenAI: the logical fields,
 * the SDK attestation, and the static token material the pairing reserves. The
 * reservation figures are recomputed by the entry's own builder and must agree with
 * the pairing, so a pairing that was made for another prompt or schema is refused
 * rather than priced wrongly.
 */
export function operationProfileForCatalogue(
  logical: LogicalOperationProfile,
  pairing: AiOperationProviderPairing,
): AiOperationProfile {
  if (
    pairing.providerId !== 'openai' ||
    pairing.logicalDigest !== logical.logicalDigest
  ) {
    throw new TypeError('the pairing is not this profile served by OpenAI')
  }
  const profile = defineOperationProfile({
    profileVersion: logical.profileVersion as AiOperationProfile['profileVersion'],
    command: logical.command,
    capability: logical.capability,
    purpose: logical.purpose,
    sourceRoute: logical.sourceRoute,
    gatewayPath: logical.gatewayPath,
    callerRole: logical.callerRole,
    capabilityRuntimeProfileVersion: logical.capabilityRuntimeProfileVersion,
    providerDeploymentProfileVersion:
      logical.providerDeploymentProfileVersion as AiOperationProfile['providerDeploymentProfileVersion'],
    outputSchemaName: logical.outputSchemaName,
    outputSchema: logical.outputSchema,
    developerPrompt: logical.developerPrompt,
    artifactAttestations: Object.freeze({
      ...logical.logicalArtifacts,
      sdk: SDK_ATTESTATION,
    }),
    ...logical.limits,
  })
  if (
    profile.staticTokenBearingBytes !== pairing.staticTokenBearing.bytes ||
    profile.staticTokenBearingDigest !== pairing.staticTokenBearing.digest
  ) {
    throw new TypeError('the pairing reserves tokens this profile does not send')
  }
  return profile
}
