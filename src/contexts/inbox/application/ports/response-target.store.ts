import type { InboxItemId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  ResponseTargetEligibility,
  ResponseTargetReminderKind,
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

/** The key of one write-once reminder slot. */
export type ReminderSlotKey = Readonly<{
  inboxItemId: InboxItemId
  cycleNumber: number
  reminderKind: ResponseTargetReminderKind
}>

/**
 * One reminder slot that was due when it was listed, with what the release
 * decision needs. Listing takes no lock, so by release time the slot may be
 * gone: `releaseReminderSlot` decides that again under the target's lock.
 */
export type DueReminderCandidate = Readonly<{
  key: ReminderSlotKey
  organizationId: OrganizationId
  propertyId: PropertyId
  targetKind: ResponseTargetKind
  scheduledFor: Date
  targetStartAt: Date | null
  targetDueAt: Date | null
  /** The review (for a Google review target) or feedback the cycle is about. */
  sourceId: string
  /** The Material Review Revision the cycle measures (the source revision). */
  sourceRevision: number
}>

export type ReminderSlotReleaseResult =
  /** The slot was delivered and its fact queued. */
  | 'released'
  /** A halfway slot whose target has passed: closed without a prompt. */
  | 'cancelled_superseded'
  /** Completed, closed, already delivered or cancelled, or locked by another writer. */
  | 'skipped'

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
  getGoogleReviewTargetCountsByProperty(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds: ReadonlyArray<PropertyId>
      now: Date
    }>,
  ): Promise<
    ReadonlyMap<PropertyId, Readonly<{ activeCount: number; overdueCount: number }>>
  >
  releaseDueReminders(
    input: Readonly<{
      now: Date
      limit: number
    }>,
  ): Promise<Readonly<{ released: number }>>
  /**
   * The reminder slots due at `now`, oldest first, with NO lock and no
   * transaction held afterwards: the caller may read Google between this and
   * `releaseReminderSlot`.
   */
  listDueReminderCandidates(
    input: Readonly<{ now: Date; limit: number }>,
  ): Promise<ReadonlyArray<DueReminderCandidate>>
  /**
   * Release one due slot in its own short transaction: the same selection, the
   * target lock, the one-shot guard and the outbox fact as `releaseDueReminders`,
   * re-decided under the lock. A target completed meanwhile (a reply closed it)
   * answers `skipped`, which is how a held slot is cancelled by the normal close.
   */
  releaseReminderSlot(
    input: Readonly<{ key: ReminderSlotKey; now: Date }>,
  ): Promise<ReminderSlotReleaseResult>
  /**
   * Apply one `property.archived` delivery: while the Property is still not
   * active, cancel its unreleased reminder slots and co-commit the receipt.
   * A Property that is active again makes the fact `obsolete`.
   */
  cancelArchivedPropertyRemindersOnce(
    input: Readonly<{
      eventId: string
      consumerName: string
      organizationId: OrganizationId
      propertyId: PropertyId
      at: Date
    }>,
  ): Promise<'applied' | 'duplicate' | 'obsolete'>
}>
