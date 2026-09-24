import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { ResponseTargetKind } from '../../domain/response-target'

/**
 * The shorter Google Review target an Organization may set for its own
 * low-rated reviews: any rating at or below `threshold` is measured against
 * `durationMinutes` instead, so its halfway and target-time reminders come
 * sooner. Null everywhere is the default and is exactly today's behaviour.
 */
export type LowRatingResponseTarget = Readonly<{
  threshold: number
  durationMinutes: number
}>

export type OrganizationResponseTargetPolicyView = Readonly<{
  targetKind: ResponseTargetKind
  durationMinutes: number
  policySource: 'builtin_default' | 'organization_policy'
  /** Null means no stored row exists and the next write must expect creation. */
  policyVersion: number | null
  /** Google Review policies only; always null for private feedback. */
  lowRating: LowRatingResponseTarget | null
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
    command: PolicyCommand &
      Readonly<{
        targetKind: ResponseTargetKind
        /**
         * Omitted leaves the stored low-rating target as it is; `null` clears
         * it; an object sets it. Only a Google Review policy may carry one.
         */
        lowRating?: LowRatingResponseTarget | null
      }>,
  ): Promise<ResponseTargetPolicyWriteResult>
  setPrivateFeedbackPropertyOverride(
    command: Omit<PolicyCommand, 'durationMinutes'> &
      Readonly<{
        propertyId: PropertyId
        durationMinutes: number | null
      }>,
  ): Promise<ResponseTargetPolicyWriteResult>
}>
