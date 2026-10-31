import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiPropertyProcessingProfiles,
  merchantAiEnablement,
} from '#/shared/db/schema'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import { isExecutionCompatibleWithConsent } from '#/shared/ai-runtime-capability-contract'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

type AuthorizedEffectOperation = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number | null
  authorizationLineageId: string | null
  noticeVersion: string | null
  noticeDigest: string | null
  propertyProfileVersion: number | null
  sourcePolicyId: string | null
  redactionProfileVersion: string | null
  capabilityRuntimeProfileVersion: string | null
  operationProfileVersion: string
  providerDeploymentProfileVersion: string
  globalControlId: string
  globalControlGeneration: number
  providerControlId: string
  providerControlGeneration: number
  capabilityControlId: string
  capabilityControlGeneration: number
}>

type CompleteAuthorizedEffectOperation = AuthorizedEffectOperation &
  Readonly<{
    sourceEpoch: number
    authorizationLineageId: string
    noticeVersion: string
    noticeDigest: string
    propertyProfileVersion: number
    sourcePolicyId: string
    redactionProfileVersion: string
  }>

type Authorization = Pick<
  typeof merchantAiEnablement.$inferSelect,
  | 'state'
  | 'authorizationLineageId'
  | 'capabilities'
  | 'reviewAnalysisEpoch'
  | 'replyDraftingEpoch'
  | 'propertyTrendsEpoch'
  | 'authorizedSourceEpoch'
  | 'noticeVersion'
  | 'noticeDigest'
  | 'sourcePolicyId'
  | 'redactionProfileFamily'
>

function hasCompleteAuthorizationBinding(
  operation: AuthorizedEffectOperation,
): operation is CompleteAuthorizedEffectOperation {
  return (
    operation.sourceEpoch !== null &&
    operation.authorizationLineageId !== null &&
    operation.noticeVersion !== null &&
    operation.noticeDigest !== null &&
    operation.propertyProfileVersion !== null &&
    operation.sourcePolicyId !== null &&
    operation.redactionProfileVersion !== null
  )
}

function matchesCapabilityEpochs(
  authorization: Authorization,
  capability: MerchantAiCapability,
  fence: Readonly<Record<string, unknown>>,
): boolean {
  if (capability === 'reply_drafting')
    return authorization.replyDraftingEpoch === fence.replyDraftingEpoch
  return (
    authorization.reviewAnalysisEpoch === fence.reviewAnalysisEpoch &&
    (capability !== 'property_trends' ||
      authorization.propertyTrendsEpoch === fence.propertyTrendsEpoch)
  )
}

function authorizationCoversEffect(
  authorization: Authorization,
  operation: CompleteAuthorizedEffectOperation,
  capability: MerchantAiCapability,
  fence: Readonly<Record<string, unknown>>,
): boolean {
  return (
    authorization.state === 'enabled' &&
    authorization.authorizationLineageId === operation.authorizationLineageId &&
    authorization.capabilities.includes(capability) &&
    isExecutionCompatibleWithConsent({
      capability,
      acknowledgedNotice: authorization,
      recordedNotice: operation,
      servedExecution: {
        runtimeProfileVersion: operation.capabilityRuntimeProfileVersion ?? '',
        operationProfileVersion: operation.operationProfileVersion,
        providerDeploymentProfileVersion: operation.providerDeploymentProfileVersion,
      },
    }) &&
    authorization.authorizedSourceEpoch === operation.sourceEpoch &&
    authorization.sourcePolicyId === operation.sourcePolicyId &&
    authorization.redactionProfileFamily === operation.redactionProfileVersion &&
    matchesCapabilityEpochs(authorization, capability, fence)
  )
}

export async function isCurrentAuthorizedEffect(
  tx: Transaction,
  input: Readonly<{
    capability: MerchantAiCapability
    operation: AuthorizedEffectOperation
    capabilityFence: Readonly<Record<string, unknown>>
  }>,
): Promise<boolean> {
  const operation = input.operation
  if (!hasCompleteAuthorizationBinding(operation)) return false
  const [authorization] = await tx
    .select({
      state: merchantAiEnablement.state,
      authorizationLineageId: merchantAiEnablement.authorizationLineageId,
      capabilities: merchantAiEnablement.capabilities,
      reviewAnalysisEpoch: merchantAiEnablement.reviewAnalysisEpoch,
      replyDraftingEpoch: merchantAiEnablement.replyDraftingEpoch,
      propertyTrendsEpoch: merchantAiEnablement.propertyTrendsEpoch,
      authorizedSourceEpoch: merchantAiEnablement.authorizedSourceEpoch,
      noticeVersion: merchantAiEnablement.noticeVersion,
      noticeDigest: merchantAiEnablement.noticeDigest,
      sourcePolicyId: merchantAiEnablement.sourcePolicyId,
      redactionProfileFamily: merchantAiEnablement.redactionProfileFamily,
    })
    .from(merchantAiEnablement)
    .where(
      and(
        eq(merchantAiEnablement.organizationId, operation.organizationId),
        eq(merchantAiEnablement.propertyId, operation.propertyId),
      ),
    )
    .limit(1)
    .for('share')
  if (
    !authorization ||
    !authorizationCoversEffect(
      authorization,
      operation,
      input.capability,
      input.capabilityFence,
    )
  )
    return false

  const [profile] = await tx
    .select({
      lifecycleState: aiPropertyProcessingProfiles.lifecycleState,
      sourceEpoch: aiPropertyProcessingProfiles.sourceEpoch,
      profileVersion: aiPropertyProcessingProfiles.profileVersion,
    })
    .from(aiPropertyProcessingProfiles)
    .where(
      and(
        eq(aiPropertyProcessingProfiles.organizationId, operation.organizationId),
        eq(aiPropertyProcessingProfiles.propertyId, operation.propertyId),
      ),
    )
    .limit(1)
    .for('share')
  if (
    !profile ||
    profile.lifecycleState !== 'active' ||
    profile.sourceEpoch !== operation.sourceEpoch ||
    profile.profileVersion !== operation.propertyProfileVersion
  ) {
    return false
  }

  const providerScope = `provider:${operation.providerDeploymentProfileVersion}`
  const controls = await tx
    .select({
      scopeKey: aiExecutionControlHeads.scopeKey,
      controlId: aiExecutionControlHeads.controlId,
      generation: aiExecutionControlHeads.generation,
      executionState: aiExecutionControlHeads.executionState,
      admissionState: aiExecutionControlHeads.admissionState,
    })
    .from(aiExecutionControlHeads)
    .where(
      inArray(aiExecutionControlHeads.scopeKey, [
        'global',
        providerScope,
        `capability:${input.capability}`,
      ]),
    )
    .for('share')
  if (controls.length !== 3) return false
  const byScope = new Map(controls.map((control) => [control.scopeKey, control]))
  const matches = (scopeKey: string, controlId: string, generation: number): boolean => {
    const control = byScope.get(scopeKey)
    return (
      control?.controlId === controlId &&
      control.generation === generation &&
      control.executionState === 'enabled' &&
      control.admissionState === 'accepting'
    )
  }
  return (
    matches('global', operation.globalControlId, operation.globalControlGeneration) &&
    matches(
      providerScope,
      operation.providerControlId,
      operation.providerControlGeneration,
    ) &&
    matches(
      `capability:${input.capability}`,
      operation.capabilityControlId,
      operation.capabilityControlGeneration,
    )
  )
}
