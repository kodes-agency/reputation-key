import type { InboxItemId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  ResponseTargetEligibility,
  ResponseTargetEvaluation,
  ResponseTargetKind,
  ResponseTargetPolicySource,
  ResponseTargetResult,
} from '../../domain/response-target'

export type ResponseTargetView = Readonly<{
  inboxItemId: InboxItemId
  cycleNumber: number
  organizationId: OrganizationId
  propertyId: PropertyId
  targetKind: ResponseTargetKind
  eligibility: ResponseTargetEligibility
  durationMinutes: number | null
  policySource: ResponseTargetPolicySource | null
  policyVersion: number | null
  startAt: Date | null
  dueAt: Date | null
  completionAt: Date | null
  result: ResponseTargetResult | null
  stopReason:
    | 'private_feedback_handled'
    | 'guest_withdrawn'
    | 'confirmed_on_google'
    | 'superseded_by_source_revision'
    | 'source_ineligible'
    | null
  propertyTimezone: string
  evaluation: ResponseTargetEvaluation
}>

export type PrivateFeedbackTargetAnalytics = Readonly<{
  targetKind: 'private_feedback_handling'
  measuredCycleCount: number
  activeCount: number
  currentOverdueCount: number
  handledOnTimeCount: number
  handledLateCount: number
  reopenCount: number
  averageTimeToFirstHandlingMinutes: number | null
}>

export type GoogleReviewTargetAnalytics = Readonly<{
  targetKind: 'google_review_response'
  measuredCycleCount: number
  activeCount: number
  currentOverdueCount: number
  respondedOnTimeCount: number
  respondedLateCount: number
  reopenCount: number
  historicalOnboardingExcludedCount: number
  legacyUnknownExcludedCount: number
  averageTimeToResponseMinutes: number | null
}>

export type ResponseTargetStore = Readonly<{
  getCycleTarget(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
    now: Date,
  ): Promise<ResponseTargetView | null>
  getPrivateFeedbackAnalytics(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds: ReadonlyArray<PropertyId> | null
      now: Date
    }>,
  ): Promise<PrivateFeedbackTargetAnalytics>
  getGoogleReviewAnalytics(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds: ReadonlyArray<PropertyId> | null
      now: Date
    }>,
  ): Promise<GoogleReviewTargetAnalytics>
  releaseDueReminders(
    input: Readonly<{
      now: Date
      limit: number
    }>,
  ): Promise<Readonly<{ released: number }>>
}>
