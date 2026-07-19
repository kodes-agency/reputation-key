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
//   disposition   — enabled | orphan | denied_dark (event families)
//   registration  — enabled | denied_dark | blocked_capability (job families)
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
//   - Aggregate-version fencing is NOT implemented: no event family versions
//     its aggregate today (envelope.sourceAggregateVersion is always null).
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
  /** Owning slice — required when disposition is 'orphan'. */
  ownerSlice?: 'BQC-3.3' | 'BQC-3.4' | 'BQC-3.5' | 'BQC-3.9'
  notes?: string
}>

/** Registration posture of a job family. */
export type JobRegistration =
  | 'enabled' // real handler registered and schedulable
  | 'denied_dark' // capability dark — no-op handler registered (BQR-0 containment)
  | 'blocked_capability' // capability hard-blocked — no-op handler registered

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
   * 300s, bulk import 600s, the 9-rule retention sweep 900s, everything else
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
const INBOX_HANDLERS = 'src/contexts/inbox/infrastructure/event-handlers/index.ts'
const METRIC_HANDLERS = 'src/contexts/metric/infrastructure/event-handlers/index.ts'
const GOAL_HANDLERS = 'src/contexts/goal/infrastructure/event-handlers/index.ts'
const BADGE_HANDLERS = 'src/contexts/badge/infrastructure/event-handlers/index.ts'
const LEADERBOARD_HANDLERS =
  'src/contexts/leaderboard/infrastructure/event-handlers/index.ts'
const REVIEW_HANDLERS = 'src/contexts/review/infrastructure/event-handlers/index.ts'
const INBOX_OUTBOX = 'src/contexts/inbox/infrastructure/outbox-consumers.ts'

// ── Event families ──────────────────────────────────────────────────

const REVIEW_EVENTS = 'src/contexts/review/domain/events.ts'
const INBOX_EVENTS = 'src/contexts/inbox/domain/events.ts'
const IDENTITY_EVENTS = 'src/contexts/identity/domain/events.ts'
const PROPERTY_EVENTS = 'src/contexts/property/domain/events.ts'
const TEAM_EVENTS = 'src/contexts/team/domain/events.ts'
const STAFF_EVENTS = 'src/contexts/staff/domain/events.ts'
const PORTAL_EVENTS = 'src/contexts/portal/domain/events.ts'
const GUEST_EVENTS = 'src/contexts/guest/domain/events.ts'
const INTEGRATION_EVENTS = 'src/contexts/integration/domain/events.ts'
const METRIC_EVENTS = 'src/contexts/metric/domain/events.ts'
const GOAL_EVENTS = 'src/contexts/goal/domain/events.ts'
const BADGE_EVENTS = 'src/contexts/badge/domain/events.ts'

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
      consumers: [durable('inbox.on-review-updated', INBOX_OUTBOX)],
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
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'reconcileReplyPublication',
      notes:
        'atomic command-store outbox write (BQC-3.3); the committed approved fact is the publish recovery record until BQC-3.8',
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
      consumers: [bus('notification.event-handlers', NOTIFICATION_HANDLERS)],
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
        "edit-and-republish: a published reply's text was edited and re-entered the durable publication machine (published → approved, fresh cycle); atomic write + fact via ReplyCommandStore.editPublishedReply; the provider upsert (GBP) makes republish non-duplicating",
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
      ],
      disposition: 'enabled',
    },
    {
      repairCommand: 'rebuildInboxProjection',
      notes: 'atomic command-store outbox write (BQC-3.4 InboxCommandStore)',
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
      consumers: [bus('review.event-handlers', REVIEW_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); all producers (create-property, GBP import via propertyApi.importProperty, and the integration import job through the same api) route through the store — the plain-bus integration property-event adapter was removed; consumer enqueues initial GBP sync',
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
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'denied_dark',
    },
    { notes: 'dark context (team.use); activity audit consumer stays enabled' },
  ),
  ev('team.updated', TEAM_EVENTS, {
    stateOwner: 'team',
    capability: 'team.use',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
    disposition: 'denied_dark',
  }),
  ev('team.deleted', TEAM_EVENTS, {
    stateOwner: 'team',
    capability: 'team.use',
    action: 'none',
    schemaRegistered: true,
    recordedInOutbox: true,
    consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
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
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); schema corrected in place at v1 (assignmentId/userId/propertyId shape — never recorded, zero historical rows)',
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
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); schema corrected in place at v1 (never recorded, zero historical rows)',
    },
  ),
]

const PORTAL_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('portal.created', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal.updated', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
    consumers: [],
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
    { notes: 'goal cleanup consumer is itself dark' },
  ),
  ev('portal_link_category.created', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_link_category.reordered', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_link.created', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_link.reordered', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_group.created', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_group.updated', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
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
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
    consumers: [],
    disposition: 'denied_dark',
  }),
  ev('portal_group.portal_removed', PORTAL_EVENTS, {
    stateOwner: 'portal',
    capability: 'portal.read',
    action: 'none',
    schemaRegistered: false,
    recordedInOutbox: false,
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
      schemaRegistered: false,
      recordedInOutbox: false,
      consumers: [bus('metric.event-handlers', METRIC_HANDLERS)],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'metric',
      notes:
        "schema-registrations.ts registers 'guest.scanned' instead — the emitted tag is unregistered and never recorded",
    },
  ),
  ev(
    'guest.rating.submitted',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.rating',
      schemaRegistered: false,
      recordedInOutbox: false,
      consumers: [bus('metric.event-handlers', METRIC_HANDLERS)],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'metric',
      notes:
        "schema-registrations.ts registers 'guest.rated' instead — the emitted tag is unregistered and never recorded",
    },
  ),
  ev(
    'guest.feedback.submitted',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.feedback',
      schemaRegistered: false,
      recordedInOutbox: false,
      consumers: [
        bus('inbox.event-handlers', INBOX_HANDLERS),
        bus('metric.event-handlers', METRIC_HANDLERS),
      ],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'inbox',
      notes:
        "schema-registrations.ts registers 'guest.feedback_submitted' instead — the emitted tag is unregistered and never recorded",
    },
  ),
  ev(
    'guest.review_link.clicked',
    GUEST_EVENTS,
    {
      stateOwner: 'guest',
      capability: 'portal.read',
      action: 'system:guest.click_track',
      schemaRegistered: false,
      recordedInOutbox: false,
      consumers: [bus('metric.event-handlers', METRIC_HANDLERS)],
      disposition: 'denied_dark',
    },
    {
      projectionOwner: 'metric',
      notes: 'no schema registered under any name',
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
        'atomic command-store outbox write (BQC-3.5); registered with identifier-only allowlist (no googleEmail) — was unregistered/bus-only',
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
    'integration.property_import.completed',
    INTEGRATION_EVENTS,
    {
      stateOwner: 'integration',
      capability: 'integration.use',
      action: 'system:property.import',
      schemaRegistered: true,
      recordedInOutbox: true,
      consumers: [bus('activity.event-handlers', ACTIVITY_HANDLERS)],
      disposition: 'enabled',
    },
    {
      notes:
        'atomic command-store outbox write (BQC-3.5); BQC-3.9 consumed the BQC-3.1 orphan — activity audit consumer (content-free counts)',
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
        'R2/S3 fetch+upload (sharp resize); registration-gated no-op while portal.upload is blocked',
    },
  ),
  job(
    'import-property',
    'src/contexts/integration/infrastructure/jobs/import-property.job.ts',
    {
      queue: 'default',
      capability: 'property.connect_gbp',
      action: 'system:property.import',
      schedule: 'none',
      registration: 'enabled',
    },
    {
      timeoutMs: 600_000,
      notes:
        'GBP property import; in-handler capability gate; bulk fetch+upsert warrants 10m',
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
      registration: 'blocked_capability',
    },
    {
      notes:
        'Resend send; registration-gated no-op while notification.send_email is blocked',
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
    'purge-expired-reviews',
    'src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts',
    {
      queue: 'background',
      capability: 'none',
      action: 'system:review.purge',
      schedule: 'every:86400000,offset:7200000',
      registration: 'enabled',
    },
    {
      timeoutMs: 300_000,
      notes:
        'atomic delete + review.expired outbox write per review (BQC-3.3); retention evidence rows; 5m bounds the daily batch',
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
        'BQC-1.6: 9 rules; evidence in retention_runs; throws on any rule failure; 15m bounds the full daily sweep',
    },
  ),
  job(
    'reconcile-goal-progress',
    'src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts',
    {
      queue: 'background',
      capability: 'goal.use',
      action: 'system:goal.reconcile',
      schedule: 'cron:10 * * * *',
      registration: 'denied_dark',
    },
    { notes: 'registration-gated no-op; NOT scheduled while goal.use is dark' },
  ),
  job(
    'spawn-recurring-instances',
    'src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts',
    {
      queue: 'background',
      capability: 'goal.use',
      action: 'system:goal.spawn',
      schedule: 'every:86400000',
      registration: 'denied_dark',
    },
    {
      notes:
        'registration-gated no-op; spawns goal instances ±1 day window; NOT scheduled while goal.use is dark',
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
      registration: 'blocked_capability',
    },
    {
      notes:
        'hourly tick → sends at org 8am local (ADR 0011); registration-gated no-op while notification.send_email is blocked',
    },
  ),
  job(
    'badge.reconcile',
    'src/bootstrap.ts',
    {
      queue: 'background',
      capability: 'badge.use',
      action: 'system:badge.reconcile',
      schedule: 'cron:20 * * * *',
      registration: 'denied_dark',
    },
    {
      notes:
        'inline literal (no *.job.ts); registration-gated no-op while badge.use is dark',
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
      registration: 'denied_dark',
    },
    {
      notes:
        'inline literal (no *.job.ts); registration-gated no-op while leaderboard.use is dark',
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
