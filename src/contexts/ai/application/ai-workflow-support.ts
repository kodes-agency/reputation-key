import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import { AI_REVIEW_SOURCE_CONTRACT_VERSION } from '#/shared/ai-review-source-contract'
import type { AiControlPort } from './ports/ai-control.port'
import type { AiExecutionStopFence } from '../domain/types'

export function aiRequestFingerprint(value: unknown): string {
  return createHash('sha256')
    .update('repkey-ai-product-request-v1\0', 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

export function aiReviewSourceProvenance(
  canonicalBytes: Uint8Array,
): Readonly<{ digest: string; byteCount: number }> {
  return Object.freeze({
    digest: createHash('sha256')
      .update(`${AI_REVIEW_SOURCE_CONTRACT_VERSION}\0`, 'utf8')
      .update(canonicalBytes)
      .digest('hex'),
    byteCount: canonicalBytes.byteLength,
  })
}

export async function resolveAiExecutionStopFence(
  control: AiControlPort,
  input: Readonly<{
    providerDeploymentProfileVersion: string
    capability: MerchantAiCapability
  }>,
): Promise<AiExecutionStopFence | null> {
  const heads = await control.readHeads(input)
  if (heads.length !== 3) return null
  const global = heads.find((head) => head.scope.kind === 'global')
  const provider = heads.find(
    (head) =>
      head.scope.kind === 'provider_deployment_profile' &&
      head.scope.providerDeploymentProfileVersion ===
        input.providerDeploymentProfileVersion,
  )
  const capability = heads.find(
    (head) =>
      head.scope.kind === 'capability' && head.scope.capability === input.capability,
  )
  if (
    !global ||
    !provider ||
    !capability ||
    [global, provider, capability].some(
      (head) => head.executionState !== 'enabled' || head.admissionState !== 'accepting',
    )
  ) {
    return null
  }
  return {
    globalControlId: global.controlId,
    globalGeneration: global.generation,
    providerControlId: provider.controlId,
    providerGeneration: provider.generation,
    capabilityControlId: capability.controlId,
    capabilityGeneration: capability.generation,
  }
}

/**
 * Provider answers that describe the provider's capacity, not this request:
 * retrying the same review later is expected to succeed. They never spend the
 * request's attempt budget; the operation horizon bounds them instead. Every
 * other failure (refused, invalid output, timeout) may be the review's own and
 * stays budgeted.
 */
export const AI_PROVIDER_CAPACITY_CODES: ReadonlySet<string> = new Set([
  'provider_rate_limited',
  'provider_unavailable',
])

export const AI_PROVIDER_ATTEMPT_BUDGET = 4

export function aiRetryAt(
  attempt: number,
  nowEpochMillis: number,
  retryAfterEpochMillis: number | null,
  exhaustible = true,
): number | null {
  if (exhaustible && attempt >= AI_PROVIDER_ATTEMPT_BUDGET) return null
  const exponential = nowEpochMillis + Math.min(30_000, 1_000 * 2 ** (attempt - 1))
  return retryAfterEpochMillis === null
    ? exponential
    : Math.max(exponential, retryAfterEpochMillis)
}
