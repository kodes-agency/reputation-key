import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import type { AiOperationId } from '../../domain/types'

export type AiQuotaClaim = Readonly<{
  quotaClaimId: string
  operationId: AiOperationId
  capability: MerchantAiCapability
  expiresAtEpochMillis: number
}>

export type AiRuntimePort = Readonly<{
  nowEpochMillis(): number
  randomUuid(): string

  claimQuota(
    input: Readonly<{
      operationId: AiOperationId
      capability: MerchantAiCapability
      providerDeploymentProfileVersion: string
      nowEpochMillis: number
    }>,
  ): Promise<AiQuotaClaim | null>

  releaseQuota(claim: AiQuotaClaim): Promise<void>

  report(
    input: Readonly<{
      operationId: AiOperationId
      capability: MerchantAiCapability | null
      outcome: 'admitted' | 'completed' | 'failed' | 'cancelled' | 'delivery_failed'
      code: string | null
      occurredAtEpochMillis: number
    }>,
  ): Promise<void>
}>
