// EntryPointCatalogue — BQC-2.1 / STD-P1-02 / SPEC-P0-03.
//
// Runtime policy data for every governed delayed entry point. The system
// execution policy and delayed execution gate read these rows and fail closed
// on an unknown job, consumer, schedule, or action.
//
// Row vocabulary:
//   kind           — job | consumer | schedule
//   action         — SystemAction evaluated immediately before execution
//   capability     — beta capability gate; 'none' when ungated
//   resourceScope  — organization | property | tenant_cross | none
//   externalEffect — whether the action requires a fresh policy read
//   name           — job, consumer module, or recurring schedule name

import type { Capability } from '#/shared/auth/beta-capabilities'

// ── Types ───────────────────────────────────────────────────────────

export type EntryPointKind = 'job' | 'consumer' | 'schedule'

/** What the authorization decision must scope to. */
export type ResourceScope =
  | 'organization'
  | 'property'
  | 'tenant_cross' // system work spanning tenants (sweeps)
  | 'none'

/** Canonical actions for session, public, delayed, and operator work. */
export type SystemAction =
  // session / identity bootstrap
  | 'system:session.read'
  | 'system:session.mutate'
  | 'system:identity.register'
  | 'system:identity.sign_in'
  | 'system:identity.password_reset'
  | 'system:identity.accept_invitation'
  | 'system:identity.create_organization'
  | 'system:identity.auth_api'
  | 'system:identity.organization_lifecycle'
  | 'system:identity.organization_export'
  // guest / public surface (dark — portal.read gated)
  | 'system:guest.portal_read'
  | 'system:guest.rating'
  | 'system:guest.feedback'
  | 'system:guest.scan'
  | 'system:guest.click_track'
  | 'public:portal.response.submit'
  | 'public:portal.response.correct'
  | 'public:portal.response.start_new'
  | 'public:portal.response.text.submit'
  | 'public:portal.response.text.withdraw'
  | 'public:portal.google_review.select'
  | 'public:portal.secondary_link.select'
  | 'public:portal.response.withdraw'
  | 'public:portal.media.issue'
  | 'public:portal.media.confirm'
  | 'public:portal.read'
  | 'public:portal.analytics.record'
  | 'public:notification.email_unsubscribe'
  // machine ingress
  | 'system:integration.google_callback'
  | 'system:integration.gbp_webhook'
  // UI rendering (page-level; data gated by server functions)
  | 'system:ui.render'
  // delayed/system execution
  | 'system:health.check'
  | 'system:portal.health_reconcile'
  | 'system:portal.destination_revalidate'
  | 'system:property.import'
  | 'system:property.import_v2'
  | 'system:review.sync'
  | 'system:review.refresh_sweep'
  | 'system:review.discovery_sweep'
  | 'system:review.purge'
  | 'system:review.reconcile'
  | 'system:reply.publish'
  | 'system:metric.refresh'
  | 'system:metric.record'
  | 'system:metric.record_guest_analytics'
  | 'system:metric.record_public_reputation'
  | 'system:metric.record_portal_workflow'
  | 'system:retention.sweep'
  | 'system:quarantine.ttl'
  | 'system:ai.execution_reap'
  | 'system:ai.review_analysis_enrollment_sweep'
  | 'system:permit.start_deadline_fence'
  | 'system:property.import_claim_reap'
  | 'system:goal.reconcile'
  | 'system:goal.spawn'
  | 'system:goal.progress'
  | 'system:goal.maintain'
  | 'system:activity.record'
  | 'system:notification.insert'
  | 'system:notification.insert_goal'
  | 'system:notification.insert_portal'
  | 'system:notification.insert_property_responsibility'
  | 'system:notification.email_urgent'
  | 'system:notification.email_digest'
  | 'system:notification.delivery_event'
  | 'system:notification.reconcile'
  | 'system:inbox.update'
  | 'system:inbox.project_guest_feedback'
  | 'system:ai.trend'
  | 'system:ai.trend_schedule'
  // operator commands
  | 'system:ops'

export type EntryPointRow = Readonly<{
  kind: EntryPointKind
  name: string
  action: SystemAction
  capability: Capability | 'none'
  resourceScope: ResourceScope
  /** True when execution causes an external side effect (GBP, email, OAuth, S3). */
  externalEffect: boolean
}>

// ── Row factories (records of functions — no classes) ───────────────

function row(
  kind: EntryPointKind,
  name: string,
  action: SystemAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  externalEffect = false,
): EntryPointRow {
  return { kind, name, action, capability, resourceScope, externalEffect }
}

/** BullMQ job. */
const job = (
  name: string,
  action: SystemAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  externalEffect = false,
): EntryPointRow => row('job', name, action, capability, resourceScope, externalEffect)

/** Event consumer module. */
const consumer = (
  name: string,
  action: SystemAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  externalEffect = false,
): EntryPointRow =>
  row('consumer', name, action, capability, resourceScope, externalEffect)

/** Recurring schedule registered in the worker. */
const schedule = (
  name: string,
  action: SystemAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  externalEffect = false,
): EntryPointRow =>
  row('schedule', name, action, capability, resourceScope, externalEffect)

// ── The catalogue ───────────────────────────────────────────────────

const JOB_ROWS: ReadonlyArray<EntryPointRow> = [
  job(
    'portal-approved-destination-revalidation',
    'system:portal.destination_revalidate',
    'portal.write',
    'tenant_cross',
    true,
  ),
  job('health-check', 'system:health.check', 'none', 'none'),
  job(
    'import-gbp-property-item-v2',
    'system:property.import_v2',
    'property.import_gbp_v2',
    'organization',
    true,
  ),
  job(
    'sync-property-reviews',
    'system:review.sync',
    'property.connect_gbp',
    'property',
    true,
  ),
  job('generate-property-ai-trend', 'system:ai.trend', 'ai.detect_trends', 'property'),
  job(
    'schedule-property-ai-trends',
    'system:ai.trend_schedule',
    'ai.detect_trends',
    'tenant_cross',
  ),
  job('refresh-expiring-reviews', 'system:review.refresh_sweep', 'none', 'tenant_cross'),
  job(
    'reconcile-missing-notifications',
    'system:notification.reconcile',
    'none',
    'tenant_cross',
  ),
  job(
    'release-response-target-reminders',
    'system:inbox.update',
    'inbox.use',
    'tenant_cross',
  ),
  job('discover-new-reviews', 'system:review.discovery_sweep', 'none', 'tenant_cross'),
  job('purge-expired-reviews', 'system:review.purge', 'none', 'tenant_cross'),
  job('expire-review-provider-source', 'system:review.purge', 'none', 'tenant_cross'),
  job('sweep-review-provider-tombstones', 'system:review.purge', 'none', 'tenant_cross'),
  job(
    'publish-reply',
    'system:reply.publish',
    'property.publish_reply',
    'property',
    true,
  ),
  job(
    'reconcile-ambiguous-publications',
    'system:review.reconcile',
    'none',
    'tenant_cross',
  ),
  job('goal-program.maintain', 'system:goal.maintain', 'goal.use', 'tenant_cross'),
  job('retention-sweep', 'system:retention.sweep', 'none', 'tenant_cross'),
  job('quarantine-ttl-sweep', 'system:quarantine.ttl', 'none', 'tenant_cross'),
  job(
    'ai-operation-execution-reaper',
    'system:ai.execution_reap',
    'none',
    'tenant_cross',
  ),
  job(
    'ai-review-analysis-enrollment-sweep',
    'system:ai.review_analysis_enrollment_sweep',
    'none',
    'tenant_cross',
  ),
  job(
    'permit-start-deadline-sweep',
    'system:permit.start_deadline_fence',
    'none',
    'tenant_cross',
  ),
  job(
    'advance-organization-lifecycle',
    'system:identity.organization_lifecycle',
    'none',
    'tenant_cross',
  ),
  job(
    'generate-organization-export',
    'system:identity.organization_export',
    'none',
    'tenant_cross',
    true,
  ),
  job(
    'purge-expired-organization-exports',
    'system:identity.organization_export',
    'none',
    'tenant_cross',
    true,
  ),
  job(
    'recover-invited-registrations',
    'system:identity.accept_invitation',
    'none',
    'tenant_cross',
  ),
  job(
    'google-import-claim-reaper',
    'system:property.import_claim_reap',
    'property.import_gbp_v2',
    'tenant_cross',
  ),
  job('project-recent-activity', 'system:activity.record', 'none', 'organization'),
  job('insert-activity-log', 'system:activity.record', 'none', 'organization'),
  job('insert-notification', 'system:notification.insert', 'none', 'property'),
  job(
    'urgent-email',
    'system:notification.email_urgent',
    'notification.send_email',
    'property',
    true,
  ),
  job(
    'digest-notification',
    'system:notification.email_digest',
    'notification.send_email',
    'tenant_cross',
    true,
  ),
]

const CONSUMER_ROWS: ReadonlyArray<EntryPointRow> = [
  consumer(
    'review.outbox-consumers',
    'system:reply.publish',
    'property.publish_reply',
    'property',
  ),
  consumer(
    'portal.health-outbox-consumers',
    'system:portal.health_reconcile',
    'portal.write',
    'property',
  ),
  consumer('inbox.outbox-consumers', 'system:inbox.update', 'none', 'organization'),
  consumer(
    'inbox.guest-feedback',
    'system:inbox.project_guest_feedback',
    'portal.read',
    'organization',
  ),
  consumer(
    'notification.outbox-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.identity-account-outbox-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.workflow-outbox-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.bulk-assignment-outbox-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.escalation-resolution-outbox-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.handling-cycle-outbox-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.response-target-outbox-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.goal-outbox-consumers',
    'system:notification.insert_goal',
    'goal.use',
    'property',
  ),
  consumer(
    'notification.on-google-reauthorization-required',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.portal-outbox-consumers',
    'system:notification.insert_portal',
    'portal.write',
    'property',
  ),
  consumer(
    'notification.portal-health-outbox-consumers',
    'system:notification.insert_portal',
    'portal.write',
    'property',
  ),
  consumer(
    'notification.property-outbox-consumers',
    'system:notification.insert_property_responsibility',
    'property.create',
    'property',
  ),
  consumer(
    'integration.property-import-dispatch',
    'system:property.import_v2',
    'property.import_gbp_v2',
    'organization',
  ),
  consumer(
    'integration.google-review-push-dispatch',
    'system:review.sync',
    'property.connect_gbp',
    'property',
    true,
  ),
  consumer(
    'property.import-retention-release',
    'system:property.import_v2',
    'property.import_gbp_v2',
    'organization',
  ),
  consumer('ai.outbox-consumers', 'system:ai.trend', 'ai.detect_trends', 'property'),
  consumer('activity.outbox-consumers', 'system:activity.record', 'none', 'organization'),
  consumer(
    'goal.metric-correction-reconciliation',
    'system:goal.maintain',
    'goal.use',
    'property',
  ),
  consumer(
    'metric.portal-workflow',
    'system:metric.record_portal_workflow',
    'portal.write',
    'organization',
  ),
  consumer(
    'metric.public-reputation',
    'system:metric.record_public_reputation',
    'none',
    'organization',
  ),
  consumer(
    'metric.current-google-reputation',
    'system:metric.record_public_reputation',
    'none',
    'organization',
  ),
  consumer(
    'metric.guest-analytics',
    'system:metric.record_guest_analytics',
    'portal.read',
    'organization',
  ),
  consumer(
    'metric.correction-reconciliation',
    'system:metric.record',
    'none',
    'organization',
  ),
]

const SCHEDULE_ROWS: ReadonlyArray<EntryPointRow> = [
  schedule(
    'portal-approved-destination-revalidation-recurring',
    'system:portal.destination_revalidate',
    'portal.write',
    'tenant_cross',
  ),
  schedule('health-check-recurring', 'system:health.check', 'none', 'none'),
  schedule(
    'schedule-property-ai-trends-recurring',
    'system:ai.trend_schedule',
    'ai.detect_trends',
    'tenant_cross',
  ),
  schedule(
    'refresh-expiring-reviews-recurring',
    'system:review.refresh_sweep',
    'none',
    'tenant_cross',
  ),
  schedule(
    'discover-new-reviews-recurring',
    'system:review.discovery_sweep',
    'none',
    'tenant_cross',
  ),
  schedule(
    'reconcile-missing-notifications-recurring',
    'system:notification.reconcile',
    'none',
    'tenant_cross',
  ),
  schedule(
    'release-response-target-reminders-recurring',
    'system:inbox.update',
    'inbox.use',
    'tenant_cross',
  ),
  schedule(
    'reconcile-ambiguous-publications-recurring',
    'system:review.reconcile',
    'none',
    'tenant_cross',
  ),
  schedule('retention-sweep-recurring', 'system:retention.sweep', 'none', 'tenant_cross'),
  schedule(
    'quarantine-ttl-sweep-recurring',
    'system:quarantine.ttl',
    'none',
    'tenant_cross',
  ),
  schedule(
    'ai-operation-execution-reaper-recurring',
    'system:ai.execution_reap',
    'none',
    'tenant_cross',
  ),
  schedule(
    'ai-review-analysis-enrollment-sweep-recurring',
    'system:ai.review_analysis_enrollment_sweep',
    'none',
    'tenant_cross',
  ),
  schedule(
    'permit-start-deadline-sweep-recurring',
    'system:permit.start_deadline_fence',
    'none',
    'tenant_cross',
  ),
  schedule(
    'advance-organization-lifecycle-recurring',
    'system:identity.organization_lifecycle',
    'none',
    'tenant_cross',
  ),
  schedule(
    'generate-organization-export-recurring',
    'system:identity.organization_export',
    'none',
    'tenant_cross',
    true,
  ),
  schedule(
    'purge-expired-organization-exports-recurring',
    'system:identity.organization_export',
    'none',
    'tenant_cross',
    true,
  ),
  schedule(
    'recover-invited-registrations-recurring',
    'system:identity.accept_invitation',
    'none',
    'tenant_cross',
  ),
  schedule(
    'google-import-claim-reaper-recurring',
    'system:property.import_claim_reap',
    'property.import_gbp_v2',
    'tenant_cross',
  ),
  schedule(
    'goal-program.maintain-recurring',
    'system:goal.maintain',
    'goal.use',
    'tenant_cross',
  ),
  schedule(
    'digest-notification-recurring',
    'system:notification.email_digest',
    'notification.send_email',
    'tenant_cross',
  ),
]

export const ENTRY_POINT_CATALOGUE: ReadonlyArray<EntryPointRow> = [
  ...JOB_ROWS,
  ...CONSUMER_ROWS,
  ...SCHEDULE_ROWS,
]
