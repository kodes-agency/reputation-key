// The vocabulary of a governed entry point: its kind, scope, action and row shape.
// The job and consumer definitions and the entry-point catalogue share it.

import type { Capability } from '#/shared/domain/capability'

export type EntryPointKind = 'job' | 'consumer' | 'schedule'

/** What the authorization decision must scope to. */
export type ResourceScope =
  | 'organization'
  | 'property'
  | 'tenant_cross' // system work spanning tenants (sweeps)
  | 'none'

/** Canonical actions for session, public, delayed, and operator work. */
export type SystemAction =
  | 'system:integration.refresh_google_categories'
  | 'system:identity.merchant_ai_standing_renewal'
  | 'system:identity.pending_upload_reclaim'
  // session / identity bootstrap
  | 'system:session.read'
  | 'system:session.mutate'
  | 'system:identity.register'
  | 'system:identity.sign_in'
  | 'system:identity.password_reset'
  | 'system:identity.accept_invitation'
  | 'system:identity.create_organization'
  | 'system:identity.auth_api'
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
  | 'system:portal.responsibility_reannounce'
  | 'system:portal.release_member_responsibility'
  | 'system:identity.member_role_cleanup'
  | 'system:inbox.release_member_assignments'
  | 'system:integration.release_member_google_authority'
  | 'system:portal.destination_revalidate'
  | 'system:portal.media_sweep'
  | 'system:property.import_v2'
  | 'system:property.release_member_responsibility'
  | 'system:review.sync'
  | 'system:review.refresh_sweep'
  | 'system:review.discovery_sweep'
  | 'system:review.purge'
  | 'system:review.reconcile'
  | 'system:review.cancel_connection_publications'
  | 'system:review.cancel_property_publications'
  | 'system:reply.publish'
  | 'system:metric.record_guest_analytics'
  | 'system:metric.record_public_reputation'
  | 'system:retention.sweep'
  | 'system:quarantine.ttl'
  | 'system:ai.execution_reap'
  | 'system:ai.review_analysis_enrollment_sweep'
  | 'system:ai.review_analysis_backlog_drain'
  | 'system:ai.guest_voice_summary'
  | 'system:ai.review_analysis_on_demand'
  | 'system:ai.review_analysis_event'
  | 'system:ai.review_analysis_enrollment'
  | 'system:permit.start_deadline_fence'
  | 'system:property.import_claim_reap'
  | 'system:property.import_retired'
  | 'system:integration.gbp_subscription_reconcile'
  | 'system:goal.reconcile'
  | 'system:goal.maintain'
  | 'system:goal.evaluate_rating_goals'
  | 'system:goal.end_archived_property_goal'
  | 'system:activity.record'
  | 'system:notification.insert'
  | 'system:notification.insert_goal'
  | 'system:notification.insert_portal'
  | 'system:notification.insert_property_responsibility'
  | 'system:notification.insert_review_import'
  | 'system:notification.email_urgent'
  | 'system:notification.email_mandatory'
  | 'system:notification.email_digest'
  | 'system:notification.settle'
  | 'system:inbox.update'
  | 'system:inbox.project_review'
  | 'system:inbox.project_guest_feedback'
  | 'system:inbox.cancel_property_reminders'
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
