import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'

export type AiControlScope =
  | Readonly<{ kind: 'global' }>
  | Readonly<{
      kind: 'provider_deployment_profile'
      providerDeploymentProfileVersion: string
    }>
  | Readonly<{
      kind: 'capability'
      capability: MerchantAiCapability
    }>

export type AiControlHead = Readonly<{
  scope: AiControlScope
  controlId: string
  generation: number
  executionState: 'enabled' | 'killed'
  admissionState: 'accepting' | 'draining'
  updatedAtEpochMillis: number
}>

export type AiControlPort = Readonly<{
  readHeads(
    input: Readonly<{
      providerDeploymentProfileVersion: string
      capability: MerchantAiCapability
    }>,
  ): Promise<ReadonlyArray<AiControlHead>>

  transition(
    input: Readonly<{
      scope: AiControlScope
      providerDeploymentProfileVersion: string | null
      expectedControlId: string
      expectedGeneration: number
      executionState: AiControlHead['executionState']
      admissionState: AiControlHead['admissionState']
      reasonCode: string
      actorUserId: string | null
      ticketReference: string
      candidateReleaseSha: string | null
    }>,
  ): Promise<AiControlHead | null>
}>
