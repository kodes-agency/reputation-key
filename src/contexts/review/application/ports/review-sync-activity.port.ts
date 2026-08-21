// Review context — durable discovery-activity recorder port.
//
// The discovery backoff ladder (domain/discovery-backoff.ts) can only shed
// provider quota if it can tell a live property from a quiet one, and the
// only processes that KNOW are the ones running the sync path:
//
//   - the provider snapshot persists a review nobody had seen before
//     → recordNewReviewObserved;
//   - a GBP Pub/Sub push arrived for the property and the webhook enqueued a
//     sync for it → recordPushObserved. A push proves Google is publishing
//     for this location, which is the strongest liveness signal we get.
//
// Both writes are idempotent and monotonic (they never move a stored instant
// backwards), so a replayed snapshot page or a redelivered push is safe.
//
// Content-free: a property id and timestamps only.

export type ReviewSyncActivityRecorder = Readonly<{
  /**
   * A snapshot page persisted at least one review that did not exist locally.
   * Stamps review_sync_state.last_new_review_at, which promotes the property
   * back to the hot tier the next time the sweep schedules it. Does NOT pull
   * the current next-poll time forward: we have just polled this property.
   */
  recordNewReviewObserved(propertyId: string, observedAt: Date): Promise<void>

  /**
   * A GBP push notification was received for this property. Stamps
   * review_sync_state.last_notification_at and un-parks the property by
   * clamping its next poll to no later than `pollNoLaterThan` — which the
   * caller sets to `observedAt + hot interval`, so the clamp can only shorten
   * a far-future park and can never write a past (permanently overdue) time.
   */
  recordPushObserved(
    propertyId: string,
    observedAt: Date,
    pollNoLaterThan: Date,
  ): Promise<void>
}>
