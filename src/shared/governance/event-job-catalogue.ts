// EventJobCatalogue — BQC-3.1.
//
// Runtime catalogue for durable event routing and governed BullMQ families.
// Event rows name the event type and expected durable consumers. Job rows own
// retry, timeout, scheduling, capability, action, and registration policy.
//
// A missing expected consumer fails worker readiness and dispatcher delivery.
// A missing or unknown job family fails readiness or enqueue policy.

import type { Capability } from '#/shared/auth/beta-capabilities'
import type { SystemAction } from './entry-point-catalogue'

// ── Types ───────────────────────────────────────────────────────────

/** A durable outbox consumer of an event family, pinned to its registration module. */
export type EventConsumerRef = Readonly<{
  /** Consumer name, e.g. 'inbox.on-review-created'. */
  name: string
  /** Repo-relative file containing the registerConsumer call. */
  module: string
}>

export type EventFamilyRow = Readonly<{
  eventType: string
  consumers: ReadonlyArray<EventConsumerRef>
}>

/** Registration posture of a job family. */
export type JobRegistration =
  | 'enabled' // real handler registered and schedulable
  | 'denied_dark' // capability dark — no-op handler registered (BQR-0 containment)
  | 'blocked_capability' // capability hard-blocked — no-op handler registered
  | 'quarantined' // safety no-op registered; scheduling/cutover explicitly denied

export type JobFamilyRow = Readonly<{
  /** BullMQ job name. */
  jobName: string
  /** Queue the family is enqueued on. */
  queue: 'default' | 'background'
  /** Repo-relative file containing the processor ('src/bootstrap.ts' for inline handlers). */
  processor: string
  retryAttempts: number
  /** Backoff class, e.g. 'exponential:30000'. */
  retryBackoff: string
  /**
   * BQC-3.6: per-job execution timeout. Honest values from the workload:
   * quick heartbeats 30s, GBP sync/sweeps 300s, bulk import 600s, the bounded
   * retention sweep 900s, and everything else the 120s default.
   */
  timeoutMs: number
  /** Cadence: 'none', 'every:<ms>[,offset:<ms>]', or 'cron:<pattern>'. */
  schedule: string
  /** Capability gate (registration gate, else in-handler gate); 'none' when ungated. */
  capability: Capability | 'none'
  /** System action, matching the entry-point catalogue row. */
  action: SystemAction | 'none'
  registration: JobRegistration
}>

// ── Row factories (records of functions — no classes) ───────────────

/** Durable outbox consumer ('<context>.<handler-name>'). */
const durable = (name: string, module: string): EventConsumerRef => ({ name, module })

/** Event family row used by readiness and dispatcher routing. */
const ev = (
  eventType: string,
  consumers: ReadonlyArray<EventConsumerRef>,
): EventFamilyRow => ({ eventType, consumers })

type JobBase = Readonly<{
  queue: 'default' | 'background'
  capability: Capability | 'none'
  action: SystemAction | 'none'
  schedule: string
  registration: JobRegistration
}>

type JobOpts = Partial<Pick<JobFamilyRow, 'retryAttempts' | 'retryBackoff' | 'timeoutMs'>>

/** Job family row; retry defaults baked from the queue factory. */
function job(
  jobName: string,
  processor: string,
  base: JobBase,
  opts: JobOpts = {},
): JobFamilyRow {
  return {
    jobName,
    queue: base.queue,
    processor,
    retryAttempts: 3,
    retryBackoff: 'exponential:30000',
    timeoutMs: 120_000,
    schedule: base.schedule,
    capability: base.capability,
    action: base.action,
    registration: base.registration,
    ...opts,
  }
}

// ── Consumer modules ────────────────────────────────────────────────

const ACTIVITY_OUTBOX = 'src/contexts/feed/infrastructure/activity-outbox-consumers.ts'
const METRIC_OUTBOX = 'src/contexts/reporting/infrastructure/outbox-consumers.ts'
const METRIC_GUEST_OUTBOX =
  'src/contexts/reporting/infrastructure/guest-outbox-consumers.ts'
const METRIC_CORRECTION_OUTBOX =
  'src/contexts/reporting/infrastructure/correction-outbox-consumers.ts'
const GOAL_METRIC_CORRECTION_OUTBOX =
  'src/contexts/reporting/infrastructure/metric-correction-outbox-consumers.ts'
const REVIEW_OUTBOX = 'src/contexts/review/infrastructure/outbox-consumers.ts'
const INBOX_OUTBOX = 'src/contexts/inbox/infrastructure/outbox-consumers.ts'
const INBOX_GUEST_FEEDBACK_OUTBOX =
  'src/contexts/inbox/infrastructure/guest-feedback-outbox-consumers.ts'
const AI_OUTBOX = 'src/contexts/ai/infrastructure/outbox-consumers.ts'
const PROPERTY_RETENTION_OUTBOX =
  'src/contexts/property/infrastructure/outbox-consumers.ts'
const INTEGRATION_IMPORT_OUTBOX =
  'src/contexts/integration/infrastructure/outbox-consumers.ts'
const INTEGRATION_GBP_PUSH_OUTBOX =
  'src/contexts/integration/infrastructure/google-review-push-outbox-consumers.ts'
const NOTIFICATION_OUTBOX =
  'src/contexts/feed/infrastructure/notification-outbox-consumers.ts'
const NOTIFICATION_WORKFLOW_OUTBOX =
  'src/contexts/feed/infrastructure/workflow-outbox-consumers.ts'
const NOTIFICATION_PORTAL_OUTBOX =
  'src/contexts/feed/infrastructure/portal-outbox-consumers.ts'
const NOTIFICATION_PORTAL_HEALTH_OUTBOX =
  'src/contexts/feed/infrastructure/portal-health-outbox-consumers.ts'
const NOTIFICATION_PROPERTY_OUTBOX =
  'src/contexts/feed/infrastructure/property-outbox-consumers.ts'
const NOTIFICATION_INTEGRATION_OUTBOX =
  'src/contexts/feed/infrastructure/integration-outbox-consumers.ts'
const NOTIFICATION_BULK_ASSIGNMENT_OUTBOX =
  'src/contexts/feed/infrastructure/bulk-assignment-outbox-consumers.ts'
const NOTIFICATION_ESCALATION_RESOLUTION_OUTBOX =
  'src/contexts/feed/infrastructure/escalation-resolution-outbox-consumers.ts'
const NOTIFICATION_HANDLING_CYCLE_OUTBOX =
  'src/contexts/feed/infrastructure/handling-cycle-outbox-consumers.ts'
const NOTIFICATION_RESPONSE_TARGET_OUTBOX =
  'src/contexts/feed/infrastructure/response-target-outbox-consumers.ts'
const NOTIFICATION_GOAL_OUTBOX =
  'src/contexts/feed/infrastructure/goal-outbox-consumers.ts'
const NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX =
  'src/contexts/feed/infrastructure/identity-account-outbox-consumers.ts'
const METRIC_PUBLIC_REPUTATION_OUTBOX =
  'src/contexts/reporting/infrastructure/public-reputation-outbox-consumers.ts'
const METRIC_CURRENT_GOOGLE_REPUTATION_OUTBOX =
  'src/contexts/reporting/infrastructure/current-google-reputation-outbox-consumers.ts'

// ── Event families ──────────────────────────────────────────────────

const PORTAL_HEALTH_OUTBOX =
  'src/contexts/portal/infrastructure/portal-health-outbox-consumers.ts'

const REVIEW_ROWS: ReadonlyArray<EventFamilyRow> = [
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
  ]),
  ev('review.reply.publication_requested', [
    durable('review.on-reply-publication-requested', REVIEW_OUTBOX),
  ]),
  ev('review.reply.rejected', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-review-reply-rejected', NOTIFICATION_WORKFLOW_OUTBOX),
  ]),
  ev('review.reply.published', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
    durable('notification.on-review-reply-published', NOTIFICATION_WORKFLOW_OUTBOX),
    durable('inbox.on-reply-published', INBOX_OUTBOX),
  ]),
  ev('review.reply.observed', [durable('inbox.on-reply-observed', INBOX_OUTBOX)]),
  ev('review.reply.publish_failed', [
    durable('notification.on-review-reply-publish_failed', NOTIFICATION_WORKFLOW_OUTBOX),
  ]),
  ev('review.reply.publication_cancelled', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('review.reply.updated', [durable('activity.recent-activity', ACTIVITY_OUTBOX)]),
]

const INBOX_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('inbox.inbox_item.created', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-inbox-item-created', NOTIFICATION_OUTBOX),
  ]),
  ev('inbox.inbox_item.status_changed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('inbox.inbox_item.assigned', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-inbox-inbox_item-assigned', NOTIFICATION_WORKFLOW_OUTBOX),
  ]),
  ev('inbox.inbox_item.unassigned', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('inbox.inbox_item.escalated', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-inbox-inbox_item-escalated', NOTIFICATION_WORKFLOW_OUTBOX),
  ]),
  ev('inbox.inbox_item.escalation_resolved', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable(
      'notification.on-inbox-escalation-resolved',
      NOTIFICATION_ESCALATION_RESOLUTION_OUTBOX,
    ),
  ]),
  ev('inbox.inbox_note.added', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-inbox-inbox_note-added', NOTIFICATION_WORKFLOW_OUTBOX),
  ]),
  ev('inbox.inbox_item.bulk_status_changed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('inbox.inbox_items.bulk_assignment_completed', [
    durable(
      'notification.on-inbox-bulk-assignment-completed',
      NOTIFICATION_BULK_ASSIGNMENT_OUTBOX,
    ),
  ]),
  ev('inbox.handling_cycle.opened', [
    durable(
      'notification.on-inbox-handling-cycle-opened',
      NOTIFICATION_HANDLING_CYCLE_OUTBOX,
    ),
  ]),
  ev('inbox.handling_cycle.closed', []),
  ev('inbox.handling_cycle.reopened', [
    durable(
      'notification.on-inbox-handling-cycle-reopened',
      NOTIFICATION_HANDLING_CYCLE_OUTBOX,
    ),
  ]),
  ev('inbox.response_target.reminder_due', [
    durable(
      'notification.on-inbox-response-target-reminder-due',
      NOTIFICATION_RESPONSE_TARGET_OUTBOX,
    ),
  ]),
  ev('inbox.response_target.policy_changed', []),
]

const IDENTITY_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('identity.organization.created', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('identity.member.invited', [durable('activity.recent-activity', ACTIVITY_OUTBOX)]),
  ev('identity.invitation.accepted', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable(
      'notification.on-identity-invitation-accepted',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  ev('identity.invitation.canceled', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('identity.member.removed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable(
      'notification.on-identity-member-removed',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  ev('identity.member.role_changed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
    durable(
      'notification.on-identity-member-role-changed',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  ev('identity.merchant_ai.changed', [
    durable('ai.enroll-review-analysis', AI_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
  ]),
  ev('identity.organization_lifecycle.changed', [
    durable(
      'notification.on-identity-organization-purge-pending',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
]

const PROPERTY_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('property.created', [durable('activity.recent-activity', ACTIVITY_OUTBOX)]),
  ev('property.updated', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('portal.reconcile-health-dependencies', PORTAL_HEALTH_OUTBOX),
  ]),
  ev('property.deleted', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
    durable('portal.reconcile-health-dependencies', PORTAL_HEALTH_OUTBOX),
  ]),
  ev('property.archived', [
    durable('portal.reconcile-health-dependencies', PORTAL_HEALTH_OUTBOX),
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
  ]),
  ev('property.restored', [
    durable('portal.reconcile-health-dependencies', PORTAL_HEALTH_OUTBOX),
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
  ]),
  ev('property.google_binding.changed', [
    durable('integration.provider-authorization-invalidation', INTEGRATION_IMPORT_OUTBOX),
    durable('portal.reconcile-health-dependencies', PORTAL_HEALTH_OUTBOX),
  ]),
  ev('property.responsibility_became_needed', [
    durable(
      'notification.on-property-responsibility-needed',
      NOTIFICATION_PROPERTY_OUTBOX,
    ),
  ]),
]

const PORTAL_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('portal.created', []),
  ev('portal.updated', []),
  ev('portal.publication.published', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
  ]),
  ev('portal.publication.rolled_back', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('portal.archived', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
  ]),
  ev('portal.restored', [durable('activity.recent-activity', ACTIVITY_OUTBOX)]),
  ev('portal.responsibility_became_needed', [
    durable('notification.on-portal-responsibility-needed', NOTIFICATION_PORTAL_OUTBOX),
  ]),
  ev('portal.responsible_managers.updated', [
    durable('portal.reconcile-health-dependencies', PORTAL_HEALTH_OUTBOX),
  ]),
  ev('portal.health.changed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-portal-health-changed', NOTIFICATION_PORTAL_HEALTH_OUTBOX),
  ]),
  ev('portal.property_brand_profile.updated', []),
  ev('portal.property_brand_content.updated', []),
  ev('portal.localized_override.updated', []),
  ev('portal.locale_set.updated', []),
  ev('portal.approved_destination.updated', [
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
  ]),
  ev('portal.content_review.completed', [
    durable('metric.portal-workflow', METRIC_OUTBOX),
  ]),
  ev('portal.configuration_completeness.recorded', [
    durable('metric.portal-workflow', METRIC_OUTBOX),
  ]),
  ev('portal.approved_destination_ratio.recorded', [
    durable('metric.portal-workflow', METRIC_OUTBOX),
  ]),
  ev('portal.deleted', []),
  ev('portal.token.issued', []),
  ev('portal.token.rotated', []),
  ev('portal.token.revoked', []),
  ev('portal.access_artifact.published', []),
  ev('portal_link_category.created', []),
  ev('portal_link_category.reordered', []),
  ev('portal_link_category.updated', []),
  ev('portal_link_category.deleted', []),
  ev('portal_link.created', []),
  ev('portal_link.reordered', []),
  ev('portal_link.updated', []),
  ev('portal_link.deleted', []),
  ev('portal_group.created', []),
  ev('portal_group.updated', []),
  ev('portal_group.deleted', []),
  ev('portal_group.portal_added', []),
  ev('portal_group.portal_removed', []),
]

const GUEST_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('guest.scan.recorded', [durable('metric.guest-analytics', METRIC_GUEST_OUTBOX)]),
  ev('guest.qualified_scan.recorded', [
    durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
  ]),
  ev('guest.qualified_scan.retracted', [
    durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
  ]),
  ev('guest.rating.submitted', [durable('metric.guest-analytics', METRIC_GUEST_OUTBOX)]),
  ev('guest.rating.retracted', [durable('metric.guest-analytics', METRIC_GUEST_OUTBOX)]),
  ev('guest.feedback.submitted', [
    durable('inbox.on-guest-feedback-submitted', INBOX_GUEST_FEEDBACK_OUTBOX),
    durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
  ]),
  ev('guest.feedback.retracted', [
    durable('inbox.on-guest-feedback-retracted', INBOX_GUEST_FEEDBACK_OUTBOX),
    durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
  ]),
  ev('guest.review_link.clicked', [
    durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
  ]),
]

const INTEGRATION_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('integration.google_account.connected', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
  ]),
  ev('integration.google_account.disconnected', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
    durable('review.on-google-account-disconnected', REVIEW_OUTBOX),
  ]),
  ev('integration.google_account.reauthorization_required', [
    durable(
      'notification.on-google-reauthorization-required',
      NOTIFICATION_INTEGRATION_OUTBOX,
    ),
  ]),
  ev('integration.property_import.requested', [
    durable('integration.property-import-dispatch', INTEGRATION_IMPORT_OUTBOX),
  ]),
  ev('integration.google_review_push.accepted', [
    durable('integration.google-review-push-dispatch', INTEGRATION_GBP_PUSH_OUTBOX),
  ]),
  ev('integration.property_import.retention_released', [
    durable('property.import-retention-release', PROPERTY_RETENTION_OUTBOX),
  ]),
  ev('integration.google_connection.visibility_changed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
]

const METRIC_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('metric.recorded', []),
  ev('metric.corrected', [
    durable('metric.correction-reconciliation', METRIC_CORRECTION_OUTBOX),
    durable('goal.metric-correction-reconciliation', GOAL_METRIC_CORRECTION_OUTBOX),
  ]),
]

const GOAL_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('goal.monthly_result.closed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-goal-monthly-result-closed', NOTIFICATION_GOAL_OUTBOX),
  ]),
  ev('goal.monthly_result.reconciled', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('goal.monthly_result.revised', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-goal-monthly-result-revised', NOTIFICATION_GOAL_OUTBOX),
  ]),
]

export const EVENT_FAMILY_ROWS: ReadonlyArray<EventFamilyRow> = [
  ...REVIEW_ROWS,
  ...INBOX_ROWS,
  ...IDENTITY_ROWS,
  ...PROPERTY_ROWS,
  ...PORTAL_ROWS,
  ...GUEST_ROWS,
  ...INTEGRATION_ROWS,
  ...METRIC_ROWS,
  ...GOAL_ROWS,
]

// ── Job families ────────────────────────────────────────────────────

const DEFAULT_QUEUE_ROWS: ReadonlyArray<JobFamilyRow> = [
  job(
    'import-gbp-property-item-v2',
    'src/contexts/integration/infrastructure/jobs/import-gbp-property-item-v2.job.ts',
    {
      queue: 'default',
      capability: 'property.import_gbp_v2',
      action: 'system:property.import_v2',
      schedule: 'none',
      registration: 'enabled',
    },
    { retryAttempts: 5, retryBackoff: 'exponential:30000' },
  ),
  job(
    'sync-property-reviews',
    'src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts',
    {
      queue: 'default',
      capability: 'property.connect_gbp',
      action: 'system:review.sync',
      schedule: 'none',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'generate-property-ai-trend',
    'src/contexts/ai/infrastructure/jobs/generate-property-trend.job.ts',
    {
      queue: 'default',
      capability: 'ai.detect_trends',
      action: 'system:ai.trend',
      schedule: 'none',
      registration: 'enabled',
    },
    { retryBackoff: 'exponential:30000' },
  ),
  job(
    'schedule-property-ai-trends',
    'src/contexts/ai/infrastructure/jobs/schedule-property-trends.job.ts',
    {
      queue: 'background',
      capability: 'ai.detect_trends',
      action: 'system:ai.trend_schedule',
      schedule: 'every:60000',
      registration: 'enabled',
    },
    { retryBackoff: 'fixed:5000', timeoutMs: 30_000 },
  ),
  job(
    'expire-review-provider-source',
    'src/contexts/review/infrastructure/jobs/review-provider-lifecycle-sweeps.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.purge',
      schedule: 'none',
      registration: 'quarantined',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'sweep-review-provider-tombstones',
    'src/contexts/review/infrastructure/jobs/review-provider-lifecycle-sweeps.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.purge',
      schedule: 'none',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'publish-reply',
    'src/contexts/review/infrastructure/jobs/publish-reply.job.ts',
    {
      queue: 'default',
      capability: 'property.publish_reply',
      action: 'system:reply.publish',
      schedule: 'none',
      registration: 'enabled',
    },
    { retryAttempts: 5, retryBackoff: 'exponential:30000' },
  ),
  job(
    'project-recent-activity',
    'src/contexts/feed/infrastructure/jobs/project-recent-activity.job.ts',
    {
      queue: 'default',
      capability: 'none',
      action: 'system:activity.record',
      schedule: 'none',
      registration: 'enabled',
    },
  ),
  job(
    'insert-activity-log',
    'src/contexts/feed/infrastructure/jobs/project-recent-activity.job.ts',
    {
      queue: 'default',
      capability: 'none',
      action: 'system:activity.record',
      schedule: 'none',
      registration: 'enabled',
    },
  ),
  job(
    'insert-notification',
    'src/contexts/feed/infrastructure/jobs/insert-notification.job.ts',
    {
      queue: 'default',
      capability: 'none',
      action: 'system:notification.insert',
      schedule: 'none',
      registration: 'enabled',
    },
  ),
  job('urgent-email', 'src/contexts/feed/infrastructure/jobs/urgent-email.job.ts', {
    queue: 'default',
    capability: 'notification.send_email',
    action: 'system:notification.email_urgent',
    schedule: 'none',
    registration: 'enabled',
  }),
]

const BACKGROUND_QUEUE_ROWS: ReadonlyArray<JobFamilyRow> = [
  job(
    'portal-approved-destination-revalidation',
    'src/contexts/portal/infrastructure/jobs/revalidate-approved-destinations.job.ts',
    {
      queue: 'background',
      capability: 'portal.write',
      action: 'system:portal.destination_revalidate',
      schedule: 'every:900000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'health-check',
    'src/shared/jobs/health-check.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:health.check',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 30_000 },
  ),
  job(
    'published-event-redelivery',
    'src/shared/outbox/published-event-redelivery.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:outbox.redeliver',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 120_000 },
  ),
  job(
    'refresh-expiring-reviews',
    'src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.refresh_sweep',
      schedule: 'every:3600000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'reconcile-missing-notifications',
    'src/contexts/feed/infrastructure/jobs/reconcile-missing-notifications.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:notification.reconcile',
      schedule: 'every:600000',
      registration: 'enabled',
    },
    { timeoutMs: 120_000 },
  ),
  job(
    'release-response-target-reminders',
    'src/contexts/inbox/infrastructure/jobs/release-response-target-reminders.job.ts',
    {
      queue: 'background',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 60_000 },
  ),
  job(
    'discover-new-reviews',
    'src/contexts/review/infrastructure/jobs/discover-new-reviews.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.discovery_sweep',
      schedule: 'every:900000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'purge-expired-reviews',
    'src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.purge',
      schedule: 'none',
      registration: 'quarantined',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'reconcile-ambiguous-publications',
    'src/contexts/review/infrastructure/jobs/reconcile-ambiguous-publications.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.reconcile',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { retryBackoff: 'exponential:300000', timeoutMs: 300_000 },
  ),
  job(
    'goal-program.maintain',
    'src/contexts/reporting/infrastructure/jobs/goal-program-maintenance.job.ts',
    {
      queue: 'background',
      capability: 'goal.use',
      action: 'system:goal.maintain',
      schedule: 'every:3600000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'retention-sweep',
    'src/shared/jobs/retention-sweep.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:retention.sweep',
      schedule: 'every:86400000,offset:10800000',
      registration: 'enabled',
    },
    { timeoutMs: 900_000 },
  ),
  job(
    'ai-operation-execution-reaper',
    'src/shared/jobs/ai-operation-execution-reaper.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:ai.execution_reap',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'ai-review-analysis-enrollment-sweep',
    'src/shared/jobs/ai-review-analysis-enrollment-sweep.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:ai.review_analysis_enrollment_sweep',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'quarantine-ttl-sweep',
    'src/shared/jobs/quarantine-ttl-sweep.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:quarantine.ttl',
      schedule: 'every:86400000,offset:14400000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'permit-start-deadline-sweep',
    'src/shared/jobs/permit-start-deadline-sweep.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:permit.start_deadline_fence',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 60_000 },
  ),
  job(
    'advance-organization-lifecycle',
    'src/contexts/identity/infrastructure/jobs/advance-organization-lifecycle.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:identity.organization_lifecycle',
      schedule: 'every:300000',
      registration: 'quarantined',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'generate-organization-export',
    'src/contexts/identity/infrastructure/jobs/generate-organization-export.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:identity.organization_export',
      schedule: 'every:60000',
      registration: 'quarantined',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'purge-expired-organization-exports',
    'src/contexts/identity/infrastructure/jobs/purge-expired-organization-exports.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:identity.organization_export',
      schedule: 'every:3600000',
      registration: 'quarantined',
    },
    { timeoutMs: 300_000 },
  ),
  job(
    'recover-invited-registrations',
    'src/contexts/identity/infrastructure/jobs/recover-invited-registrations.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:identity.accept_invitation',
      schedule: 'every:60000',
      registration: 'enabled',
    },
    { retryBackoff: 'fixed:5000', timeoutMs: 60_000 },
  ),
  job(
    'google-import-claim-reaper',
    'src/contexts/integration/infrastructure/jobs/google-import-claim-reaper.job.ts',
    {
      queue: 'background',
      capability: 'property.import_gbp_v2',
      action: 'system:property.import_claim_reap',
      schedule: 'every:60000',
      registration: 'enabled',
    },
    { retryBackoff: 'fixed:5000', timeoutMs: 60_000 },
  ),
  job(
    'digest-notification',
    'src/contexts/feed/infrastructure/jobs/digest-notification.job.ts',
    {
      queue: 'background',
      capability: 'notification.send_email',
      action: 'system:notification.email_digest',
      schedule: 'cron:0 * * * *',
      registration: 'enabled',
    },
  ),
]

export const JOB_FAMILY_ROWS: ReadonlyArray<JobFamilyRow> = [
  ...DEFAULT_QUEUE_ROWS,
  ...BACKGROUND_QUEUE_ROWS,
]

// ── Derived lookups ─────────────────────────────────────────────────

/**
 * BQC-3.6: durable consumer refs declared for an event type. The dispatcher
 * uses this to tell a misconfigured deployment (catalogue expects a consumer
 * that was never registered → fail + retry) from a family with no consumers
 * (recorded for audit only → complete).
 */
export function durableConsumersFor(eventType: string): ReadonlyArray<EventConsumerRef> {
  return EVENT_FAMILY_ROWS.find((r) => r.eventType === eventType)?.consumers ?? []
}
