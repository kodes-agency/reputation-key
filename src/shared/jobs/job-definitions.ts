// Every governed BullMQ job, defined once.
//
// The event/job catalogue (JOB_FAMILY_ROWS) and the entry-point catalogue's job
// and schedule rows are derived from this list, and so are the enqueue and
// redrive policies in ./job-policy.ts. A job's queue, processor, retry, timeout,
// cadence, capability gate, system action, scope and registration posture are
// all declared here and nowhere else.

import type { Capability } from '#/shared/domain/capability'
import type {
  EntryPointRow,
  ResourceScope,
  SystemAction,
} from '#/shared/domain/entry-point-types'

export type JobQueueName = 'default' | 'background'

/** Registration posture of a job. */
export type JobRegistration =
  | 'enabled' // real handler registered and schedulable
  | 'denied_dark' // capability dark — no-op handler registered (BQR-0 containment)
  | 'blocked_capability' // capability hard-blocked — no-op handler registered
  | 'quarantined' // safety no-op registered; scheduling/cutover explicitly denied

export type JobDefinition = Readonly<{
  /** BullMQ job name. */
  name: string
  queue: JobQueueName
  /** Repo-relative file containing the processor ('src/bootstrap.ts' for inline handlers). */
  processor: string
  /** Attempts BullMQ makes, at first enqueue and again after a redrive. */
  attempts: number
  /** Backoff class, e.g. 'exponential:30000'. */
  backoff: string
  /**
   * Per-job execution timeout. Honest values from the workload: quick
   * heartbeats 30s, GBP sync/sweeps 300s, bulk import 600s, the bounded
   * retention sweep 900s, and everything else the 120s default.
   */
  timeoutMs: number
  /** Cadence: 'none', 'every:<ms>[,offset:<ms>]', or 'cron:<pattern>'. */
  schedule: string
  /** Capability gate (registration gate, else in-handler gate); 'none' when ungated. */
  capability: Capability | 'none'
  /** System action evaluated immediately before execution. */
  action: SystemAction
  /** What the authorization decision must scope to. */
  scope: ResourceScope
  /** True when execution causes an external side effect (GBP, email, OAuth, S3). */
  externalEffect: boolean
  /** The recurring schedule's own externalEffect, when it differs from the job's. */
  scheduleExternalEffect?: boolean
  registration: JobRegistration
  /**
   * 'domain': a quarantined run converges through its owning domain state
   * machine, so an operator redrive is refused.
   */
  redrive: 'queue' | 'domain'
}>

type JobBase = Readonly<{
  queue: JobQueueName
  capability: Capability | 'none'
  action: SystemAction
  scope: ResourceScope
  externalEffect?: boolean
  scheduleExternalEffect?: boolean
  schedule: string
  registration: JobRegistration
  redrive?: 'queue' | 'domain'
}>

type JobOpts = Partial<Pick<JobDefinition, 'attempts' | 'backoff' | 'timeoutMs'>>

/** A job definition; the retry defaults are the queue's (three attempts, 30 s). */
function defineJob(
  name: string,
  processor: string,
  base: JobBase,
  opts: JobOpts = {},
): JobDefinition {
  return {
    name,
    queue: base.queue,
    processor,
    attempts: 3,
    backoff: 'exponential:30000',
    timeoutMs: 120_000,
    schedule: base.schedule,
    capability: base.capability,
    action: base.action,
    scope: base.scope,
    externalEffect: base.externalEffect ?? false,
    ...(base.scheduleExternalEffect === undefined
      ? {}
      : { scheduleExternalEffect: base.scheduleExternalEffect }),
    registration: base.registration,
    redrive: base.redrive ?? 'queue',
    ...opts,
  }
}

export const JOB_DEFINITIONS: ReadonlyArray<JobDefinition> = [
  defineJob(
    'import-gbp-property-item',
    'src/contexts/integration/infrastructure/jobs/import-gbp-property-item.job.ts',
    {
      queue: 'default',
      capability: 'property.import_gbp_v2',
      action: 'system:property.import_v2',
      scope: 'organization',
      externalEffect: true,
      schedule: 'none',
      registration: 'enabled',
      redrive: 'domain',
    },
    { attempts: 5, backoff: 'exponential:30000' },
  ),
  defineJob(
    'import-gbp-property-item-v2',
    'src/contexts/integration/infrastructure/jobs/retired-import-item.job.ts',
    {
      queue: 'default',
      capability: 'none',
      action: 'system:property.import_retired',
      scope: 'none',
      schedule: 'none',
      registration: 'quarantined',
    },
  ),
  defineJob(
    'sync-property-reviews',
    'src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts',
    {
      queue: 'default',
      capability: 'property.connect_gbp',
      action: 'system:review.sync',
      scope: 'property',
      externalEffect: true,
      schedule: 'none',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'ai-review-analysis-backlog-drain',
    'src/contexts/ai/infrastructure/jobs/drain-review-analysis-backlog.job.ts',
    {
      queue: 'background',
      capability: 'ai.analyze',
      action: 'system:ai.review_analysis_backlog_drain',
      scope: 'tenant_cross',
      schedule: 'every:5000',
      registration: 'enabled',
    },
    { backoff: 'fixed:5000', timeoutMs: 120_000 },
  ),
  // The Monday email's sweep (decision 11): hourly, it records a Guest voice summary for
  // each Property whose Monday morning it is and that has something to say. Five minutes
  // past the hour, so it does not meet the hour's other recurring work.
  defineJob(
    'ai-guest-voice-summary-sweep',
    'src/contexts/ai/infrastructure/jobs/guest-voice-summary-sweep.job.ts',
    {
      queue: 'background',
      capability: 'ai.analyze',
      action: 'system:ai.guest_voice_summary',
      scope: 'tenant_cross',
      schedule: 'every:3600000,offset:300000',
      registration: 'enabled',
    },
    { backoff: 'exponential:30000', timeoutMs: 300_000 },
  ),
  defineJob(
    'ai-review-analysis-on-demand',
    'src/contexts/ai/infrastructure/jobs/analyze-review-now.job.ts',
    {
      queue: 'default',
      capability: 'ai.analyze',
      action: 'system:ai.review_analysis_on_demand',
      scope: 'property',
      schedule: 'none',
      registration: 'enabled',
    },
    { attempts: 1, timeoutMs: 120_000 },
  ),
  defineJob(
    'expire-review-provider-source',
    'src/contexts/review/infrastructure/jobs/review-provider-lifecycle-sweeps.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.purge',
      scope: 'tenant_cross',
      schedule: 'none',
      registration: 'quarantined',
    },
    { timeoutMs: 300_000 },
  ),
  // Quarantined until a reviewed cutover: the setup checklist, Property setup and
  // Inbox response targets still read the completed snapshot runs it deletes.
  defineJob(
    'sweep-review-provider-tombstones',
    'src/contexts/review/infrastructure/jobs/review-provider-lifecycle-sweeps.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.purge',
      scope: 'tenant_cross',
      schedule: 'none',
      registration: 'quarantined',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'publish-reply',
    'src/contexts/review/infrastructure/jobs/publish-reply.job.ts',
    {
      queue: 'default',
      capability: 'property.publish_reply',
      action: 'system:reply.publish',
      scope: 'property',
      externalEffect: true,
      schedule: 'none',
      registration: 'enabled',
    },
    { attempts: 5, backoff: 'exponential:30000' },
  ),
  // Mandatory notices and the ADR 0059 report outcome have no Property. Feed
  // enforces each type's scope (notificationScopeForType) in the notification
  // and email constructors and their CHECKs; a job that carries a Property is
  // still decided at that Property.
  defineJob('urgent-email', 'src/contexts/feed/infrastructure/jobs/send-emails.job.ts', {
    queue: 'default',
    capability: 'notification.send_email',
    action: 'system:notification.email_urgent',
    scope: 'organization',
    externalEffect: true,
    schedule: 'none',
    registration: 'enabled',
  }),
  // The same processor, as its own delayed action so that it can hold its own
  // capability. `notification.send_email` is allowlisted per Organization for the
  // beta, which held back the final warning before an irreversible deletion
  // exactly where it mattered; the mandatory capability is core, so the
  // environment stop and tenant suspension still refuse it and the tenant
  // allowlist no longer does (ADR 0046).
  defineJob(
    'mandatory-email',
    'src/contexts/feed/infrastructure/jobs/send-emails.job.ts',
    {
      queue: 'default',
      capability: 'notification.send_mandatory_email',
      action: 'system:notification.email_mandatory',
      scope: 'organization',
      externalEffect: true,
      schedule: 'none',
      registration: 'enabled',
    },
  ),
  defineJob(
    'portal-approved-destination-revalidation',
    'src/contexts/portal/infrastructure/jobs/revalidate-approved-destinations.job.ts',
    {
      queue: 'background',
      capability: 'portal.write',
      action: 'system:portal.destination_revalidate',
      scope: 'tenant_cross',
      externalEffect: true,
      scheduleExternalEffect: false,
      schedule: 'every:900000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  // Not capability-gated: cleaning the object store must run whatever the state of
  // the upload capability, because it is what makes switching uploads off safe.
  defineJob(
    'portal-media-sweep',
    'src/contexts/portal/infrastructure/jobs/sweep-portal-media.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:portal.media_sweep',
      scope: 'tenant_cross',
      externalEffect: true,
      scheduleExternalEffect: false,
      schedule: 'every:3600000,offset:1800000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'health-check',
    'src/shared/jobs/health-check.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:health.check',
      scope: 'none',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 30_000 },
  ),
  defineJob(
    'refresh-expiring-reviews',
    'src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.refresh_sweep',
      scope: 'tenant_cross',
      schedule: 'every:3600000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  // Reads a Google review from Google once before it releases a reminder for
  // it, so the action has an external effect and takes a fresh policy read.
  defineJob(
    'release-response-target-reminders',
    'src/contexts/reputation/inbox/response-targets/release-reminders.job.server.ts',
    {
      queue: 'background',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      scope: 'tenant_cross',
      externalEffect: true,
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 120_000 },
  ),
  defineJob(
    'discover-new-reviews',
    'src/contexts/review/infrastructure/jobs/discover-new-reviews.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.discovery_sweep',
      scope: 'tenant_cross',
      schedule: 'every:900000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'purge-expired-reviews',
    'src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.purge',
      scope: 'tenant_cross',
      schedule: 'none',
      registration: 'quarantined',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'reconcile-ambiguous-publications',
    'src/contexts/review/infrastructure/jobs/reconcile-ambiguous-publications.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.reconcile',
      scope: 'tenant_cross',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { backoff: 'exponential:300000', timeoutMs: 300_000 },
  ),
  defineJob(
    'goal-program.maintain',
    'src/contexts/reporting/infrastructure/jobs/goal-program-maintenance.job.ts',
    {
      queue: 'background',
      capability: 'goal.use',
      action: 'system:goal.maintain',
      scope: 'tenant_cross',
      schedule: 'every:3600000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  // Daily: a rating goal's pace window slides without a new fact from Google,
  // so Below pace is found here (ADR 0067 decision 6).
  defineJob(
    'rating-goal.evaluate',
    'src/contexts/reporting/infrastructure/jobs/rating-goal-evaluation.job.ts',
    {
      queue: 'background',
      capability: 'goal.use',
      action: 'system:goal.evaluate_rating_goals',
      scope: 'tenant_cross',
      schedule: 'every:86400000,offset:7200000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'retention-sweep',
    'src/shared/jobs/retention-sweep.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:retention.sweep',
      scope: 'tenant_cross',
      schedule: 'every:86400000,offset:10800000',
      registration: 'enabled',
    },
    { timeoutMs: 900_000 },
  ),
  defineJob(
    'ai-operation-execution-reaper',
    'src/shared/jobs/ai-operation-execution-reaper.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:ai.execution_reap',
      scope: 'tenant_cross',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'merchant-ai-standing-renewal',
    'src/contexts/identity/infrastructure/jobs/merchant-ai-standing-renewal.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:identity.merchant_ai_standing_renewal',
      scope: 'tenant_cross',
      schedule: 'every:600000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'identity-pending-upload-reclaim',
    'src/contexts/identity/infrastructure/jobs/reclaim-pending-identity-uploads.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:identity.pending_upload_reclaim',
      scope: 'tenant_cross',
      schedule: 'every:3600000,offset:2700000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'ai-review-analysis-enrollment-sweep',
    'src/shared/jobs/ai-review-analysis-enrollment-sweep.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:ai.review_analysis_enrollment_sweep',
      scope: 'tenant_cross',
      schedule: 'every:60000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'quarantine-ttl-sweep',
    'src/shared/jobs/quarantine-ttl-sweep.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:quarantine.ttl',
      scope: 'tenant_cross',
      schedule: 'every:86400000,offset:14400000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000 },
  ),
  defineJob(
    'permit-start-deadline-sweep',
    'src/shared/jobs/permit-start-deadline-sweep.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:permit.start_deadline_fence',
      scope: 'tenant_cross',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { timeoutMs: 60_000 },
  ),
  defineJob(
    'recover-invited-registrations',
    'src/contexts/identity/infrastructure/jobs/recover-invited-registrations.job.ts',
    {
      queue: 'background',
      // Recovery accepts invitations: a membership is an Organization write.
      capability: 'identity.invite',
      action: 'system:identity.accept_invitation',
      scope: 'tenant_cross',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    { backoff: 'fixed:5000', timeoutMs: 60_000 },
  ),
  defineJob(
    'google-import-claim-reaper',
    'src/contexts/integration/infrastructure/jobs/google-import-claim-reaper.job.ts',
    {
      queue: 'background',
      capability: 'property.import_gbp_v2',
      action: 'system:property.import_claim_reap',
      scope: 'tenant_cross',
      schedule: 'every:60000',
      registration: 'enabled',
    },
    { backoff: 'fixed:5000', timeoutMs: 60_000 },
  ),
  defineJob(
    'reconcile-gbp-notification-subscriptions',
    'src/contexts/integration/infrastructure/jobs/reconcile-gbp-notification-subscriptions.job.ts',
    {
      queue: 'background',
      capability: 'property.connect_gbp',
      action: 'system:integration.gbp_subscription_reconcile',
      scope: 'tenant_cross',
      externalEffect: true,
      schedule: 'every:86400000',
      registration: 'enabled',
    },
    { attempts: 5, backoff: 'exponential:60000', timeoutMs: 600_000 },
  ),
  defineJob(
    'digest-notification',
    'src/contexts/feed/infrastructure/jobs/digest-notification.job.ts',
    {
      queue: 'background',
      capability: 'notification.send_email',
      action: 'system:notification.email_digest',
      scope: 'tenant_cross',
      externalEffect: true,
      scheduleExternalEffect: false,
      schedule: 'cron:0 * * * *',
      registration: 'enabled',
    },
  ),
]

// ── Projections ─────────────────────────────────────────────────────

/** A job's runtime policy as the event/job catalogue and operations read it. */
export type JobFamilyRow = Readonly<{
  /** BullMQ job name. */
  jobName: string
  /** Queue the family is enqueued on. */
  queue: JobQueueName
  /** Repo-relative file containing the processor ('src/bootstrap.ts' for inline handlers). */
  processor: string
  retryAttempts: number
  /** Backoff class, e.g. 'exponential:30000'. */
  retryBackoff: string
  /** Per-job execution timeout. */
  timeoutMs: number
  /** Cadence: 'none', 'every:<ms>[,offset:<ms>]', or 'cron:<pattern>'. */
  schedule: string
  /** Capability gate (registration gate, else in-handler gate); 'none' when ungated. */
  capability: Capability | 'none'
  /** System action, matching the entry-point catalogue row. */
  action: SystemAction
  registration: JobRegistration
}>

const jobFamilyRow = (def: JobDefinition): JobFamilyRow => ({
  jobName: def.name,
  queue: def.queue,
  processor: def.processor,
  retryAttempts: def.attempts,
  retryBackoff: def.backoff,
  timeoutMs: def.timeoutMs,
  schedule: def.schedule,
  capability: def.capability,
  action: def.action,
  registration: def.registration,
})

export const JOB_FAMILY_ROWS: ReadonlyArray<JobFamilyRow> =
  JOB_DEFINITIONS.map(jobFamilyRow)

const jobEntryPoint = (def: JobDefinition): EntryPointRow => ({
  kind: 'job',
  name: def.name,
  action: def.action,
  capability: def.capability,
  resourceScope: def.scope,
  externalEffect: def.externalEffect,
})

/** The recurring schedule a scheduled job registers in the worker. */
const scheduleEntryPoint = (def: JobDefinition): EntryPointRow => ({
  kind: 'schedule',
  name: `${def.name}-recurring`,
  action: def.action,
  capability: def.capability,
  resourceScope: def.scope,
  externalEffect: def.scheduleExternalEffect ?? def.externalEffect,
})

export const JOB_ENTRY_POINTS: ReadonlyArray<EntryPointRow> =
  JOB_DEFINITIONS.map(jobEntryPoint)

export const SCHEDULE_ENTRY_POINTS: ReadonlyArray<EntryPointRow> = JOB_DEFINITIONS.filter(
  (def) => def.schedule !== 'none',
).map(scheduleEntryPoint)
