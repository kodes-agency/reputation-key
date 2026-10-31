import type { z } from 'zod/v4'
import type {
  AiAdmissionRequestV1,
  AiExecutionGrantV1,
  AiSettlementReceiptV1,
  AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import type {
  AiGatewayRouteRequestV1,
  AiGatewayRouteResponseV1,
} from '#/shared/ai-gateway-transport-contract'
import type { PreparedAiInvocation } from './prepared-invocation'
import type {
  AiProviderId,
  AiProviderOutcome,
  AiProviderUsage,
  PreparedInvocationBase,
} from './provider-contracts'
export type { PreparedAiInvocation } from './prepared-invocation'
export type { ProductAiGatewayRoute } from './provider-contracts'
export {
  OPENAI_MODEL_SNAPSHOT,
  OPENAI_PROMPT_VERSIONS,
  type AiGatewayRoute,
  type ClosedJsonSchemaFormat,
  type ClosedOpenAiRequest,
} from '#/shared/ai-openai-request-contract'

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses' as const
export const OPENAI_USER_AGENT = 'repkey-ai-egress-gateway/1.0' as const
export type GatewayPreparationErrorCode =
  | 'invalid_request'
  | 'text_unavailable'
  | 'language_not_supported'
  | 'redaction_blocked'
  | 'output_invalid'
  | 'policy_unavailable'
  /** The provider the operator chose cannot take a call now. Zero use; try again. */
  | 'provider_unavailable'
  /** The operation was claimed under another provider than the one in force. */
  | 'provider_profile_changed'

export class GatewayPreparationError extends Error {
  constructor(readonly code: GatewayPreparationErrorCode) {
    super(code)
    this.name = 'GatewayPreparationError'
  }
}

export type AiAdmissionClient = Readonly<{
  authorize(
    request: AiAdmissionRequestV1,
    signal: AbortSignal,
  ): Promise<
    | Readonly<{ status: 'authorized'; grant: AiExecutionGrantV1 }>
    | Readonly<{ status: 'denied'; code: string }>
  >
  settle(
    request: AiSettlementRequestV1,
    signal: AbortSignal,
  ): Promise<
    | Readonly<{ status: 'settled'; receipt: AiSettlementReceiptV1 }>
    | Readonly<{ status: 'denied'; code: string }>
  >
  readiness(signal: AbortSignal): Promise<boolean>
}>

/** OpenAI's usage block is the provider-neutral one (`AiProviderUsage`). */
export type OpenAiUsageV1 = AiProviderUsage

/** OpenAI's outcome is the provider-neutral one (`AiProviderOutcome`). */
export type OpenAiConnectorOutcome<T> = AiProviderOutcome<T>

export type OpenAiConnector = Readonly<{
  invoke(
    invocation: PreparedAiInvocation,
    grant: AiExecutionGrantV1,
    outputSchema: z.ZodTypeAny,
    signal: AbortSignal,
  ): Promise<OpenAiConnectorOutcome<unknown>>
  readiness?(): boolean
  close?(): Promise<void> | void
  destroy?(): void
}>

export type AcceptedGatewayResult = Readonly<{
  buildResponse(
    receipt: AiSettlementReceiptV1,
    grant: AiExecutionGrantV1,
  ): AiGatewayRouteResponseV1
}>

export type PreparedGatewayRouteExecution = Readonly<{
  /**
   * The provider whose adapter prepared the invocation, and so the only one the
   * gateway may hand it to. Absent on a v2 route: every v2 route is OpenAI's.
   */
  providerId?: AiProviderId
  // Orchestration reads only the provider-neutral fields; the request itself is
  // the adapter's own (`sdkRequest` has one shape per provider).
  invocation: PreparedInvocationBase
  outputSchema: z.ZodTypeAny
  acceptProviderResult(result: unknown): AcceptedGatewayResult | null
  repairIssues?(): readonly ReplyBodyIssueCode[]
}>

export type AiGatewayRoutePreparer = Readonly<{
  prepare(request: AiGatewayRouteRequestV1): PreparedGatewayRouteExecution
}>

export type GatewayExecutionResult<T> =
  | Readonly<{
      status: 'success'
      result: T
      settlementReceipt: AiSettlementReceiptV1
    }>
  | Readonly<{
      status: 'error'
      code: string
      retryAfterEpochMillis: number | null
    }>

import type { ReplyBodyIssueCode } from '#/shared/domain/reply-body-lint-policy'
