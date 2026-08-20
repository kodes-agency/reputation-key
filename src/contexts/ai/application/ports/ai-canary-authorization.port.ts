import type { AiCanaryExecutionBindingV1 } from '#/shared/ai-internal-transport-contract'

export type AiCanaryClaimV1 = Readonly<{
  operationId: string
  permitId: string
  attemptNumber: 1
  releaseSha: string
  deadlineEpochMillis: number
  binding: AiCanaryExecutionBindingV1
}>

export type AiCanaryIssueExpectation = Readonly<{
  headGeneration: number
  stopFence: AiCanaryExecutionBindingV1['stopFence']
}>

export type AiCanaryAuthorizationPort = Readonly<{
  issue(
    input: Readonly<{
      releaseSha: string
      canaryProfileVersion: 'synthetic-canary-v1'
      expected: AiCanaryIssueExpectation
      nonce: string
      operatorUserId: string
    }>,
  ): Promise<
    | Readonly<{ status: 'issued'; claim: AiCanaryClaimV1 }>
    | Readonly<{ status: 'denied' }>
  >
  revoke(
    input: Readonly<{
      authorizationId: string
      expectedHeadGeneration: number
    }>,
  ): Promise<Readonly<{ status: 'revoked' | 'denied' }>>
  reapExpired(
    input: Readonly<{
      limit: number
    }>,
  ): Promise<Readonly<{ reaped: number }>>
}>
