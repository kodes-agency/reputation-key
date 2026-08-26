// EventJobCatalogue — BQC-3.1.
//
// The canonical family catalogue for every domain event type and every
// BullMQ job family in the system (phase BQC-3 §3.1). The guard test
// (event-job-catalogue.test.ts) fails when an emitted `_tag` or a registered
// job exists without a family row — or when a row drifts from what the code
// actually does (producer file, schema registration, consumer wiring,
// capability gate, schedule).
//
// Row vocabulary:
//   disposition   — enabled | orphan | quarantined | denied_dark (event families)
//   registration  — enabled | denied_dark | blocked_capability | quarantined
//                   (job families)
//   capability    — the beta capability gate (ADR 0032); 'none' when ungated
//   action        — SystemAction of the producing path; 'none' for
//                   user-permission producers
//   ordering      — per-aggregate policy; the model is DEFINED below (BQC-3.7)
//   region        — 'unscoped' today; BQC-4 owns re-scoping
//   repairCommand — 'none' where no repair exists; BQC-3.3/3.4 introduced
//   reconcileReplyPublication (review family) and rebuildInboxProjection
//   (inbox family)
//
// ORDERING MODEL (BQC-3.7 — the definition; do not promise more than this):
//   - Per-aggregate chronological enqueue: the relay claims outbox rows in
//     created_at order, so events for one aggregate enter the domain-events
//     queue in emission order.
//   - NO global ordering: events across aggregates interleave arbitrarily.
//   - NO execution-order guarantee: the dispatcher runs with concurrency 20,
//     so per-aggregate events may execute out of order or in parallel.
//     Correctness rests on state-idempotent consumers (projections converge
//     to the same state) + receipt fencing (eventId+consumerName), not on
//     order.
//   - Aggregate-version fencing is implemented only by families that stamp
//     sourceAggregateVersion (Portal lifecycle facts use the committed
//     updatedAt instant). Every other family remains unfenced today.
//     When a family needs strict per-aggregate sequencing, add version
//     fencing at the consumer; do NOT rely on enqueue order.
//
// Delivery policy is derived, never hand-set: idempotencyKey follows the
// durable-consumer/recording shape, retention follows recordedInOutbox, and
// consumer-ref dark posture follows the module path. The guard re-derives
// all of it from the authoritative capability sets and the code.

import type { Capability } from '#/shared/auth/beta-capabilities'
import type { SystemAction } from './entry-point-catalogue'

// ── Types ───────────────────────────────────────────────────────────

/** Lifecycle disposition of an event family. */
export type EventDisposition =
  | 'enabled' // produced and consumed today
  | 'orphan' // produced but never consumed — owned by a later BQC slice
  | 'quarantined' // retained schema/producer code, but no active runtime producer or consumer
  | 'denied_dark' // belongs to a dark beta context (capability-gated off)

/** How a consumer is wired to the event. */
export type EventConsumerKind =
  | 'bus' // in-process event-bus `.on(...)` handler
  | 'durable' // outbox registerConsumer (receipt-idempotent)

/** A consumer of an event family, pinned to its handler module. */
export type EventConsumerRef = Readonly<{
  /** Consumer name, e.g. 'inbox.on-review-created' (durable) or '<context>.event-handlers' (bus). */
  name: string
  /** Repo-relative file containing the handler registration. */
  module: string
  kind: EventConsumerKind
  /** denied_dark when the consuming module belongs to a dark context. */
  disposition: 'enabled' | 'denied_dark'
}>

export type EventFamilyRow = Readonly<{
  /** The event type (`_tag` literal). */
  eventType: string
  /** Schema version; 1 for every family today. */
  version: number
  /** Repo-relative file containing the emission. */
  producer: string
  /** Extra files emitting the same type, when any. */
  alsoProducers?: ReadonlyArray<string>
  /** Context that owns the event's state. */
  stateOwner: string
  /** True when a Zod schema is registered in schema-registrations.ts. */
  schemaRegistered: boolean
  /** True when a producer path records to the outbox (false when producers only eventBus.emit). */
  recordedInOutbox: boolean
  consumers: ReadonlyArray<EventConsumerRef>
  /** Context owning the primary projection of this event, or 'none'. */
  projectionOwner: string
  /**
   * Ordering policy: per-aggregate chronological enqueue (created_at claim
   * order) + state-idempotent consumers + receipt fencing. BQC-3.7 defines
   * the model in the header above — global ordering is explicitly NOT
   * promised and dispatcher concurrency means NO execution-order guarantee.
   */
  ordering: 'per_aggregate'
  /**
   * Deduplication key: 'eventId+consumerName' for durably consumed,
   * 'eventId' for recorded-only, 'none' for bus-only families.
   */
  idempotencyKey: 'eventId+consumerName' | 'eventId' | 'none'
  /** Governing beta capability; 'none' when ungated. */
  capability: Capability | 'none'
  /** System action of the producing path, or 'none' for user-permission producers. */
  action: SystemAction | 'none'
  /** Data region. BQC-4 owns re-scoping; everything is 'unscoped' today. */
  region: 'unscoped'
  /** Retention class: 'outbox:7d,receipts:90d' when recorded, else 'none'. */
  retention: 'outbox:7d,receipts:90d' | 'none'
  /** Operator repair command. BQC-3.3/3.4 introduced reconcileReplyPublication/rebuildInboxProjection; 'none' elsewhere. */
  repairCommand: 'none' | 'rebuildInboxProjection' | 'reconcileReplyPublication'
  disposition: EventDisposition
  /** Owning slice — required when disposition is 'orphan' or 'quarantined'. */
  ownerSlice?: 'BQC-3.3' | 'BQC-3.4' | 'BQC-3.5' | 'BQC-3.9' | 'F7' | 'PPL-01' | 'PR3'
  notes?: string
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
   * BQC-3.6: per-job execution timeout (BullMQ JobsOptions.timeout). Honest
   * values from the workload: quick heartbeats 30s, GBP sync/sweeps/rollups
   * 300s, bulk import 600s, the bounded retention sweep 900s, everything else
   * the 120s default. jobEnqueueOptions (shared/jobs/job-policy.ts) derives
   * the BullMQ opts from these fields.
   */
  timeoutMs: number
  /** Cadence: 'none', 'every:<ms>[,offset:<ms>]', or 'cron:<pattern>'. */
  schedule: string
  /** Capability gate (registration gate, else in-handler gate); 'none' when ungated. */
  capability: Capability | 'none'
  /** System action, matching the entry-point catalogue row. */
  action: SystemAction | 'none'
  /** Data region. BQC-4 owns re-scoping. */
  region: 'unscoped'
  /** BullMQ retention (removeOnComplete/removeOnFail counts). */
  retention: 'completed:100,failed:50'
  /** Operator repair command. BQC-3.4/3.6 introduce repair commands; 'none' today. */
  repairCommand: 'none'
  registration: JobRegistration
  notes?: string
}>

// ── Row factories (records of functions — no classes) ───────────────

const DARK_CONTEXT_MODULE_RE = /\/contexts\/(team|portal|guest|goal|badge|leaderboard)\//

/** Consumer ref; dark posture derived from the module path. */
function ref(name: string, module: string, kind: EventConsumerKind): EventConsumerRef {
  return {
    name,
    module,
    kind,
    disposition: DARK_CONTEXT_MODULE_RE.test(module) ? 'denied_dark' : 'enabled',
  }
}

/** In-process bus consumer ('<context>.event-handlers'). */
const bus = (name: string, module: string): EventConsumerRef => ref(name, module, 'bus')

/** Durable outbox consumer ('<context>.<handler-name>'). */
const durable = (name: string, module: string): EventConsumerRef =>
  ref(name, module, 'durable')

type EventBase = Readonly<{
  stateOwner: string
  capability: Capability | 'none'
  action: SystemAction | 'none'
  schemaRegistered: boolean
  recordedInOutbox: boolean
  consumers: ReadonlyArray<EventConsumerRef>
  disposition: EventDisposition
}>

type EventOpts = Partial<
  Pick<
    EventFamilyRow,
    'alsoProducers' | 'projectionOwner' | 'ownerSlice' | 'notes' | 'repairCommand'
  >
>

/** Event family row; delivery policy derived from recording + consumers. */
function ev(
  eventType: string,
  producer: string,
  base: EventBase,
  opts: EventOpts = {},
): EventFamilyRow {
  const durableConsumed = base.consumers.some((c) => c.kind === 'durable')
  return {
    eventType,
    version: 1,
    producer,
    stateOwner: base.stateOwner,
    schemaRegistered: base.schemaRegistered,
    recordedInOutbox: base.recordedInOutbox,
    consumers: base.consumers,
    projectionOwner: 'none',
    ordering: 'per_aggregate',
    idempotencyKey: durableConsumed
      ? 'eventId+consumerName'
      : base.recordedInOutbox
        ? 'eventId'
        : 'none',
    capability: base.capability,
    action: base.action,
    region: 'unscoped',
    retention: base.recordedInOutbox ? 'outbox:7d,receipts:90d' : 'none',
    repairCommand: 'none',
    disposition: base.disposition,
    ...opts,
  }
}

type JobBase = Readonly<{
  queue: 'default' | 'background'
  capability: Capability | 'none'
  action: SystemAction | 'none'
  schedule: string
  registration: JobRegistration
}>

type JobOpts = Partial<
  Pick<JobFamilyRow, 'retryAttempts' | 'retryBackoff' | 'timeoutMs' | 'notes'>
>

/** Job family row; retry/retention defaults baked from the queue factory. */
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
    region: 'unscoped',
    retention: 'completed:100,failed:50',
    repairCommand: 'none',
    registration: base.registration,
    ...opts,
  }
}

// ── Consumer modules ────────────────────────────────────────────────

const ACTIVITY_HANDLERS = 'src/contexts/activity/infrastructure/event-handlers/index.ts'
const NOTIFICATION_HANDLERS =
  'src/contexts/notification/infrastructure/event-handlers/index.ts'
const NOTIFICATION_PORTAL_HANDLERS =
  'src/contexts/notification/infrastructure/event-handlers/portal-event-handlers.ts'
const NOTIFICATION_PROPERTY_HANDLERS =
  'src/contexts/notification/infrastructure/event-handlers/property-event-handlers.ts'
const INBOX_HANDLERS = 'src/contexts/inbox/infrastructure/event-handlers/index.ts'
const METRIC_HANDLERS = 'src/contexts/metric/infrastructure/event-handlers/index.ts'
const METRIC_OUTBOX = 'src/contexts/metric/infrastructure/outbox-consumers.ts'
const METRIC_GUEST_OUTBOX = 'src/contexts/metric/infrastructure/guest-outbox-consumers.ts'
const METRIC_CORRECTION_OUTBOX =
  'src/contexts/metric/infrastructure/correction-outbox-consumers.ts'
const GOAL_HANDLERS = 'src/contexts/goal/infrastructure/event-handlers/index.ts'
const BADGE_HANDLERS = 'src/contexts/badge/infrastructure/event-handlers/index.ts'
const LEADERBOARD_HANDLERS =
  'src/contexts/leaderboard/infrastructure/event-handlers/index.ts'
const REVIEW_HANDLERS = 'src/contexts/review/infrastructure/event-handlers/index.ts'
const REVIEW_OUTBOX = 'src/contexts/review/infrastructure/outbox-consumers.ts'
const INBOX_OUTBOX = 'src/contexts/inbox/infrastructure/outbox-consumers.ts'
const INBOX_GUEST_FEEDBACK_OUTBOX =
  'src/contexts/inbox/infrastructure/guest-feedback-outbox-consumers.ts'
const AI_OUTBOX = 'src/contexts/ai/infrastructure/outbox-consumers.ts'
const PROPERTY_RETENTION_OUTBOX =
  'src/contexts/property/infrastructure/outbox-consumers.ts'
const INTEGRATION_IMPORT_OUTBOX =
  'src/contexts/integration/infrastructure/outbox-consumers.ts'
const NOTIFICATION_OUTBOX = 'src/contexts/notification/infrastructure/outbox-consumers.ts'
const NOTIFICATION_WORKFLOW_OUTBOX =
  'src/contexts/notification/infrastructure/workflow-outbox-consumers.ts'
const NOTIFICATION_PORTAL_OUTBOX =
  'src/contexts/notification/infrastructure/portal-outbox-consumers.ts'
const NOTIFICATION_PROPERTY_OUTBOX =
  'src/contexts/notification/infrastructure/property-outbox-consumers.ts'

// ── Event families ──────────────────────────────────────────────────

const REVIEW_EVENTS = 'src/contexts/review/domain/events.ts'
const INBOX_EVENTS = 'src/contexts/inbox/domain/events.ts'
const IDENTITY_EVENTS = 'src/contexts/identity/domain/events.ts'
const PROPERTY_EVENTS = 'src/contexts/property/domain/events.ts'
const TEAM_EVENTS = 'src/contexts/team/domain/events.ts'
const STAFF_EVENTS = 'src/contexts/staff/domain/events.ts'
const PORTAL_EVENTS = 'src/contexts/portal/domain/events.ts'
const PORTAL_OUTBOX = 'src/contexts/portal/infrastructure/outbox-consumers.ts'
const GUEST_EVENTS = 'src/contexts/guest/domain/events.ts'
const INTEGRATION_EVENTS = 'src/contexts/integration/domain/events.ts'
const METRIC_EVENTS = 'src/contexts/metric/domain/events.ts'
const GOAL_EVENTS = 'src/contexts/goal/domain/events.ts'
const BADGE_EVENTS = 'src/contexts/badge/domain/events.ts'
const AI_EVENTS = 'src/contexts/ai/domain/events.ts'

const REVIEW_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'review.created',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.connect_gbp',
      action: 'system:review.sync',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('inbox.event-handlers', INBOX_HANDLERS),
        bus('metric.event-handlers', METRIC_HANDLERS),
        durable('inbox.on-review-created', INBOX_OUTBOX),
        durable('ai.analyze-review-event', AI_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      projectionOwner: 'inbox',
      repairCommand: 'reconcileReplyPublication',
      notes:
        'atomic command-store outbox write (BQR-2.3); durable dispatch disabled (BQR-0 containment)',
    },
  ),
  ev(
    'review.updated',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.connect_gbp',
      action: 'system:review.sync',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        durable('inbox.on-review-updated', INBOX_OUTBOX),
        durable('ai.analyze-review-event', AI_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      projectionOwner: 'inbox',
      repairCommand: 'reconcileReplyPublication',
      notes:
        'BQC-3.4 resolved the BQC-3.1 orphan: metadata-only projection refresh (sourceDate/platform) via the inbox command store; durable dispatch disabled (BQR-0 containment)',
    },
  ),
  ev(
    'review.source_transitioned',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.connect_gbp',
      action: 'system:review.sync',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [durable('ai.analyze-review-event', AI_OUTBOX)],
      disposition: 'enabled',
    },
    {
      notes:
        'identifier-only source_expired/provider_deleted transition consumed by the ordered AI review-analysis cursor',
    },
  ),
  ev(
    'ai.property_trend.generation_requested',
    AI_EVENTS,
    {
      stateOwner: 'ai',
      capability: 'ai.detect_trends',
      action: 'system:ai.trend',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [durable('ai.generate-property-trend', AI_OUTBOX)],
      disposition: 'enabled',
    },
    {
      projectionOwner: 'ai',
      notes:
        'identifier-only schedule request emitted atomically with a fenced property trend schedule',
    },
  ),
  ev(
    'ai.review_analysis.backfill_requested',
    AI_EVENTS,
    {
      stateOwner: 'ai',
      capability: 'ai.analyze',
      action: 'system:ops',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [durable('ai.analyze-review-event', AI_OUTBOX)],
      disposition: 'enabled',
    },
    {
      notes:
        'identifier-only operator replay (ops:ai-reanalyze) carrying a FRESH contiguous analysis sequence; deliberately NOT a re-emitted review.created/updated, which the inbox also consumes',
    },
  ),
  ev(
    'review.expired',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'none',
      action: 'system:review.purge',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('inbox.event-handlers', INBOX_HANDLERS),
        durable('inbox.on-review-expired', INBOX_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      projectionOwner: 'inbox',
      repairCommand: 'reconcileReplyPublication',
      notes:
        'atomic review delete + outbox write via ReplyCommandStore.purgeExpiredReview (BQC-3.3); durable dispatch disabled (BQR-0 containment)',
    },
  ),
  ev(
    'review.reply.submitted',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.publish_reply',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable('notification.on-review-reply-submitted', NOTIFICATION_WORKFLOW_OUTBOX),
        bus('inbox.event-handlers', INBOX_HANDLERS),
      ],
      disposition: 'enabled',
    },
    {
      projectionOwner: 'inbox',
      repairCommand: 'reconcileReplyPublication',
      notes: 'atomic command-store outbox write (BQC-3.3 ReplyCommandStore)',
    },
  ),
  ev(
    'review.reply.approved',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.publish_reply',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable('notification.on-review-reply-approved', NOTIFICATION_WORKFLOW_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'reconcileReplyPublication',
      notes:
        'atomic command-store outbox write (BQC-3.3); the lifecycle fact is paired with an explicit cycle-fenced publication intent in the same transaction',
    },
  ),
  ev(
    'review.reply.publication_requested',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.publish_reply',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [durable('review.on-reply-publication-requested', REVIEW_OUTBOX)],
      disposition: 'enabled',
    },
    {
      repairCommand: 'reconcileReplyPublication',
      notes:
        'identifier-only recovery intent committed with the authorized reply cycle; the worker reloads current state and only admits that exact cycle under a deterministic reply+cycle job id',
    },
  ),
  ev(
    'review.reply.rejected',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.publish_reply',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable('notification.on-review-reply-rejected', NOTIFICATION_WORKFLOW_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'reconcileReplyPublication',
      notes: 'atomic command-store outbox write (BQC-3.3 ReplyCommandStore)',
    },
  ),
  ev(
    'review.reply.published',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.publish_reply',
      action: 'system:reply.publish',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable('notification.on-review-reply-published', NOTIFICATION_WORKFLOW_OUTBOX),
        bus('inbox.event-handlers', INBOX_HANDLERS),
        durable('inbox.on-reply-published', INBOX_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      projectionOwner: 'inbox',
      repairCommand: 'reconcileReplyPublication',
      notes:
        'atomic command-store outbox write (BQC-3.3 ReplyCommandStore); BQC-3.4 durable milestone/auto-close consumer co-commits state + receipt',
    },
  ),
  ev(
    'review.reply.publish_failed',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.publish_reply',
      action: 'system:reply.publish',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable(
          'notification.on-review-reply-publish_failed',
          NOTIFICATION_WORKFLOW_OUTBOX,
        ),
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'reconcileReplyPublication',
      notes:
        'atomic command-store outbox write (BQC-3.3); ambiguous outcomes reconcile via reconcileReplyPublication',
    },
  ),
  ev(
    'review.reply.publication_cancelled',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.publish_reply',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      repairCommand: 'reconcileReplyPublication',
      notes:
        'BQC-3.8: disconnect/policy cancellation of an in-flight publication (requested/authorized/sending → cancelled, reply back to draft for re-approval); atomic per-batch write + fact via ReplyCommandStore.cancelPublications',
    },
  ),
  ev(
    'review.reply.updated',
    REVIEW_EVENTS,
    {
      stateOwner: 'review',
      capability: 'property.publish_reply',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      repairCommand: 'reconcileReplyPublication',
      notes:
        "edit-and-republish: a published reply's text was edited and re-entered the durable publication machine (published → approved, fresh cycle); atomic write + lifecycle fact + explicit cycle-fenced publication intent via ReplyCommandStore.editPublishedReply; the provider upsert (GBP) makes republish non-duplicating",
    },
  ),
]

const INBOX_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'inbox.inbox_item.created',
    INBOX_EVENTS,
    {
      stateOwner: 'inbox',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable('notification.on-inbox-item-created', NOTIFICATION_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes:
        'atomic command-store outbox write (BQC-3.4 InboxCommandStore); the durable notification consumer is the at-least-once path for "a review arrived" — the bus handler alone was best-effort, and reconcile-missing-notifications heals what either path drops',
    },
  ),
  ev(
    'inbox.inbox_item.status_changed',
    INBOX_EVENTS,
    {
      stateOwner: 'inbox',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes: 'atomic command-store outbox write (BQC-3.4 InboxCommandStore)',
    },
  ),
  ev(
    'inbox.inbox_item.assigned',
    INBOX_EVENTS,
    {
      stateOwner: 'inbox',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable(
          'notification.on-inbox-inbox_item-assigned',
          NOTIFICATION_WORKFLOW_OUTBOX,
        ),
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes:
        'atomic command-store outbox write (BQC-3.4); schema corrected in place at v1 (never recorded — zero historical rows)',
    },
  ),
  ev(
    'inbox.inbox_item.unassigned',
    INBOX_EVENTS,
    {
      stateOwner: 'inbox',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes:
        'atomic command-store outbox write (BQC-3.4); schema corrected in place at v1 (never recorded — zero historical rows)',
    },
  ),
  ev(
    'inbox.inbox_item.escalated',
    INBOX_EVENTS,
    {
      stateOwner: 'inbox',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable(
          'notification.on-inbox-inbox_item-escalated',
          NOTIFICATION_WORKFLOW_OUTBOX,
        ),
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes:
        'atomic command-store outbox write (BQC-3.4); schema corrected in place at v1 (never recorded — zero historical rows)',
    },
  ),
  ev(
    'inbox.inbox_item.escalation_resolved',
    INBOX_EVENTS,
    {
      stateOwner: 'inbox',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes:
        'atomic command-store outbox write (BQC-3.4); schema corrected in place at v1 (never recorded — zero historical rows)',
    },
  ),
  ev(
    'inbox.inbox_note.added',
    INBOX_EVENTS,
    {
      stateOwner: 'inbox',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('notification.event-handlers', NOTIFICATION_HANDLERS),
        durable('notification.on-inbox-inbox_note-added', NOTIFICATION_WORKFLOW_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes:
        'atomic command-store outbox write (BQC-3.4); carries noteId, never text; schema corrected in place at v1 (never recorded — zero historical rows)',
    },
  ),
  ev(
    'inbox.inbox_item.bulk_status_changed',
    INBOX_EVENTS,
    {
      stateOwner: 'inbox',
      capability: 'inbox.use',
      action: 'system:inbox.update',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes:
        'atomic command-store outbox write (BQC-3.4); per-item shape linked by bulkId; schema corrected in place at v1 (never recorded — zero historical rows)',
    },
  ),
]

const IDENTITY_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'identity.organization.created',
    IDENTITY_EVENTS,
    {
      stateOwner: 'identity',
      capability: 'organization.create',
      action: 'system:identity.create_organization',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); BQC-3.9 consumed the BQC-3.1 orphan — activity audit consumer',
    },
  ),
  ev(
    'identity.member.invited',
    IDENTITY_EVENTS,
    {
      stateOwner: 'identity',
      capability: 'identity.invite',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    { notes: 'atomic command-store outbox write (BQC-3.5)' },
  ),
  ev(
    'identity.invitation.accepted',
    IDENTITY_EVENTS,
    {
      stateOwner: 'identity',
      capability: 'none',
      action: 'system:identity.accept_invitation',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    { notes: 'atomic command-store outbox write (BQC-3.5)' },
  ),
  ev(
    'identity.invitation.canceled',
    IDENTITY_EVENTS,
    {
      stateOwner: 'identity',
      capability: 'identity.invite',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    { notes: 'atomic command-store outbox write (BQC-3.5)' },
  ),
  ev(
    'identity.member.removed',
    IDENTITY_EVENTS,
    {
      stateOwner: 'identity',
      capability: 'identity.invite',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    { notes: 'atomic command-store outbox write (BQC-3.5)' },
  ),
  ev(
    'identity.member.role_changed',
    IDENTITY_EVENTS,
    {
      stateOwner: 'identity',
      capability: 'identity.invite',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); schema gained memberUserId in place at v1 (target id was silently stripped; never recorded — zero historical rows)',
    },
  ),
  ev(
    'identity.merchant_ai.changed',
    IDENTITY_EVENTS,
    {
      stateOwner: 'identity',
      capability: 'ai.analyze',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'orphan',
    },
    {
      ownerSlice: 'PR3',
      notes:
        'identifier-only Merchant AI authorization lineage/epoch transition; PR3 consumes it into the AI control plane',
    },
  ),
]

const PROPERTY_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'property.created',
    PROPERTY_EVENTS,
    {
      stateOwner: 'property',
      capability: 'property.create',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); activity records the creation fact while v2 import effects enqueue initial review sync only after receipt-backed Property reconciliation',
    },
  ),
  ev(
    'property.updated',
    PROPERTY_EVENTS,
    {
      stateOwner: 'property',
      capability: 'property.create',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); BQC-3.9 consumed the BQC-3.1 orphan — activity audit consumer',
    },
  ),
  ev(
    'property.deleted',
    PROPERTY_EVENTS,
    {
      stateOwner: 'property',
      capability: 'property.create',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); BQC-3.9 consumed the BQC-3.1 orphan — activity audit consumer',
    },
  ),
  ev(
    'property.google_binding.changed',
    PROPERTY_EVENTS,
    {
      stateOwner: 'property',
      capability: 'property.import_gbp_v2',
      action: 'system:property.import_v2',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'orphan',
    },
    {
      ownerSlice: 'F7',
      notes:
        'identifier-only Property binding lifecycle fact; authorization consumers are added before protected import dispatch is enabled',
    },
  ),
  ev(
    'property.responsibility_became_needed',
    PROPERTY_EVENTS,
    {
      stateOwner: 'property',
      capability: 'property.create',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('notification.property-event-handlers', NOTIFICATION_PROPERTY_HANDLERS),
        durable(
          'notification.on-property-responsibility-needed',
          NOTIFICATION_PROPERTY_OUTBOX,
        ),
      ],
      disposition: 'enabled',
    },
    {
      notes:
        'identifier-only transition fact; one content-free recovery alert per current AccountAdmin, with deterministic queue deduplication',
    },
  ),
]

const TEAM_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'team.created',
    TEAM_EVENTS,
    {
      stateOwner: 'team',
      capability: 'team.use',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'denied_dark',
    },
    {
      notes:
        'quarantined producer retained for reconciliation history; no runtime consumer',
    },
  ),
  ev('team.updated', TEAM_EVENTS, {
    stateOwner: 'team',
    capability: 'team.use',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('team.deleted', TEAM_EVENTS, {
    stateOwner: 'team',
    capability: 'team.use',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
]

const STAFF_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'staff.assigned',
    STAFF_EVENTS,
    {
      stateOwner: 'staff',
      capability: 'staff.use',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'quarantined',
    },
    {
      ownerSlice: 'PPL-01',
      notes:
        'quarantined legacy StaffAssignment producer retained for reconciliation; no runtime endpoint or consumer',
    },
  ),
  ev(
    'staff.unassigned',
    STAFF_EVENTS,
    {
      stateOwner: 'staff',
      capability: 'staff.use',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'quarantined',
    },
    {
      ownerSlice: 'PPL-01',
      notes:
        'quarantined legacy StaffAssignment producer retained for reconciliation; no runtime endpoint or consumer',
    },
  ),
]

const PORTAL_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'portal.created',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.read',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'denied_dark',
    },
    {
      notes:
        'identifier-only Portal lifecycle fact; state, initial responsibility, and required fact set commit atomically',
    },
  ),
  ev(
    'portal.updated',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.read',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'denied_dark',
    },
    {
      notes:
        'identifier-only version-fenced lifecycle fact; Portal patch and fact commit atomically',
    },
  ),
  ev(
    'portal.hero_image.processing_requested',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.upload',
      action: 'system:image.process',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [durable('portal.process-issued-hero-image', PORTAL_OUTBOX)],
      disposition: 'denied_dark',
    },
    {
      notes:
        'atomic issuance-consumption hand-off; content-free payload binds image reads to the exact verified source ETag',
    },
  ),
  ev(
    'portal.responsibility_became_needed',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.write',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('notification.portal-event-handlers', NOTIFICATION_PORTAL_HANDLERS),
        durable(
          'notification.on-portal-responsibility-needed',
          NOTIFICATION_PORTAL_OUTBOX,
        ),
      ],
      disposition: 'denied_dark',
    },
    {
      notes:
        'identifier-only transition fact; one content-free recovery alert per AccountAdmin, with deterministic queue deduplication',
    },
  ),
  ev('portal.content_review.completed', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'system:metric.record_portal_workflow',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [
      bus('metric.event-handlers', METRIC_HANDLERS),
      durable('metric.portal-workflow', METRIC_OUTBOX),
    ],
    disposition: 'denied_dark',
  }),
  ev('portal.configuration_completeness.recorded', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'system:metric.record_portal_workflow',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [
      bus('metric.event-handlers', METRIC_HANDLERS),
      durable('metric.portal-workflow', METRIC_OUTBOX),
    ],
    disposition: 'denied_dark',
  }),
  ev('portal.approved_destination_ratio.recorded', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'system:metric.record_portal_workflow',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [
      bus('metric.event-handlers', METRIC_HANDLERS),
      durable('metric.portal-workflow', METRIC_OUTBOX),
    ],
    disposition: 'denied_dark',
  }),
  ev(
    'portal.deleted',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.read',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('goal.event-handlers', GOAL_HANDLERS)],
      disposition: 'denied_dark',
    },
    {
      notes:
        'Portal soft-delete, live-token revocation, and their identifier-only facts commit atomically; goal cleanup consumer is itself dark',
    },
  ),
  ev(
    'portal.token.issued',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.write',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'denied_dark',
    },
    { notes: 'identifier-only public-token lifecycle fact' },
  ),
  ev(
    'portal.token.rotated',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.write',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'denied_dark',
    },
    { notes: 'identifier-only public-token lifecycle fact with bounded grace period' },
  ),
  ev(
    'portal.token.revoked',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.write',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [],
      disposition: 'denied_dark',
    },
    {
      notes:
        'identifier-only lifecycle fact; operator-entered reason remains in Portal storage',
    },
  ),
  ev('portal_link_category.created', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_link_category.reordered', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_link.created', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_link.reordered', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_group.created', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_group.updated', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev(
    'portal_group.deleted',
    PORTAL_EVENTS,
    {
      stateOwner: 'portal',
      capability: 'portal.read',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('goal.event-handlers', GOAL_HANDLERS)],
      disposition: 'denied_dark',
    },
    { notes: 'goal cleanup consumer is itself dark' },
  ),
  ev('portal_group.portal_added', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_group.portal_removed', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.write',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [],
    disposition: 'denied_dark',
  }),
]

const GUEST_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'guest.scan.recorded',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.scan',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('metric.event-handlers', METRIC_HANDLERS),
        durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
      ],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'metric',
      notes:
        'identifier-only v1 schema; session-deduplicated scan row and fact commit atomically through GuestObservationStore; durable metric consumer is recovery authority',
    },
  ),
  ev(
    'guest.rating.submitted',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.rating',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('metric.event-handlers', METRIC_HANDLERS),
        durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
      ],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'metric',
      notes:
        'identifier/numeric-only v1 schema; canonical Guest response and fact commit atomically through GuestResponseCommandStore; durable metric consumer is recovery authority',
    },
  ),
  ev(
    'guest.rating.retracted',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.rating',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('metric.event-handlers', METRIC_HANDLERS),
        durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
      ],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'metric',
      notes:
        'identifier-only retraction committed atomically with correction/withdrawal; Metric appends correction facts and never converts retraction to zero',
    },
  ),
  ev(
    'guest.feedback.submitted',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.feedback',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('inbox.event-handlers', INBOX_HANDLERS),
        bus('metric.event-handlers', METRIC_HANDLERS),
        durable('inbox.on-guest-feedback-submitted', INBOX_GUEST_FEEDBACK_OUTBOX),
        durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
      ],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'inbox',
      notes:
        'content-free v1 payload committed atomically with the canonical Guest response; durable Inbox and metric projections recover independently',
    },
  ),
  ev(
    'guest.feedback.retracted',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.feedback',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('inbox.event-handlers', INBOX_HANDLERS),
        bus('metric.event-handlers', METRIC_HANDLERS),
        durable('inbox.on-guest-feedback-retracted', INBOX_GUEST_FEEDBACK_OUTBOX),
        durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
      ],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'inbox',
      notes:
        'identifier-only private-feedback retraction; Inbox closes the work item and Metric corrects the count without receiving text/contact',
    },
  ),
  ev(
    'guest.review_link.clicked',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.click_track',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('metric.event-handlers', METRIC_HANDLERS),
        durable('metric.guest-analytics', METRIC_GUEST_OUTBOX),
      ],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'metric',
      notes:
        'identifier-only v1 schema with Google-versus-secondary destination kind; legacy missing kinds decode as secondary; the outbox row is canonical and commits before best-effort bus acceleration',
    },
  ),
]

const INTEGRATION_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'integration.google_account.connected',
    INTEGRATION_EVENTS,
    {
      stateOwner: 'integration',
      capability: 'integration.use',
      action: 'system:integration.google_callback',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); identifier-only schema excludes provider contact data',
    },
  ),
  ev(
    'integration.google_account.disconnected',
    INTEGRATION_EVENTS,
    {
      stateOwner: 'integration',
      capability: 'integration.use',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('activity.event-handlers', ACTIVITY_HANDLERS),
        bus('review.event-handlers', REVIEW_HANDLERS),
      ],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); registered with identifier-only allowlist — was unregistered/bus-only; BQC-3.8: review consumer cancels in-flight reply publications for the connection',
    },
  ),
  ev(
    'integration.property_import.requested',
    INTEGRATION_EVENTS,
    {
      stateOwner: 'integration',
      capability: 'property.import_gbp_v2',
      action: 'system:property.import_v2',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        durable('integration.property-import-dispatch', INTEGRATION_IMPORT_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      notes:
        'identifier-only transactional intent; durable consumer add-bulks deterministic revision-scoped item jobs',
    },
  ),
  ev(
    'integration.property_import.retention_released',
    INTEGRATION_EVENTS,
    {
      stateOwner: 'integration',
      capability: 'property.import_gbp_v2',
      action: 'system:property.import_v2',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        durable('property.import-retention-release', PROPERTY_RETENTION_OUTBOX),
      ],
      disposition: 'enabled',
    },
    {
      projectionOwner: 'property',
      notes:
        'bounded import-parent purge release; Property atomically marks matching operation receipts releasable and records the event consumer receipt',
    },
  ),
  ev(
    'integration.google_connection.visibility_changed',
    INTEGRATION_EVENTS,
    {
      stateOwner: 'integration',
      capability: 'integration.use',
      action: 'none',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); BQC-3.9 consumed the BQC-3.1 orphan — activity audit consumer',
    },
  ),
]

const METRIC_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'metric.recorded',
    METRIC_EVENTS,
    {
      stateOwner: 'metric',
      capability: 'metric.internal',
      action: 'system:metric.record',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [
        bus('goal.event-handlers', GOAL_HANDLERS),
        bus('badge.event-handlers', BADGE_HANDLERS),
        bus('leaderboard.event-handlers', LEADERBOARD_HANDLERS),
      ],
      disposition: 'enabled',
    },
    {
      notes:
        "records via the atomic metric command store (BQC-3.5); schema corrected in place at v1 — the registered recordedAt never matched the domain event's occurredAt and the build never wired outboxRepo (zero historical rows); consumers belong to the dark goal/badge/leaderboard contexts; the family itself is enabled",
    },
  ),
  ev(
    'metric.corrected',
    METRIC_EVENTS,
    {
      stateOwner: 'metric',
      capability: 'metric.internal',
      action: 'system:metric.record',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [durable('metric.correction-reconciliation', METRIC_CORRECTION_OUTBOX)],
      disposition: 'enabled',
    },
    { notes: 'append-only correction lineage advances the reconciliation watermark' },
  ),
]

const GOAL_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'goal.completed',
    GOAL_EVENTS,
    {
      stateOwner: 'goal',
      capability: 'goal.use',
      action: 'system:goal.progress',
      schemaRegistered: true,
      recordedInOutbox: false,
      consumers: [bus('notification.event-handlers', NOTIFICATION_HANDLERS)],
      disposition: 'denied_dark',
    },
    {
      notes:
        'schema registered but the producer only eventBus.emit — never recorded in the outbox; dark context',
    },
  ),
]

const BADGE_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev(
    'badge.awarded',
    BADGE_EVENTS,
    {
      stateOwner: 'badge',
      capability: 'badge.use',
      action: 'system:badge.evaluate',
      schemaRegistered: false,
      recordedInOutbox: false,
      consumers: [bus('notification.event-handlers', NOTIFICATION_HANDLERS)],
      disposition: 'denied_dark',
    },
    { notes: 'no schema registered; dark context' },
  ),
]

export const EVENT_FAMILY_ROWS: ReadonlyArray<EventFamilyRow> = [
  ...REVIEW_ROWS,
  ...INBOX_ROWS,
  ...IDENTITY_ROWS,
  ...PROPERTY_ROWS,
  ...TEAM_ROWS,
  ...STAFF_ROWS,
  ...PORTAL_ROWS,
  ...GUEST_ROWS,
  ...INTEGRATION_ROWS,
  ...METRIC_ROWS,
  ...GOAL_ROWS,
  ...BADGE_ROWS,
]

// ── Job families ────────────────────────────────────────────────────

const DEFAULT_QUEUE_ROWS: ReadonlyArray<JobFamilyRow> = [
  job(
    'process-image',
    'src/contexts/portal/infrastructure/jobs/process-image.job.ts',
    {
      queue: 'default',
      capability: 'portal.upload',
      action: 'system:image.process',
      schedule: 'none',
      registration: 'blocked_capability',
    },
    {
      notes:
        'Issuance-only private read and derived writes; stale-fenced; always registered and capability-scoped at dispatch/execution',
    },
  ),
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
    {
      retryAttempts: 5,
      retryBackoff: 'exponential:30000',
      notes:
        'GBP import v2 per-item work; deterministic item/retry/fence job id, tenant-keyed routing, and fenced Property effects',
    },
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
    {
      timeoutMs: 300_000,
      notes:
        'GBP review sync; in-handler gate; enqueued manual/cron/webhook/sweep; paged GBP fetch warrants 5m',
    },
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
    {
      retryBackoff: 'exponential:30000',
      notes:
        'content-free coalesced property trend generation after durable review analysis',
    },
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
    {
      retryBackoff: 'fixed:5000',
      timeoutMs: 30_000,
      notes:
        'DB-fenced property-local calendar scheduler; scans at most 100 due properties per firing',
    },
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
    {
      timeoutMs: 300_000,
      notes:
        'SAFE-03 validates and drains legacy raw-source expiry continuations without repository mutation; REV-01 owns activation',
    },
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
    {
      timeoutMs: 300_000,
      notes:
        'bounded 100-row provider-correlation tombstone continuation; initial activation is owned by the later lifecycle release automation',
    },
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
    {
      retryBackoff: 'exponential:5000',
      notes:
        'GBP reply publish; in-handler gate; BQC-3.3 outcome classification — terminal 4xx → publish_failed (no retry burn), 5xx/network retry, ambiguous final → publish_failed + reconcile; BQC-3.8 durable claim (publication_state) + disconnect race guard',
    },
  ),
  job(
    'insert-activity-log',
    'src/contexts/activity/infrastructure/jobs/insert-activity-log.job.ts',
    {
      queue: 'default',
      capability: 'none',
      action: 'system:activity.record',
      schedule: 'none',
      registration: 'enabled',
    },
    { notes: 'enqueued by 29 activity event handlers' },
  ),
  job(
    'insert-notification',
    'src/contexts/notification/infrastructure/jobs/insert-notification.job.ts',
    {
      queue: 'default',
      capability: 'none',
      action: 'system:notification.insert',
      schedule: 'none',
      registration: 'enabled',
    },
    { notes: 'DB insert + email-queue rows; enqueued by 11 notification event handlers' },
  ),
  job(
    'urgent-email',
    'src/contexts/notification/infrastructure/jobs/urgent-email.job.ts',
    {
      queue: 'default',
      capability: 'notification.send_email',
      action: 'system:notification.email_urgent',
      schedule: 'none',
      registration: 'enabled',
    },
    {
      notes:
        'Resend-compatible send; capability-gated at execution and routed to the local mail stub in acceptance',
    },
  ),
]

const BACKGROUND_QUEUE_ROWS: ReadonlyArray<JobFamilyRow> = [
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
    {
      timeoutMs: 30_000,
      notes:
        'Redis heartbeat stamp for /api/health/metrics; two probes + one write — 30s is generous',
    },
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
    {
      timeoutMs: 300_000,
      notes:
        'BQC-1.5 bounded sweep (500×10, cursor in review_refresh_runs); enqueues gated sync jobs; 5m bounds a stalled batch',
    },
  ),
  job(
    'reconcile-missing-notifications',
    'src/contexts/notification/infrastructure/jobs/reconcile-missing-notifications.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:notification.reconcile',
      schedule: 'every:600000',
      registration: 'enabled',
    },
    {
      timeoutMs: 120_000,
      notes:
        'notification-gap healing sweep (100x5, keyset on inbox_items (created_at, id), 24h lookback, 5m grace); the live at-least-once repair for "a review arrived but nobody was told" while OUTBOX_DISPATCHER_ENABLED is false. Only enqueues items with ZERO notification rows, so a re-run cannot coalesce a second arrival onto an existing unread row',
    },
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
    {
      timeoutMs: 300_000,
      notes:
        'new-review discovery sweep (200×10, keyset on property id, per-property due times in review_sync_state.next_incremental_at); enqueues gated sync jobs — the ONLY ingestion path for a new review while GBP push is unconfigured; capability none + distinct tenant-cross action for the same reason as reconcile-ambiguous-publications (property-scoped system:review.sync would missing_scope-deny this sweep)',
    },
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
    {
      timeoutMs: 300_000,
      notes:
        'SAFE-03 no-mutation handler; recurring scheduler reconciled away until REV-01 stable-identity cutover',
    },
  ),
  job(
    'reconcile-ambiguous-publications',
    'src/contexts/review/infrastructure/jobs/reconcile-ambiguous-publications.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.reconcile',
      schedule: 'every:1800000',
      registration: 'enabled',
    },
    {
      retryBackoff: 'exponential:300000',
      timeoutMs: 300_000,
      notes:
        'BQC-3.8 ambiguous-outcome sweep (500×10, keyset on reconcile_due_at); per-row provider re-read via reconcileReplyPublication — never a send; throws on any row failure; 5m bounds a stalled batch',
    },
  ),
  job(
    'refresh-daily-metrics',
    'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:metric.refresh',
      schedule: 'cron:0 * * * *',
      registration: 'enabled',
    },
    { timeoutMs: 300_000, notes: 'incremental rollup; 5m bounds a stalled refresh' },
  ),
  job(
    'refresh-weekly-metrics',
    'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:metric.refresh',
      schedule: 'every:86400000',
      registration: 'enabled',
    },
    { timeoutMs: 300_000, notes: 'incremental rollup; 5m bounds a stalled refresh' },
  ),
  job(
    'refresh-daily-inbox-metrics',
    'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:metric.refresh',
      schedule: 'cron:5 * * * *',
      registration: 'enabled',
    },
    { timeoutMs: 300_000, notes: 'incremental rollup; 5m bounds a stalled refresh' },
  ),
  job(
    'goal-program.maintain',
    'src/contexts/goal/infrastructure/jobs/goal-program-maintenance.job.ts',
    {
      queue: 'background',
      capability: 'goal.use',
      action: 'system:goal.maintain',
      schedule: 'every:3600000',
      registration: 'enabled',
    },
    {
      timeoutMs: 300_000,
      notes:
        'canonical monthly Goal Program lifecycle; property-local boundaries and DB idempotency fence the hourly tenant-cross sweep, while each discovered property is freshly authorized',
    },
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
    {
      timeoutMs: 900_000,
      notes:
        '17 static rules plus Google import lifecycle (incl. per-entry cache expiry, 24h/7d guest pseudonym redaction, and 365d audit evidence); separate deletion/redaction counts in retention_runs; throws on any subject failure; 15m bounds the full daily sweep',
    },
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
    {
      timeoutMs: 300_000,
      notes:
        'Abandoned-execution recovery: an operation whose owner died between claimExecution and its terminal write stays executing forever and claim refuses expired rows, so nothing else can ever finish it. Registered unconditionally — a killed AI runtime is exactly when executions are abandoned.',
    },
  ),
  job(
    'ai-review-analysis-backfill-advance',
    'src/shared/jobs/ai-review-analysis-backfill-advance.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:ai.review_analysis_backfill_advance',
      schedule: 'every:300000',
      registration: 'enabled',
    },
    {
      timeoutMs: 300_000,
      notes:
        'Safety net for the one-review-at-a-time backfill chain: re-drives a run whose hand-off was lost, terminal-settles an item whose redelivery has stopped, and closes a run whose epoch/watermark fence moved. Registered unconditionally — a dark AI runtime is when a run is most likely to be left open with a moved watermark.',
    },
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
    {
      timeoutMs: 300_000,
      notes:
        'BQC-7.8: dead-letter lifecycle bound — job.remove() per expired entry (never obliterate/clean), capped per run, evidence subject quarantine.ttl',
    },
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
    {
      timeoutMs: 60_000,
      notes:
        'ADR 0050 execution-permit lifecycle: CASes admitted -> fenced past start_deadline_at via the domain helper fenceElapsedStartDeadlinePermit (never a raw UPDATE); bounded 200-row oldest-first batch per run; unblocks ON DELETE RESTRICT approval rotation and deflates the active-permit index',
    },
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
    {
      retryBackoff: 'fixed:5000',
      timeoutMs: 60_000,
      notes:
        'claim-lease recovery: items still processing past claim_lease_expires_at are released via releaseClaimForRetry, or terminalized temporarily_unavailable once the attempt budget is spent — always through the store CAS helpers, never a raw UPDATE; bounded 100-row oldest-lease-first batch, so recovery is bounded by the 60s lease instead of the effect deadline',
    },
  ),
  job(
    'digest-notification',
    'src/contexts/notification/infrastructure/jobs/digest-notification.job.ts',
    {
      queue: 'background',
      capability: 'notification.send_email',
      action: 'system:notification.email_digest',
      schedule: 'cron:0 * * * *',
      registration: 'enabled',
    },
    {
      notes:
        'Hourly tick sends at org 8am local (ADR 0011); every delivery rechecks notification.send_email',
    },
  ),
  job(
    'leaderboard.reconcile',
    'src/bootstrap.ts',
    {
      queue: 'background',
      capability: 'leaderboard.use',
      action: 'system:leaderboard.reconcile',
      schedule: 'cron:30 * * * *',
      registration: 'blocked_capability',
    },
    {
      notes:
        'legacy ranking job retained as a no-op registration; beta capability is unconditionally blocked',
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
 * uses this to tell a misconfigured deployment (catalogue expects a durable
 * consumer that was never registered → fail + retry) from a genuinely
 * bus-only family (no durable dispatch expected → complete).
 */
export function durableConsumersFor(eventType: string): ReadonlyArray<EventConsumerRef> {
  const row = EVENT_FAMILY_ROWS.find((r) => r.eventType === eventType)
  return row?.consumers.filter((c) => c.kind === 'durable') ?? []
}
