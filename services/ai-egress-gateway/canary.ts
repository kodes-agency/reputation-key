import { timingSafeEqual, type KeyObject } from 'node:crypto'
import { zodTextFormat } from 'openai/helpers/zod'
import { AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA } from '../../src/shared/openai-route-output-schemas'
import {
  aiSettlementRequestSchema,
  verifyAiSettlementReceipt,
  type AiCanaryExecutionBindingV1,
  type AiExecutionGrantV1,
  type AiSettlementReceiptV1,
  type AiSettlementRequestV1,
} from '../../src/shared/ai-internal-transport-contract'
import type { VersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import { AI_OPERATION_PROFILES } from '../../src/shared/ai-operation-profiles'
import { canonicalizeRfc8785 } from '../../src/shared/merchant-ai-notice-contract'
import {
  OPENAI_PROMPT_VERSIONS,
  type AiAdmissionClient,
  type ClosedJsonSchemaFormat,
  type OpenAiConnector,
} from './contracts'
import {
  buildClosedOpenAiRequest,
  createPreparedAiInvocation,
} from './prepared-invocation'
import { deriveCanarySafetyIdentifier } from './safety-identifier'
import { createAiSettlementSignal } from './settlement-signal'
import { enforceOutboundFetchDisposition } from './dispositions'

const CANARY_SOURCE = Object.freeze({ canary: 'repkey_synthetic_canary_v1' })
const canaryOutputSchema = AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA
function resolveCanaryProfile() {
  const resolved = AI_OPERATION_PROFILES.find(
    (candidate) => candidate.sourceRoute === 'synthetic-canary',
  )
  if (!resolved) throw new Error('Synthetic canary operation profile is unavailable')
  return resolved
}
const profile = resolveCanaryProfile()

function constantEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  const result =
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  leftBytes.fill(0)
  rightBytes.fill(0)
  return result
}

function receiptMatches(
  receipt: AiSettlementReceiptV1,
  grant: AiExecutionGrantV1,
  request: AiSettlementRequestV1,
  publicKeys: ReadonlyMap<string, KeyObject>,
): boolean {
  const expectedState =
    receipt.disposition === 'no_dispatch'
      ? 'released'
      : receipt.disposition === 'transport_ambiguous'
        ? 'ambiguous'
        : 'settled'
  const expectedCost =
    request.disposition === 'no_dispatch'
      ? 0n
      : request.usageKnown
        ? (BigInt(request.inputTokens - request.cachedInputTokens) * 750_000n +
            BigInt(request.cachedInputTokens) * 75_000n +
            BigInt(request.outputTokens) * 4_500_000n +
            999_999n) /
          1_000_000n
        : BigInt(grant.limits.costMicros)
  const acceptedDisposition =
    receipt.disposition === request.disposition || receipt.disposition === 'policy_denied'
  return (
    verifyAiSettlementReceipt(receipt, publicKeys) &&
    receipt.grantKid === grant.grantKid &&
    receipt.operationId === grant.operationId &&
    receipt.permitId === grant.permitId &&
    receipt.attemptNumber === grant.attemptNumber &&
    receipt.nonce === grant.nonce &&
    constantEqual(receipt.requestBindingHmac, grant.requestBindingHmac) &&
    receipt.reportedDisposition === request.reportedDisposition &&
    acceptedDisposition &&
    receipt.providerRetryable ===
      (receipt.disposition === request.disposition ? request.providerRetryable : false) &&
    receipt.usageKnown === request.usageKnown &&
    receipt.inputTokens === request.inputTokens &&
    receipt.cachedInputTokens === request.cachedInputTokens &&
    receipt.outputTokens === request.outputTokens &&
    receipt.reasoningTokens === request.reasoningTokens &&
    expectedCost <= BigInt(Number.MAX_SAFE_INTEGER) &&
    receipt.costMicros === Number(expectedCost) &&
    receipt.settlementState === expectedState
  )
}

export type AiCanaryClaimV1 = Readonly<{
  operationId: string
  permitId: string
  attemptNumber: number
  deadlineEpochMillis: number
  binding: AiCanaryExecutionBindingV1
}>

export type AiCanaryRunResult = Readonly<{
  status: 'passed' | 'failed'
  disposition: string
}>

export function createAiOneShotCanary(
  dependencies: Readonly<{
    admission: AiAdmissionClient
    connector: OpenAiConnector
    requestBindingKeys: VersionedHmacKeyring
    admissionPublicKeys: ReadonlyMap<string, KeyObject>
    releaseSha: string
    now?: () => number
  }>,
): Readonly<{
  run(claim: AiCanaryClaimV1, signal: AbortSignal): Promise<AiCanaryRunResult>
}> {
  const now = dependencies.now ?? Date.now
  return Object.freeze({
    run: async (claim, signal) => {
      if (
        claim.attemptNumber !== 1 ||
        claim.binding.operationProfileVersion !== profile.profileVersion ||
        claim.binding.providerDeploymentProfileVersion !==
          profile.providerDeploymentProfileVersion ||
        claim.binding.safetyIdentifierProfileVersion !== 'synthetic-canary-safety-v1' ||
        !constantEqual(claim.binding.releaseSha, dependencies.releaseSha)
      )
        return { status: 'failed', disposition: 'policy_denied' }
      const format = JSON.parse(
        JSON.stringify(zodTextFormat(canaryOutputSchema, profile.outputSchemaName)),
      ) as ClosedJsonSchemaFormat
      const sdkRequest = buildClosedOpenAiRequest({
        route: 'synthetic-canary',
        promptVersion: OPENAI_PROMPT_VERSIONS['synthetic-canary'],
        promptCacheShard: 0,
        developerMessage: profile.developerPrompt,
        untrustedData: canonicalizeRfc8785(CANARY_SOURCE),
        format,
        maxOutputTokens: profile.maxOutputTokens,
        safetyIdentifier: deriveCanarySafetyIdentifier(),
      })
      const sourceBytes = Buffer.from(
        `\u0003${canonicalizeRfc8785(CANARY_SOURCE)}`,
        'utf8',
      )
      let invocation
      try {
        invocation = createPreparedAiInvocation({
          sourceBytes,
          providerPayload: CANARY_SOURCE,
          sdkRequest,
          requestBindingKeys: dependencies.requestBindingKeys,
          createDescriptor: (facts) => ({
            version: 'ai-admission-descriptor-v1',
            subjectKind: 'synthetic_canary',
            route: 'synthetic-canary',
            operationId: claim.operationId,
            permitId: claim.permitId,
            attemptNumber: claim.attemptNumber,
            organizationId: null,
            propertyId: null,
            internalSubjectId: null,
            actorId: null,
            binding: null,
            canaryBinding: claim.binding,
            releaseSha: claim.binding.releaseSha,
            canaryAuthorizationId: claim.binding.canaryAuthorizationId,
            ...facts,
            limits: {
              sourceBytes: profile.sourceByteLimit,
              providerPayloadBytes: profile.providerPayloadByteLimit,
              preparedRequestBytes: profile.preparedRequestByteLimit,
              responseBytes: profile.responseByteLimit,
              outputTokens: profile.maxOutputTokens,
              costMicros: 100_000,
            },
            callerDeadlineEpochMillis: claim.deadlineEpochMillis,
            observedContentExpiresAtEpochMillis: null,
            redactionCountry: null,
            redactionProfileVersion: null,
            outputLeakageProfileVersion: null,
            outputLeakageProfileDigest: null,
            replyTemplateCatalogueVersion: null,
            replyTemplateCatalogueDigest: null,
          }),
        })
      } finally {
        sourceBytes.fill(0)
      }
      let authorization
      try {
        authorization = await dependencies.admission.authorize(
          {
            descriptor: invocation.descriptor,
            requestBindingKeyId: invocation.requestBindingKeyId,
            requestBindingHmac: invocation.requestBindingHmac,
          },
          signal,
        )
      } catch (error) {
        invocation.canonicalProviderBytes.fill(0)
        throw error
      }
      if (authorization.status !== 'authorized') {
        invocation.canonicalProviderBytes.fill(0)
        return { status: 'failed', disposition: 'policy_denied' }
      }
      const grant = authorization.grant
      let outcome
      if (
        signal.aborted ||
        grant.expiresAtEpochMillis - now() < profile.providerDeadlineMs + 5_000
      ) {
        invocation.canonicalProviderBytes.fill(0)
        outcome = {
          disposition: 'no_dispatch' as const,
          reportedDisposition: 'no_dispatch' as const,
          result: null,
          usageKnown: false,
          providerRetryable: false,
          usage: {
            inputTokens: 0,
            cachedTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
          },
          retryAfterSeconds: null,
          outboundFetchUsed: false,
        }
      } else {
        const providerController = new AbortController()
        const abortFromCaller = () => providerController.abort('caller_aborted')
        signal.addEventListener('abort', abortFromCaller, { once: true })
        if (signal.aborted) abortFromCaller()
        const providerTimer = setTimeout(
          () => providerController.abort('provider_deadline'),
          profile.providerDeadlineMs,
        )
        try {
          outcome = await dependencies.connector.invoke(
            invocation,
            grant,
            canaryOutputSchema,
            providerController.signal,
          )
        } finally {
          clearTimeout(providerTimer)
          signal.removeEventListener('abort', abortFromCaller)
        }
      }
      outcome = enforceOutboundFetchDisposition(outcome)
      const settlementRequest = aiSettlementRequestSchema.parse({
        operationId: grant.operationId,
        permitId: grant.permitId,
        attemptNumber: grant.attemptNumber,
        nonce: grant.nonce,
        disposition: outcome.disposition,
        reportedDisposition: outcome.reportedDisposition,
        providerRetryable: outcome.providerRetryable,
        usageKnown: outcome.usageKnown,
        inputTokens: outcome.usage.inputTokens,
        cachedInputTokens: outcome.usage.cachedTokens,
        outputTokens: outcome.usage.outputTokens,
        reasoningTokens: outcome.usage.reasoningTokens,
        retryAfterSeconds: outcome.retryAfterSeconds,
      })
      const settlementSignal = createAiSettlementSignal()
      let settlement: Awaited<ReturnType<AiAdmissionClient['settle']>>
      try {
        settlement = await dependencies.admission.settle(
          settlementRequest,
          settlementSignal.signal,
        )
      } finally {
        settlementSignal.dispose()
      }
      if (
        settlement.status !== 'settled' ||
        !receiptMatches(
          settlement.receipt,
          grant,
          settlementRequest,
          dependencies.admissionPublicKeys,
        )
      )
        return { status: 'failed', disposition: 'transport_ambiguous' }
      const releaseNow = now()
      return settlement.receipt.disposition === 'success' &&
        outcome.result !== null &&
        !signal.aborted &&
        releaseNow < claim.deadlineEpochMillis &&
        settlement.receipt.settledAtEpochMillis < grant.expiresAtEpochMillis &&
        canaryOutputSchema.safeParse(outcome.result).success
        ? { status: 'passed', disposition: 'success' }
        : { status: 'failed', disposition: settlement.receipt.disposition }
    },
  })
}
