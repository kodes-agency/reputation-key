import type { z } from 'zod'
import type {
  AiAdmissionRequestV1,
  AiExecutionGrantV1,
  AiSettlementReceiptV1,
  AiSettlementRequestV1,
} from '../../src/shared/ai-internal-transport-contract'
import type {
  AiGatewayRouteRequestV1,
  AiGatewayRouteResponseV1,
} from '../../src/shared/ai-gateway-transport-contract'
import type { AiGatewayRoute } from '../../src/shared/ai-openai-request-contract'
import type { PreparedAiInvocation } from './prepared-invocation'
export type { PreparedAiInvocation } from './prepared-invocation'
export {
  OPENAI_KNOWN_MODEL_SNAPSHOTS,
  OPENAI_MODEL_SNAPSHOT,
  OPENAI_PROMPT_VERSIONS,
  type AiGatewayRoute,
  type ClosedJsonSchemaFormat,
  type ClosedOpenAiRequest,
} from '../../src/shared/ai-openai-request-contract'

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses' as const
export const OPENAI_USER_AGENT = 'repkey-ai-egress-gateway/1.0' as const
export type GatewayPreparationErrorCode =
  | 'invalid_request'
  | 'text_unavailable'
  | 'language_not_supported'
  | 'redaction_blocked'
  | 'output_invalid'
  | 'policy_unavailable'

export class GatewayPreparationError extends Error {
  constructor(readonly code: GatewayPreparationErrorCode) {
    super(code)
    this.name = 'GatewayPreparationError'
  }
}

export type ProductAiGatewayRoute = Exclude<AiGatewayRoute, 'synthetic-canary'>

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

export type OpenAiUsageV1 = Readonly<{
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}>

export type OpenAiConnectorOutcome<T> = Readonly<{
  disposition: AiSettlementRequestV1['disposition']
  reportedDisposition: AiSettlementRequestV1['reportedDisposition']
  result: T | null
  usageKnown: boolean
  providerRetryable: boolean
  usage: OpenAiUsageV1
  retryAfterSeconds: number | null
  outboundFetchUsed: boolean
}>

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
  invocation: PreparedAiInvocation
  outputSchema: z.ZodTypeAny
  acceptProviderResult(result: unknown): AcceptedGatewayResult | null
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
