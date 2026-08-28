// Notification context — port for resolving inbox-item facts (ADR 0022).
// Self-contained DTOs: returns branded ids and content-free facts, exposes no
// inbox internals (mirrors the UserLookupPort convention, ADR 0008).
import type { ReviewId, OrganizationId, InboxItemId, UserId } from '#/shared/domain/ids'

/**
 * The render facts a notification needs about an inbox item (ADR 0046 r.8).
 *
 * Content-free by construction: the item's snippet, reviewer name, media, and
 * Google/provider rating are deliberately NOT here and must never be added.
 * A locally collected Portal rating may cross; `propertyName` is
 * tenant-authored, and `createdAt` only yields an age. The events themselves
 * carry ids only, which is why this seam exists.
 */
export type InboxItemFacts = Readonly<{
  propertyId: string
  /** Portal attribution for private feedback; null for Google reviews or missing sources. */
  portalId: string | null
  /** Current explicit Inbox assignee, independent from manager responsibility. */
  assignedTo: UserId | null
  /** Tenant-authored property name. Null when the property row is gone. */
  propertyName: string | null
  /** Locally collected Portal stars, or null for reviews/unrated feedback. */
  guestRating: number | null
  /** 'review' (Google-sourced) or 'feedback' (portal-sourced). */
  sourceType: string
  /** When the item entered the inbox — the clock the waiting age is measured from. */
  createdAt: Date
}>

/**
 * Exact current Handling Cycle authority used by durable notification
 * admission and revalidated again when the queued notification is delivered.
 * It intentionally carries identifiers and workflow revisions only.
 */
export type HandlingCycleNotificationFacts = InboxItemFacts &
  Readonly<{
    sourceId: string
    currentCycleNumber: number
    currentSourceRevision: number
    stateRevision: number
    status: 'open' | 'closed'
  }>

/**
 * Exact current Response Target reminder authority. The tuple in the durable
 * event is looked up again before fan-out and again before materialization so
 * a completed target, superseded cycle, or changed responsibility cannot
 * produce a stale notification.
 */
export type ResponseTargetReminderNotificationFacts = HandlingCycleNotificationFacts &
  Readonly<{
    sourceType: 'review' | 'feedback'
    targetKind: 'google_review_response' | 'private_feedback_handling'
    reminderKind: 'halfway' | 'target_passed'
    scheduledFor: Date
  }>

export type ResponseTargetReminderNotificationLookup = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  cycleNumber: number
  targetKind: 'google_review_response' | 'private_feedback_handling'
  reminderKind: 'halfway' | 'target_passed'
  scheduledFor: Date
}>

export type InboxItemLookupPort = Readonly<{
  /** Resolve the inbox-item id for a review (sourceType=review, sourceId=reviewId).
   *  Null when the review's inbox item has been hard-deleted. */
  findInboxItemByReviewId(
    reviewId: ReviewId,
    orgId: OrganizationId,
  ): Promise<InboxItemId | null>

  /** Render facts for one inbox item. Null when the item is gone. */
  findInboxItemFacts(
    inboxItemId: InboxItemId,
    orgId: OrganizationId,
  ): Promise<InboxItemFacts | null>

  /** Resolve the current source cycle/head together with content-free item facts. */
  findHandlingCycleNotificationFacts(
    inboxItemId: InboxItemId,
    orgId: OrganizationId,
  ): Promise<HandlingCycleNotificationFacts | null>

  /** Resolve one released reminder only while its exact target remains active. */
  findResponseTargetReminderNotificationFacts(
    input: ResponseTargetReminderNotificationLookup,
  ): Promise<ResponseTargetReminderNotificationFacts | null>
}>
