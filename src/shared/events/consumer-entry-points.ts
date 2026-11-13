// The authorization policy of every registered consumer module, defined once.
//
// Each row is the `module` a registerConsumer call names: its action, capability
// gate, scope and external effect. The entry-point catalogue's consumer rows and
// the delayed execution gate read this table; every durable consumer in
// ./consumer-definitions.ts names one of these rows.

import type { Capability } from '#/shared/domain/capability'
import type {
  EntryPointRow,
  ResourceScope,
  SystemAction,
} from '#/shared/domain/entry-point-types'

/** A consumer module's policy row. */
const consumer = (
  name: string,
  action: SystemAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  externalEffect = false,
): EntryPointRow => ({
  kind: 'consumer',
  name,
  action,
  capability,
  resourceScope,
  externalEffect,
})

export const CONSUMER_ENTRY_POINTS: ReadonlyArray<EntryPointRow> = [
  // Provider admission happens in the handler so a temporary refusal remains
  // retryable rather than permanently settling the connection fact.
  consumer(
    'integration.google-category-refresh',
    'system:integration.refresh_google_categories',
    'none',
    'organization',
    true,
  ),
  consumer(
    'review.outbox-consumers',
    'system:reply.publish',
    'property.publish_reply',
    'property',
  ),
  // Cancelling a disconnected connection's reply publications is cleanup:
  // ungated, because a denied consumer is never retried, and scoped to the
  // Organization, because the disconnect fact carries no Property.
  consumer(
    'review.connection-lifecycle',
    'system:review.cancel_connection_publications',
    'none',
    'organization',
  ),
  // Cancelling an archived Property's queued reply publications is cleanup as
  // well: ungated, because a denied consumer is never retried and a stop on
  // `property.publish_reply` is exactly when a queued reply must not be left
  // waiting, and scoped to the one Property the lifecycle fact names.
  consumer(
    'review.property-lifecycle',
    'system:review.cancel_property_publications',
    'none',
    'property',
  ),
  consumer(
    'portal.health-outbox-consumers',
    'system:portal.health_reconcile',
    'portal.write',
    'property',
  ),
  consumer(
    'portal.property-lifecycle',
    'system:portal.responsibility_reannounce',
    'portal.write',
    'property',
  ),
  // Releasing what a removed member still holds is cleanup: ungated, because a
  // denied consumer is never retried, and scoped to the Organization, because
  // the removal fact carries no Property.
  consumer(
    'portal.member-offboarding',
    'system:portal.release_member_responsibility',
    'none',
    'organization',
  ),
  consumer(
    'inbox.member-offboarding',
    'system:inbox.release_member_assignments',
    'none',
    'organization',
  ),
  // A role change's cleanup: what the member may no longer be responsible for.
  consumer(
    'identity.member-role-cleanup',
    'system:identity.member_role_cleanup',
    'none',
    'organization',
  ),
  // Google authority a departing or demoted AccountAdmin held: fence and
  // cancel. No provider call, and a denied consumer is never retried.
  consumer(
    'integration.member-departure',
    'system:integration.release_member_google_authority',
    'none',
    'organization',
  ),
  // Its own action: 'system:inbox.update' is the tenant-cross reminder sweep.
  // 'inbox.use' is the gate the shared action has always applied here.
  consumer(
    'inbox.outbox-consumers',
    'system:inbox.project_review',
    'inbox.use',
    'organization',
  ),
  consumer(
    'inbox.guest-feedback',
    'system:inbox.project_guest_feedback',
    'portal.read',
    'organization',
  ),
  // Cancelling an archived Property's Response Target reminders is cleanup:
  // ungated, because a denied consumer is never retried, and scoped to the
  // one Property the lifecycle fact names.
  consumer(
    'inbox.property-lifecycle',
    'system:inbox.cancel_property_reminders',
    'none',
    'property',
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
  // The release fact spans Properties and carries none on its envelope, so
  // this row is Organization-scoped like its siblings.
  consumer(
    'notification.assignment-release-outbox-consumers',
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
  // Settling touches only Feed's own rows for one resource, in the
  // Organization the envelope names, and queues nothing: ungated like the
  // other notification consumers, and Organization-scoped because the
  // resource's notices may sit under any of that Organization's Properties.
  consumer(
    'notification.settlement-outbox-consumers',
    'system:notification.settle',
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
  // The Property Google rating goal's notices, under the same Goal switch.
  consumer(
    'notification.rating-goal-notice-consumers',
    'system:notification.insert_goal',
    'goal.use',
    'property',
  ),
  // The Monday email: one notice per Property per Monday the AI context found something to
  // say. It reads the Property's managers and queues the insert, so it is ungated and
  // Organization-scoped like its siblings.
  consumer(
    'notification.ai-guest-voice-summary-notice-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  // The Urgent alert: one notice per review revision an AI analysis found Urgent. It
  // reads the Inbox and queues the insert; the analysis behind it has passed every AI
  // gate already, so the route itself is ungated and Organization-scoped like its
  // siblings.
  consumer(
    'notification.ai-urgent-review-notice-consumers',
    'system:notification.insert',
    'none',
    'organization',
  ),
  consumer(
    'notification.on-google-reauthorization-required',
    'system:notification.insert',
    'none',
    'organization',
  ),
  // The disconnect fact carries no Property — the connection is the
  // Organization's — so this row must be Organization-scoped or the gate
  // denies it `missing_scope` before the handler runs.
  consumer(
    'notification.on-google-account-disconnected',
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
    'notification.portal-destination-outbox-consumers',
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
  // The import summary is decided at the Property whose history was imported,
  // and gated on the import capability itself: an Organization that cannot run
  // a Google import has no import to be told about.
  consumer(
    'notification.review-import-outbox-consumers',
    'system:notification.insert_review_import',
    'property.import_gbp_v2',
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
  // Releasing what a removed member still holds is cleanup: ungated, because a
  // denied consumer is never retried, and scoped to the Organization, because
  // the removal fact carries no Property.
  consumer(
    'property.member-offboarding',
    'system:property.release_member_responsibility',
    'none',
    'organization',
  ),
  // The analysis consumer records that a review is owed an analysis: ungated,
  // because a denied consumer is never retried and a review that arrives
  // during a stop must be analysed once the stop is lifted. It never analyses
  // a stopped review itself: before a provider call on delivery it asks
  // current policy about the review's Organization and Property (the
  // backlog-drain job's own question) and queues a refused review in the
  // backlog. The provider work stays gated on ai.analyze there, by the
  // backlog-drain and on-demand jobs. Each AI consumer has its own row, so one
  // capability's stop never obsoletes another's deliveries.
  consumer(
    'ai.review-analysis-consumers',
    'system:ai.review_analysis_event',
    'none',
    'property',
  ),
  // Enrollment records a merchant's enable, disable or revoke: ungated,
  // because a denied consumer is never retried and that record must survive
  // any stop. The provider work it leads to is gated on ai.analyze as the
  // analysis consumer's is.
  consumer(
    'ai.review-analysis-enrollment',
    'system:ai.review_analysis_enrollment',
    'none',
    'property',
  ),
  consumer('activity.outbox-consumers', 'system:activity.record', 'none', 'organization'),
  // Its own action: 'system:goal.maintain' is the tenant-cross hourly sweep.
  consumer(
    'goal.metric-correction-reconciliation',
    'system:goal.reconcile',
    'goal.use',
    'property',
  ),
  // Evaluates a Property's Google rating goal (reached, ended, status) when
  // Review verifies Google's numbers; a reconciliation of Goal state.
  consumer(
    'goal.google-rating-evaluation',
    'system:goal.reconcile',
    'goal.use',
    'property',
  ),
  // Ending an archived Property's Google rating goal is cleanup: ungated,
  // because a denied consumer is never retried and a stop on goal.use must
  // not leave the goal running, and scoped to the one Property the fact names.
  consumer(
    'goal.property-lifecycle',
    'system:goal.end_archived_property_goal',
    'none',
    'property',
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
]
