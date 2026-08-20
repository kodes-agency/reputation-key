import type { PropertyId } from '#/shared/domain/ids'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'

export type AiQuotaClaim =
  | Readonly<{
      ok: true
      quotaId: string
      expiresAtEpochMillis: number
      remaining: number
    }>
  | Readonly<{
      ok: false
      code: 'quota_exceeded' | 'cost_exceeded' | 'provider_unavailable'
    }>

export type AiQuotaPort = Readonly<{
  acquire(
    input: Readonly<{
      propertyId: PropertyId
      capability: MerchantAiCapability
      nowEpochMillis: number
    }>,
  ): Promise<AiQuotaClaim>
  release(input: Readonly<{ quotaId: string }>): Promise<void>
}>
