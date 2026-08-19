import { timingSafeEqual, type KeyObject } from 'node:crypto'
import {
  aiSettlementRequestSchema,
  verifyAiExecutionGrant,
  verifyAiSettlementReceipt,
  type AiExecutionGrantV1,
  type AiSettlementReceiptV1,
  type AiSettlementRequestV1,
} from '../../src/shared/ai-internal-transport-contract'
import {
  parseAiGatewayRouteResponse,
  type AiGatewayRouteRequestV1,
  type AiGatewayRouteResponseV1,
} from '../../src/shared/ai-gateway-transport-contract'
import { canonicalizeRfc8785 } from '../../src/shared/merchant-ai-notice-contract'
import type { SensitiveSourceLease } from './source-lease'
import { GatewayPreparationError } from './contracts'
import type {
  AiAdmissionClient,
  AiGatewayRoutePreparer,
  OpenAiConnector,
  OpenAiConnectorOutcome,
} from './contracts'
import { createAiSettlementSignal } from './settlement-signal'
import { enforceOutboundFetchDisposition } from './dispositions'

type AiGatewayErrorCode = Extract<AiGatewayRouteResponseV1, { status: 'error' }>['code']

const ZERO_USAGE = Object.freeze({
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
})

export function isGatewayOuterDeadlineValid(
  route: AiGatewayRouteRequestV1['route'],
  deadlineEpochMillis: number,
  nowEpochMillis: number,
): boolean {
  const horizonMillis = route === 'property-trend' ? 100_000 : 70_000
  return (
    Number.isSafeInteger(deadlineEpochMillis) &&
    Number.isSafeInteger(nowEpochMillis) &&
    deadlineEpochMillis > nowEpochMillis &&
    deadlineEpochMillis - nowEpochMillis <= horizonMillis
  )
}

function constantEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  const equal =
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  leftBytes.fill(0)
  rightBytes.fill(0)
  return equal
}

function requestMatchesDescriptor(
  request: AiGatewayRouteRequestV1,
  descriptor: ReturnType<AiGatewayRoutePreparer['prepare']>['invocation']['descriptor'],
): boolean {
  if (
    descriptor.subjectKind !== 'property' ||
    descriptor.route !== request.route ||
    descriptor.operationId !== request.operationId ||
    descriptor.permitId !== request.permitId ||
    descriptor.attemptNumber !== request.attemptNumber ||
    descriptor.organizationId !== request.organizationId ||
    descriptor.propertyId !== request.propertyId ||
    descriptor.internalSubjectId !== request.internalSubjectId ||
    descriptor.callerDeadlineEpochMillis !== request.deadlineEpochMillis ||
    !constantEqual(
      canonicalizeRfc8785(descriptor.binding),
      canonicalizeRfc8785(request.binding),
    )
  )
    return false
  if (request.route === 'property-trend') {
    return (
      descriptor.actorId === null &&
      descriptor.observedContentExpiresAtEpochMillis === null &&
      descriptor.redactionCountry === null
    )
  }
  return (
    descriptor.observedContentExpiresAtEpochMillis ===
      request.observedContentExpiresAtEpochMillis &&
    descriptor.redactionCountry === request.redactionCountry &&
    descriptor.actorId === request.actorId
  )
}

function grantMatchesInvocation(
  grant: AiExecutionGrantV1,
  invocation: ReturnType<AiGatewayRoutePreparer['prepare']>['invocation'],
  publicKeys: ReadonlyMap<string, KeyObject>,
  nowEpochMillis: number,
): boolean {
  const descriptor = invocation.descriptor
  const replyRoute = descriptor.route === 'reply-suggestion'
  return (
    verifyAiExecutionGrant(grant, publicKeys) &&
    grant.subjectKind === descriptor.subjectKind &&
    grant.requestBindingKeyId === invocation.requestBindingKeyId &&
    constantEqual(grant.requestBindingHmac, invocation.requestBindingHmac) &&
    grant.route === descriptor.route &&
    grant.operationId === descriptor.operationId &&
    grant.permitId === descriptor.permitId &&
    grant.attemptNumber === descriptor.attemptNumber &&
    constantEqual(
      canonicalizeRfc8785(grant.limits),
      canonicalizeRfc8785(descriptor.limits),
    ) &&
    grant.callerDeadlineEpochMillis === descriptor.callerDeadlineEpochMillis &&
    grant.expiresAtEpochMillis === descriptor.callerDeadlineEpochMillis &&
    grant.issuedAtEpochMillis <= nowEpochMillis &&
    grant.issuedAtEpochMillis < grant.expiresAtEpochMillis &&
    grant.expiresAtEpochMillis > nowEpochMillis &&
    (replyRoute
      ? grant.replyTokenExpiresAtEpochMillis !== null &&
        grant.replyDraftExpiresAtEpochMillis !== null &&
        grant.replyTokenExpiresAtEpochMillis > nowEpochMillis &&
        grant.replyDraftExpiresAtEpochMillis > nowEpochMillis &&
        grant.replyTokenExpiresAtEpochMillis <= grant.replyDraftExpiresAtEpochMillis
      : grant.replyTokenExpiresAtEpochMillis === null &&
        grant.replyDraftExpiresAtEpochMillis === null)
  )
}

function denialCode(code: string): AiGatewayErrorCode {
  switch (code) {
    case 'subject_mismatch':
      return 'forbidden'
    case 'source_mismatch':
      return 'source_revision_changed'
    case 'authorization_changed':
      return 'capability_epoch_changed'
    case 'control_disabled':
    case 'circuit_open':
      return 'execution_suspended'
    case 'rate_limited':
      return 'provider_rate_limited'
    case 'concurrency_exhausted':
    case 'quota_exhausted':
      return 'quota_exhausted'
    case 'already_consumed':
      return 'operation_ambiguous'
    case 'permit_expired':
      return 'provider_unavailable'
    default:
      return 'policy_unavailable'
  }
}
function dispositionCode(
  disposition: AiSettlementReceiptV1['disposition'],
): AiGatewayErrorCode {
  switch (disposition) {
    case 'provider_refused':
      return 'provider_refused'
    case 'output_invalid':
      return 'output_invalid'
    case 'rate_limited':
      return 'provider_rate_limited'
    case 'transport_ambiguous':
      return 'operation_ambiguous'
    case 'policy_denied':
      return 'execution_suspended'
    case 'source_stale':
      return 'source_revision_changed'
    default:
      return 'provider_unavailable'
  }
}

function expectedSettlementCostMicros(
  request: AiSettlementRequestV1,
  grant: AiExecutionGrantV1,
): number | null {
  if (request.disposition === 'no_dispatch') return 0
  if (!request.usageKnown) return grant.limits.costMicros
  const numerator =
    BigInt(request.inputTokens - request.cachedInputTokens) * 750_000n +
    BigInt(request.cachedInputTokens) * 75_000n +
    BigInt(request.outputTokens) * 4_500_000n
  const value = (numerator + 999_999n) / 1_000_000n
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
}

function errorResponse(
  route: AiGatewayRouteRequestV1['route'],
  code: AiGatewayErrorCode,
  retryAfterEpochMillis: number | null = null,
): AiGatewayRouteResponseV1 {
  return parseAiGatewayRouteResponse({
    route,
    status: 'error',
    code,
    retryAfterEpochMillis,
  })
}

function settlementRequest(
  grant: AiExecutionGrantV1,
  outcome: OpenAiConnectorOutcome<unknown>,
): AiSettlementRequestV1 {
  return aiSettlementRequestSchema.parse({
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
}

function receiptMatches(
  receipt: AiSettlementReceiptV1,
  grant: AiExecutionGrantV1,
  request: AiSettlementRequestV1,
  publicKeys: ReadonlyMap<string, KeyObject>,
): boolean {
  const finalDispositionAccepted =
    receipt.disposition === request.disposition ||
    receipt.disposition === 'source_stale' ||
    receipt.disposition === 'policy_denied'
  const expectedState =
    receipt.disposition === 'no_dispatch'
      ? 'released'
      : receipt.disposition === 'transport_ambiguous'
        ? 'ambiguous'
        : 'settled'
  const expectedCost = expectedSettlementCostMicros(request, grant)
  return (
    verifyAiSettlementReceipt(receipt, publicKeys) &&
    receipt.grantKid === grant.grantKid &&
    receipt.operationId === request.operationId &&
    receipt.permitId === request.permitId &&
    receipt.attemptNumber === request.attemptNumber &&
    receipt.nonce === request.nonce &&
    constantEqual(receipt.requestBindingHmac, grant.requestBindingHmac) &&
    finalDispositionAccepted &&
    receipt.reportedDisposition === request.reportedDisposition &&
    receipt.providerRetryable ===
      (receipt.disposition === request.disposition ? request.providerRetryable : false) &&
    receipt.usageKnown === request.usageKnown &&
    receipt.inputTokens === request.inputTokens &&
    receipt.cachedInputTokens === request.cachedInputTokens &&
    receipt.outputTokens === request.outputTokens &&
    receipt.reasoningTokens === request.reasoningTokens &&
    expectedCost !== null &&
    receipt.costMicros === expectedCost &&
    receipt.settlementState === expectedState
  )
}

function withDeadline(
  signal: AbortSignal,
  deadlineEpochMillis: number,
  now: () => number,
  timerReason: 'outer_deadline' | 'provider_deadline' = 'outer_deadline',
): Readonly<{ signal: AbortSignal; dispose(): void }> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort('caller_aborted')
  signal.addEventListener('abort', abortFromCaller, { once: true })
  if (signal.aborted) abortFromCaller()
  const remaining = deadlineEpochMillis - now()
  const timer = setTimeout(() => controller.abort(timerReason), Math.max(0, remaining))
  return Object.freeze({
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abortFromCaller)
    },
  })
}

export type AiEgressGatewayService = Readonly<{
  execute(
    lease: SensitiveSourceLease<AiGatewayRouteRequestV1>,
    signal: AbortSignal,
  ): Promise<AiGatewayRouteResponseV1>
  readiness(signal: AbortSignal): Promise<boolean>
}>

export function createAiEgressGatewayService(
  dependencies: Readonly<{
    admission: AiAdmissionClient
    connector: OpenAiConnector
    preparer: AiGatewayRoutePreparer
    admissionPublicKeys: ReadonlyMap<string, KeyObject>
    now?: () => number
  }>,
): AiEgressGatewayService {
  const now = dependencies.now ?? Date.now
  return Object.freeze({
    execute: async (lease, signal) => {
      let attemptedRoute: string = 'review-analysis'
      let preparedEnvelope: Readonly<{
        request: AiGatewayRouteRequestV1
        prepared: ReturnType<AiGatewayRoutePreparer['prepare']>
        descriptorMatches: boolean
      }>
      try {
        preparedEnvelope = lease.read((request) => {
          attemptedRoute = request.route
          const prepared = dependencies.preparer.prepare(request)
          return {
            request,
            prepared,
            descriptorMatches: requestMatchesDescriptor(
              request,
              prepared.invocation.descriptor,
            ),
          }
        })
      } catch (error) {
        lease.dispose()
        const failedRoute: AiGatewayRouteRequestV1['route'] =
          attemptedRoute === 'reply-suggestion' || attemptedRoute === 'property-trend'
            ? attemptedRoute
            : 'review-analysis'
        return errorResponse(
          failedRoute,
          error instanceof GatewayPreparationError ? error.code : 'invalid_request',
        )
      } finally {
        lease.dispose()
      }
      const { request, prepared, descriptorMatches } = preparedEnvelope
      const route = request.route
      const outerDeadlineEpochMillis = request.deadlineEpochMillis
      if (!descriptorMatches) {
        prepared.invocation.canonicalProviderBytes.fill(0)
        return errorResponse(route, 'policy_unavailable')
      }
      const gatewayNow = now()
      if (!isGatewayOuterDeadlineValid(route, outerDeadlineEpochMillis, gatewayNow)) {
        prepared.invocation.canonicalProviderBytes.fill(0)
        return errorResponse(route, 'invalid_request')
      }
      const deadline = withDeadline(signal, outerDeadlineEpochMillis, now)
      let authorizationInvoked = false
      let successSettled = false
      try {
        authorizationInvoked = true
        const authorization = await dependencies.admission.authorize(
          {
            descriptor: prepared.invocation.descriptor,
            requestBindingKeyId: prepared.invocation.requestBindingKeyId,
            requestBindingHmac: prepared.invocation.requestBindingHmac,
          },
          deadline.signal,
        )
        if (authorization.status === 'denied') {
          prepared.invocation.canonicalProviderBytes.fill(0)
          return errorResponse(route, denialCode(authorization.code))
        }
        const grant = authorization.grant
        if (
          !grantMatchesInvocation(
            grant,
            prepared.invocation,
            dependencies.admissionPublicKeys,
            now(),
          )
        ) {
          prepared.invocation.canonicalProviderBytes.fill(0)
          return errorResponse(route, 'operation_ambiguous')
        }
        const providerDeadlineMillis = route === 'property-trend' ? 90_000 : 60_000
        const providerAndSettlementMillis = providerDeadlineMillis + 5_000
        let outcome: OpenAiConnectorOutcome<unknown>
        // This branch skips the connector entirely, so the connector's own
        // `gateway_no_dispatch` diagnostic never fires for it. Both conditions were
        // silent, which made a real closed-beta failure undiagnosable: the caller
        // sees only `operation_ambiguous`. Report the numbers behind the decision.
        const grantTtlMillis = grant.expiresAtEpochMillis - now()
        const deadlineAborted = deadline.signal.aborted
        if (grantTtlMillis < providerAndSettlementMillis || deadlineAborted) {
          process.stderr.write(
            `${JSON.stringify({
              event: 'gateway_no_dispatch',
              stage: 'pre_connector',
              route,
              operationId: prepared.invocation.descriptor.operationId,
              permitId: prepared.invocation.descriptor.permitId,
              attempt: prepared.invocation.descriptor.attemptNumber,
              grantTtlMillis,
              requiredTtlMillis: providerAndSettlementMillis,
              deadlineAborted,
              reason: deadlineAborted ? 'caller_deadline_aborted' : 'grant_ttl_too_short',
            })}\n`,
          )
          prepared.invocation.canonicalProviderBytes.fill(0)
          outcome = {
            disposition: 'no_dispatch',
            reportedDisposition: 'no_dispatch',
            result: null,
            usageKnown: false,
            providerRetryable: false,
            usage: ZERO_USAGE,
            retryAfterSeconds: null,
            outboundFetchUsed: false,
          }
        } else {
          const providerDeadline = withDeadline(
            deadline.signal,
            now() + providerDeadlineMillis,
            now,
            'provider_deadline',
          )
          try {
            outcome = await dependencies.connector.invoke(
              prepared.invocation,
              grant,
              prepared.outputSchema,
              providerDeadline.signal,
            )
          } catch {
            outcome = {
              disposition: 'transport_ambiguous',
              reportedDisposition: 'transport_ambiguous',
              result: null,
              usageKnown: false,
              providerRetryable: false,
              usage: ZERO_USAGE,
              retryAfterSeconds: null,
              outboundFetchUsed: true,
            }
          } finally {
            providerDeadline.dispose()
          }
        }
        outcome = enforceOutboundFetchDisposition(outcome)
        let accepted = null
        if (outcome.disposition === 'success' && outcome.result !== null) {
          try {
            accepted = prepared.acceptProviderResult(outcome.result)
          } catch {
            accepted = null
          }
          if (accepted === null) {
            outcome = { ...outcome, disposition: 'output_invalid', result: null }
          }
        }
        const settleRequest = settlementRequest(grant, outcome)
        const settlementDeadline = createAiSettlementSignal(
          Math.max(0, outerDeadlineEpochMillis - now()),
        )
        let settlement: Awaited<ReturnType<AiAdmissionClient['settle']>>
        try {
          settlement = await dependencies.admission.settle(
            settleRequest,
            settlementDeadline.signal,
          )
        } finally {
          settlementDeadline.dispose()
        }
        if (
          settlement.status !== 'settled' ||
          !receiptMatches(
            settlement.receipt,
            grant,
            settleRequest,
            dependencies.admissionPublicKeys,
          )
        ) {
          return errorResponse(route, 'operation_ambiguous')
        }
        const releaseNow = now()
        successSettled = settlement.receipt.disposition === 'success' && accepted !== null
        if (
          signal.aborted ||
          releaseNow >= outerDeadlineEpochMillis ||
          settlement.receipt.settledAtEpochMillis >= grant.expiresAtEpochMillis ||
          (route === 'reply-suggestion' &&
            (grant.replyTokenExpiresAtEpochMillis === null ||
              grant.replyTokenExpiresAtEpochMillis <= releaseNow))
        ) {
          return errorResponse(
            route,
            successSettled ? 'completed_without_delivery' : 'operation_ambiguous',
          )
        }
        if (settlement.receipt.disposition !== 'success' || accepted === null) {
          const retryAfter =
            settlement.receipt.providerRetryable &&
            outcome.retryAfterSeconds !== null &&
            settlement.receipt.disposition === outcome.disposition
              ? Math.min(
                  Number.MAX_SAFE_INTEGER,
                  settlement.receipt.settledAtEpochMillis +
                    outcome.retryAfterSeconds * 1_000,
                )
              : null
          return errorResponse(
            route,
            dispositionCode(settlement.receipt.disposition),
            retryAfter,
          )
        }
        const response = parseAiGatewayRouteResponse(
          accepted.buildResponse(settlement.receipt, grant),
        )
        if (
          response.route !== route ||
          response.status !== 'success' ||
          !constantEqual(
            canonicalizeRfc8785(response.settlementReceipt),
            canonicalizeRfc8785(settlement.receipt),
          )
        ) {
          return errorResponse(route, 'completed_without_delivery')
        }
        return response
      } catch {
        prepared.invocation.canonicalProviderBytes.fill(0)
        return errorResponse(
          route,
          successSettled
            ? 'completed_without_delivery'
            : authorizationInvoked
              ? 'operation_ambiguous'
              : 'policy_unavailable',
        )
      } finally {
        deadline.dispose()
      }
    },
    readiness: async (signal) => {
      if (signal.aborted || dependencies.connector.readiness?.() === false) return false
      return dependencies.admission.readiness(signal)
    },
  })
}
