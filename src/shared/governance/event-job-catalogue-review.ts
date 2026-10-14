// EventJobCatalogue — Review event families.
//
// Split out of ./event-job-catalogue.ts, which spreads these rows into
// EVENT_FAMILY_ROWS, so that module stays under its file-length ratchet (as
// ./event-job-catalogue-identity.ts is). The row shapes and factories live in
// ./event-job-catalogue-rows.ts: this module must not import the catalogue back.

import {
  durable,
  ev,
  type EventConsumerRef,
  type EventFamilyRow,
} from './event-job-catalogue-rows'

const ACTIVITY_OUTBOX = 'src/contexts/feed/infrastructure/activity-outbox-consumers.ts'
const AI_OUTBOX = 'src/contexts/ai/infrastructure/outbox-consumers.ts'
const INBOX_OUTBOX = 'src/contexts/inbox/infrastructure/outbox-consumers.ts'
const REVIEW_OUTBOX = 'src/contexts/review/infrastructure/outbox-consumers.ts'
const METRIC_PUBLIC_REPUTATION_OUTBOX =
  'src/contexts/reporting/infrastructure/public-reputation-outbox-consumers.ts'
const METRIC_CURRENT_GOOGLE_REPUTATION_OUTBOX =
  'src/contexts/reporting/infrastructure/current-google-reputation-outbox-consumers.ts'
const GOAL_RATING_GOAL_OUTBOX =
  'src/contexts/reporting/infrastructure/rating-goal-outbox-consumers.ts'
const NOTIFICATION_REVIEW_IMPORT_OUTBOX =
  'src/contexts/feed/infrastructure/review-import-outbox-consumers.ts'
const NOTIFICATION_WORKFLOW_OUTBOX =
  'src/contexts/feed/infrastructure/workflow-outbox-consumers.ts'
const NOTIFICATION_SETTLEMENT_OUTBOX =
  'src/contexts/feed/infrastructure/notification-settlement-outbox-consumers.ts'

/** A Feed route that retires notices rather than raising them (ADR 0046). */
const settles = (name: string): EventConsumerRef =>
  durable(name, NOTIFICATION_SETTLEMENT_OUTBOX)

export const REVIEW_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('review.created', [
    durable('inbox.on-review-created', INBOX_OUTBOX),
    durable('ai.analyze-review-event', AI_OUTBOX),
    durable('metric.public-reputation', METRIC_PUBLIC_REPUTATION_OUTBOX),
  ]),
  ev('review.updated', [
    durable('inbox.on-review-updated', INBOX_OUTBOX),
    durable('ai.analyze-review-event', AI_OUTBOX),
  ]),
  ev('review.source_transitioned', [
    durable('inbox.on-review-source-transitioned', INBOX_OUTBOX),
    durable('ai.analyze-review-event', AI_OUTBOX),
  ]),
  ev('review.google_reputation_snapshot.verified', [
    durable('metric.current-google-reputation', METRIC_CURRENT_GOOGLE_REPUTATION_OUTBOX),
    // Evaluates the Property's Google rating goal against the new numbers.
    durable('goal.google-rating-evaluation', GOAL_RATING_GOAL_OUTBOX),
  ]),
  ev('review.property_history_import.finished', [
    durable(
      'notification.on-review-history-import-finished',
      NOTIFICATION_REVIEW_IMPORT_OUTBOX,
    ),
  ]),
  ev('ai.property_trend.generation_requested', [
    durable('ai.generate-property-trend', AI_OUTBOX),
  ]),
  ev('ai.review_analysis.backfill_requested', [
    durable('ai.analyze-review-event', AI_OUTBOX),
  ]),
  ev('review.expired', [durable('inbox.on-review-expired', INBOX_OUTBOX)]),
  ev('review.reply.submitted', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-review-reply-submitted', NOTIFICATION_WORKFLOW_OUTBOX),
    durable('inbox.on-reply-submitted', INBOX_OUTBOX),
  ]),
  ev('review.reply.approved', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-review-reply-approved', NOTIFICATION_WORKFLOW_OUTBOX),
    settles('notification.settle-on-review-reply-approved'),
  ]),
  ev('review.reply.publication_requested', [
    durable('review.on-reply-publication-requested', REVIEW_OUTBOX),
  ]),
  ev('review.reply.rejected', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-review-reply-rejected', NOTIFICATION_WORKFLOW_OUTBOX),
    settles('notification.settle-on-review-reply-rejected'),
  ]),
  ev('review.reply.published', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
    durable('notification.on-review-reply-published', NOTIFICATION_WORKFLOW_OUTBOX),
    settles('notification.settle-on-review-reply-published'),
    durable('inbox.on-reply-published', INBOX_OUTBOX),
  ]),
  ev('review.reply.observed', [durable('inbox.on-reply-observed', INBOX_OUTBOX)]),
  ev('review.reply.publish_failed', [
    durable('notification.on-review-reply-publish_failed', NOTIFICATION_WORKFLOW_OUTBOX),
  ]),
  ev('review.reply.publication_cancelled', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable(
      'notification.on-review-reply-publication_cancelled',
      NOTIFICATION_WORKFLOW_OUTBOX,
    ),
    settles('notification.settle-on-review-reply-publication-cancelled'),
  ]),
  ev('review.reply.updated', [durable('activity.recent-activity', ACTIVITY_OUTBOX)]),
]
