import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { ResponseTargetKind } from '../../domain/response-target'

export type OrganizationResponseTargetPolicyView = Readonly<{
  targetKind: ResponseTargetKind
  durationMinutes: number
  policySource: 'builtin_default' | 'organization_policy'
  /** Null means no stored row exists and the next write must expect creation. */
  policyVersion: number | null
}>

export type ResponseTargetPolicySettings = Readonly<{
  organization: Readonly<{
    googleReviewResponse: OrganizationResponseTargetPolicyView
    privateFeedbackHandling: OrganizationResponseTargetPolicyView
  }>
  privateFeedbackPropertyOverride: Readonly<{
    propertyId: PropertyId
    durationMinutes: number | null
    policyVersion: number | null
    effectiveDurationMinutes: number
    effectiveSource: 'builtin_default' | 'organization_policy' | 'property_override'
  }> | null
}>

export type ResponseTargetPolicyWriteResult = Readonly<{
  scope: 'organization' | 'property'
  targetKind: ResponseTargetKind
  propertyId: PropertyId | null
  durationMinutes: number | null
  policyVersion: number
}>

type PolicyCommand = Readonly<{
  organizationId: OrganizationId
  durationMinutes: number
  expectedPolicyVersion: number | null
  actorUserId: UserId
  at: Date
}>

export type ResponseTargetPolicyStore = Readonly<{
  getPolicySettings(
    organizationId: OrganizationId,
    propertyId?: PropertyId,
  ): Promise<ResponseTargetPolicySettings>
  setOrganizationPolicy(
    command: PolicyCommand & Readonly<{ targetKind: ResponseTargetKind }>,
  ): Promise<ResponseTargetPolicyWriteResult>
  setPrivateFeedbackPropertyOverride(
    command: Omit<PolicyCommand, 'durationMinutes'> &
      Readonly<{
        propertyId: PropertyId
        durationMinutes: number | null
      }>,
  ): Promise<ResponseTargetPolicyWriteResult>
}>
