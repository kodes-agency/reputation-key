// IBX-01-T8 — the named, bounded delivery matrix for the Inbox replay proof.
//
// WHY A NAMED SET RATHER THAN A GENERATOR
// A five-delivery history has 120 orderings, and the integration project runs
// serially with a 30s per-test budget. An unbounded permutation generator would
// make the suite unusable and would not add information: the interesting
// classes of disorder are few and nameable (source before projection, provider
// truth before source, obsolete fact last, obsolete fact first, fully
// reversed). Each order below states the real-world delivery hazard it stands
// for, so a reviewer can judge coverage instead of counting permutations.
//
// WHY HUMAN COMMANDS ARE NOT PERMUTED
// `markFeedbackHandled` and `correctFeedbackHandlingOutcome` are optimistically
// fenced human commands, not durable deliveries. A manager cannot correct an
// outcome before recording it, and asserting that an impossible order converges
// would be theatre. They run at their fixed causal position in every order; the
// durable deliveries around them are what gets permuted.
//
// WHY THE PROVIDER OBSERVATION HEAD IS SINGULAR
// `google_reply_observation_heads` holds exactly one current observation per
// review. "Replay converges to exact current state" therefore means: the source
// tables are already at their final truth, every delivery is replayed in an
// arbitrary order, and the projection lands on what current truth implies —
// stale observations are absorbed as obsolete no matter when they arrive.

import {
  feedbackId,
  inboxItemId,
  organizationId,
  portalId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'

export const INBOX_REPLAY_SCOPE = {
  organizationId: organizationId('org-inbox-replay-matrix-00000001'),
  propertyId: propertyId('7d000000-0000-4000-8000-000000000001'),
  reviewId: reviewId('7d000000-0000-4000-8000-000000000002'),
  reviewItemId: inboxItemId('7d000000-0000-4000-8000-000000000003'),
  feedbackId: feedbackId('7d000000-0000-4000-8000-000000000004'),
  feedbackItemId: inboxItemId('7d000000-0000-4000-8000-000000000005'),
  withdrawnFeedbackId: feedbackId('7d000000-0000-4000-8000-000000000006'),
  withdrawnFeedbackItemId: inboxItemId('7d000000-0000-4000-8000-000000000007'),
  portalId: portalId('7d000000-0000-4000-8000-000000000008'),
  managerUserId: userId('user-inbox-replay-matrix-000001'),
} as const

/** Every instant the replay uses. Fixed so a rerun is byte-comparable. */
export const INBOX_REPLAY_CLOCK = {
  reviewObservedRevision1: new Date('2026-08-01T12:00:00.000Z'),
  reviewObservedRevision2: new Date('2026-08-02T12:00:00.000Z'),
  targetStartRevision1: new Date('2026-08-01T11:00:00.000Z'),
  targetStartRevision2: new Date('2026-08-02T11:00:00.000Z'),
  replyObservedAt: new Date('2026-08-03T12:00:00.000Z'),
  feedbackSubmittedAt: new Date('2026-08-01T09:00:00.000Z'),
  feedbackCorrectedAt: new Date('2026-08-01T09:30:00.000Z'),
  feedbackHandledAt: new Date('2026-08-01T10:00:00.000Z'),
  feedbackOutcomeCorrectedAt: new Date('2026-08-01T11:00:00.000Z'),
  feedbackWithdrawnAt: new Date('2026-08-01T12:30:00.000Z'),
  consumerClock: new Date('2026-08-20T12:00:00.000Z'),
  /** Far past every replayed write, so a wall-clock `created_at` is in scope. */
  observedAt: new Date('2027-01-01T00:00:00.000Z'),
} as const

export type InboxReplayOrder<Delivery extends string> = Readonly<{
  /** Stable name — this is what a failure report cites. */
  name: string
  /** The delivery hazard this order stands for. */
  hazard: string
  deliveries: readonly Delivery[]
}>

// ── Review source history ────────────────────────────────────────────

/**
 * Final Review truth for the replay: an active review at Material Review
 * Revision 2 whose current provider observation is a live, RepKey-confirmed
 * reply. `staleReplyDeletion` and `sourceExpired` are real facts that were true
 * earlier and are no longer current; every order must absorb them as obsolete.
 */
export const INBOX_REPLAY_REVIEW_DELIVERIES = [
  'review.created',
  'review.updated',
  'reply.observed.staleDeletion',
  'reply.observed.currentLiveReply',
  'review.sourceTransitioned',
] as const

export type InboxReplayReviewDelivery = (typeof INBOX_REPLAY_REVIEW_DELIVERIES)[number]

export const INBOX_REPLAY_REVIEW_ORDERS: readonly InboxReplayOrder<InboxReplayReviewDelivery>[] =
  [
    {
      name: 'in_order',
      hazard: 'The happy path: the dispatcher drains in emission order.',
      deliveries: [
        'review.created',
        'review.updated',
        'reply.observed.staleDeletion',
        'reply.observed.currentLiveReply',
        'review.sourceTransitioned',
      ],
    },
    {
      name: 'provider_truth_first',
      hazard:
        'Both reply observations overtake the projection entirely — the Inbox item does not exist yet.',
      deliveries: [
        'reply.observed.currentLiveReply',
        'reply.observed.staleDeletion',
        'review.created',
        'review.updated',
        'review.sourceTransitioned',
      ],
    },
    {
      name: 'confirmation_between_revisions',
      hazard:
        'The confirmation lands while the cycle head is still one Material Review Revision behind.',
      deliveries: [
        'review.created',
        'reply.observed.currentLiveReply',
        'review.updated',
        'review.sourceTransitioned',
        'reply.observed.staleDeletion',
      ],
    },
    {
      name: 'obsolete_transition_first',
      hazard:
        'A source transition that is no longer current arrives before anything else exists.',
      deliveries: [
        'review.sourceTransitioned',
        'review.created',
        'review.updated',
        'reply.observed.staleDeletion',
        'reply.observed.currentLiveReply',
      ],
    },
    {
      name: 'revisions_reversed',
      hazard:
        'Two projection deliveries for the same review arrive newest-first (parallel consumers).',
      deliveries: [
        'review.updated',
        'review.created',
        'reply.observed.currentLiveReply',
        'review.sourceTransitioned',
        'reply.observed.staleDeletion',
      ],
    },
    {
      name: 'fully_reversed',
      hazard: 'A restored backlog is drained from the tail.',
      deliveries: [
        'review.sourceTransitioned',
        'reply.observed.currentLiveReply',
        'reply.observed.staleDeletion',
        'review.updated',
        'review.created',
      ],
    },
  ]

// ── Guest private-feedback source history ────────────────────────────

/**
 * `ratingOnlyCorrection` is the single bounded Guest rating correction
 * (`guest.rating.submitted` carrying `supersedesSourceEventId`). Inbox
 * deliberately registers no consumer for it: a rating change is not a new
 * private-feedback occurrence, so it must create no Inbox Item, Handling
 * Cycle, Response Target, or submission notification.
 */
export const INBOX_REPLAY_GUEST_DELIVERIES = [
  'guest.feedback.submitted',
  'guest.rating.submitted.ratingOnlyCorrection',
  'guest.feedback.submitted.redelivered',
] as const

export type InboxReplayGuestDelivery = (typeof INBOX_REPLAY_GUEST_DELIVERIES)[number]

export const INBOX_REPLAY_GUEST_ORDERS: readonly InboxReplayOrder<InboxReplayGuestDelivery>[] =
  [
    {
      name: 'in_order',
      hazard: 'Submission, then the rating correction, then a duplicate delivery.',
      deliveries: [
        'guest.feedback.submitted',
        'guest.rating.submitted.ratingOnlyCorrection',
        'guest.feedback.submitted.redelivered',
      ],
    },
    {
      name: 'rating_correction_first',
      hazard: 'The rating correction is drained before the feedback submission.',
      deliveries: [
        'guest.rating.submitted.ratingOnlyCorrection',
        'guest.feedback.submitted',
        'guest.feedback.submitted.redelivered',
      ],
    },
    {
      name: 'duplicate_first',
      hazard: 'At-least-once delivery replays the submission before its first attempt.',
      deliveries: [
        'guest.feedback.submitted.redelivered',
        'guest.feedback.submitted',
        'guest.rating.submitted.ratingOnlyCorrection',
      ],
    },
    {
      name: 'fully_reversed',
      hazard: 'A restored Guest backlog is drained from the tail.',
      deliveries: [
        'guest.feedback.submitted.redelivered',
        'guest.rating.submitted.ratingOnlyCorrection',
        'guest.feedback.submitted',
      ],
    },
  ]

/**
 * Withdrawal replay is a convergence-to-ABSENCE proof. Current Guest truth for
 * this feedback is "the body is gone", so a fresh replay must never resurrect
 * the projection — in any order. The live withdrawal transition (an existing
 * Inbox Item closing with `guest_withdrawn`) is causally ordered by definition
 * and is asserted separately, not permuted.
 */
export const INBOX_REPLAY_WITHDRAWAL_DELIVERIES = [
  'guest.feedback.submitted',
  'guest.rating.submitted.ratingOnlyCorrection',
  'guest.feedback.retracted',
] as const

export type InboxReplayWithdrawalDelivery =
  (typeof INBOX_REPLAY_WITHDRAWAL_DELIVERIES)[number]

export const INBOX_REPLAY_WITHDRAWAL_ORDERS: readonly InboxReplayOrder<InboxReplayWithdrawalDelivery>[] =
  [
    {
      name: 'in_order',
      hazard: 'Submission, rating correction, then the withdrawal.',
      deliveries: [
        'guest.feedback.submitted',
        'guest.rating.submitted.ratingOnlyCorrection',
        'guest.feedback.retracted',
      ],
    },
    {
      name: 'withdrawal_first',
      hazard:
        'The withdrawal overtakes the submission — the projection must not be resurrected.',
      deliveries: [
        'guest.feedback.retracted',
        'guest.feedback.submitted',
        'guest.rating.submitted.ratingOnlyCorrection',
      ],
    },
    {
      name: 'withdrawal_between',
      hazard: 'The withdrawal lands between the submission and the rating correction.',
      deliveries: [
        'guest.feedback.submitted',
        'guest.feedback.retracted',
        'guest.rating.submitted.ratingOnlyCorrection',
      ],
    },
    {
      name: 'fully_reversed',
      hazard: 'A restored Guest backlog is drained from the tail.',
      deliveries: [
        'guest.rating.submitted.ratingOnlyCorrection',
        'guest.feedback.retracted',
        'guest.feedback.submitted',
      ],
    },
  ]

// ── Comparable projection state ──────────────────────────────────────

/**
 * The exact projection state a replay must reproduce. Consumer wall-clock
 * columns (`created_at`, `updated_at`, `transitioned_at`, `recorded_at`) are
 * deliberately absent: they are stamped from the consumer's own clock at apply
 * time, so they legitimately differ between two replays of the same history.
 * Every column that carries a decision — status, revisions, reasons, results —
 * is present and must be identical.
 */
export const INBOX_REPLAY_STATE_SQL = {
  items: `SELECT id, organization_id, property_id, source_type, source_id, status,
                 is_escalated, rating, source_date, platform, snippet, reviewer_name,
                 assigned_to, closed_at, command_revision::int
          FROM inbox_items WHERE organization_id = $1 ORDER BY id`,
  heads: `SELECT inbox_item_id, source_type, source_id, current_cycle_number::int,
                 current_source_revision::int, state_revision::int, status
          FROM inbox_handling_cycle_heads WHERE organization_id = $1
          ORDER BY inbox_item_id`,
  cycles: `SELECT inbox_item_id, cycle_number::int, source_type, source_id,
                  source_revision::int, opened_reason, manual_reopen_reason,
                  manual_reopen_explanation, supersedes_cycle_number::int, opened_by,
                  opened_at
           FROM inbox_handling_cycles WHERE organization_id = $1
           ORDER BY inbox_item_id, cycle_number`,
  transitions: `SELECT inbox_item_id, cycle_number::int, state_revision::int,
                       source_revision::int, kind, transition_reason, actor_type,
                       actor_user_id
                FROM inbox_handling_cycle_transitions WHERE organization_id = $1
                ORDER BY inbox_item_id, state_revision`,
  responseTargets: `SELECT inbox_item_id, cycle_number::int, target_kind,
                           performance_eligibility, duration_minutes, policy_source,
                           policy_version::int, start_at, due_at, completion_at,
                           result, stop_reason
                    FROM inbox_handling_cycle_response_targets
                    WHERE organization_id = $1
                    ORDER BY inbox_item_id, cycle_number`,
  reminders: `SELECT inbox_item_id, cycle_number::int, reminder_kind, scheduled_for,
                     delivered_at, cancelled_at
              FROM inbox_response_target_reminders WHERE organization_id = $1
              ORDER BY inbox_item_id, cycle_number, scheduled_for`,
  outcomes: `SELECT inbox_item_id, cycle_number::int, outcome_revision::int, outcome,
                    internal_note, recorded_by, completion_at, deadline_result,
                    supersedes_outcome_revision::int
             FROM inbox_feedback_handling_outcomes WHERE organization_id = $1
             ORDER BY inbox_item_id, cycle_number, outcome_revision`,
} as const

export type InboxReplayStateKey = keyof typeof INBOX_REPLAY_STATE_SQL

export const INBOX_REPLAY_STATE_KEYS = Object.keys(
  INBOX_REPLAY_STATE_SQL,
) as readonly InboxReplayStateKey[]
