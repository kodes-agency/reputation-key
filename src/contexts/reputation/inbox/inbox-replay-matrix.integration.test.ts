// IBX-01-T8 — fresh-database replay matrix.
//
// The Inbox projection is rebuildable by construction: append-only cycles, a
// CAS head, receipt-coordinated applies, and exact-current source authorities.
// "By construction" is a claim, not evidence. This file drops every Inbox row
// for the scope, replays the whole source history in each named delivery order
// from `src/shared/testing/inbox-replay-fixtures.ts`, and requires the
// resulting projection to be identical every time and equal to what current
// source truth implies.
//
// Delivery is modelled the way the durable dispatcher actually behaves: a
// handler that throws is retried on a later pass, a handler that returns
// `obsolete` is finished. That is why an order can start with a fact whose
// subject does not exist yet and still converge.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { PrerequisiteNotReadyError, type ConsumerRegistry } from '#/shared/outbox'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  INBOX_REPLAY_GUEST_ORDERS,
  INBOX_REPLAY_REVIEW_ORDERS,
  INBOX_REPLAY_WITHDRAWAL_ORDERS,
  type InboxReplayGuestDelivery,
  type InboxReplayReviewDelivery,
  type InboxReplayWithdrawalDelivery,
} from '#/shared/testing/inbox-replay-fixtures'
import { createFeedbackHandlingStore } from '#/contexts/reputation/inbox/feedback-handling-store.server'
import {
  handleInboxGuestFeedbackRetracted,
  handleInboxGuestFeedbackSubmitted,
  registerGuestFeedbackConsumer,
  type GuestFeedbackConsumerDeps,
} from './guest-feedback-outbox-consumers.server'
import {
  AT,
  EVENT_IDS,
  ORG,
  SCOPE,
  allowAllCommandAuthority,
  bindReplayPool,
  captureState,
  cleanAll,
  cleanProjection,
  countOutboxRows,
  deliverReview,
  drain,
  expectNothingReleasable,
  guestDeps,
  guestEnvelope,
  guestFeedbackPayload,
  pool,
  receiptFor,
  replayEveryOrder,
  retractionEnvelope,
  seedReplayScope,
  submissionEnvelope,
} from './inbox-replay-matrix.test-fixtures'

let lease: TestLease

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  bindReplayPool(lease.pool)
})

afterAll(async () => {
  await cleanAll()
  await lease.release()
})

beforeEach(seedReplayScope)

describe.sequential('Inbox fresh-database replay matrix (PostgreSQL)', () => {
  it('rebuilds one identical Review projection for every named delivery order', async () => {
    const observed = await replayEveryOrder<InboxReplayReviewDelivery>(
      INBOX_REPLAY_REVIEW_ORDERS.map((order) => order),
      deliverReview,
    )

    expect(observed).toHaveLength(INBOX_REPLAY_REVIEW_ORDERS.length)

    // Current source truth: two Material Review Revisions, the second closed by
    // a confirmed provider reply. Both stale facts are absorbed as obsolete.
    const converged = observed[0]!
    expect(converged.items).toEqual([
      expect.objectContaining({ id: SCOPE.reviewItemId as string, status: 'closed' }),
    ])
    expect(converged.heads).toEqual([
      expect.objectContaining({
        current_cycle_number: 2,
        current_source_revision: 2,
        status: 'closed',
      }),
    ])
    expect(
      converged.cycles.map((row) => (row as { cycle_number: number }).cycle_number),
    ).toEqual([1, 2])
    expect(
      converged.transitions.map(
        (row) => (row as { transition_reason: string }).transition_reason,
      ),
    ).toEqual([
      'review_observed',
      'superseded_by_source_revision',
      'material_revision_changed',
      'external_reply_observed',
    ])
    expect(
      converged.responseTargets.map((row) => (row as { result: string | null }).result),
    ).toEqual(['cancelled', 'on_time'])
    expect(await receiptFor(EVENT_IDS['reply.observed.staleDeletion'])).toBe('obsolete')
    expect(await receiptFor(EVENT_IDS['review.sourceTransitioned'])).toBe('obsolete')
  })

  it('creates exactly one halfway and one target-passed slot per measured cycle and leaves none releasable', async () => {
    await cleanProjection()
    await drain<InboxReplayReviewDelivery>(
      INBOX_REPLAY_REVIEW_ORDERS[0]!.deliveries,
      deliverReview,
    )

    const state = await captureState()
    const perCycle = new Map<number, string[]>()
    for (const row of state.reminders as ReadonlyArray<
      Readonly<{ cycle_number: number; reminder_kind: string }>
    >) {
      perCycle.set(row.cycle_number, [
        ...(perCycle.get(row.cycle_number) ?? []),
        row.reminder_kind,
      ])
    }
    expect([...perCycle.entries()].sort()).toEqual([
      [1, ['halfway', 'target_passed']],
      [2, ['halfway', 'target_passed']],
    ])

    // Cycle 1 was superseded and cycle 2 closed on a confirmed reply, so no
    // slot may still be releasable however far the clock is advanced.
    await expectNothingReleasable()
  })

  it('absorbs an identical second replay of the whole Review history as a no-op', async () => {
    await cleanProjection()
    await drain<InboxReplayReviewDelivery>(
      INBOX_REPLAY_REVIEW_ORDERS[0]!.deliveries,
      deliverReview,
    )
    const before = await captureState()
    const outboxBefore = await countOutboxRows()

    await drain<InboxReplayReviewDelivery>(
      INBOX_REPLAY_REVIEW_ORDERS[0]!.deliveries,
      deliverReview,
    )

    expect(await captureState()).toEqual(before)
    expect(await countOutboxRows()).toBe(outboxBefore)
  })

  it('leaves no receipt for an observation that overtakes its projection and converges once the item exists', async () => {
    await cleanProjection()

    await expect(deliverReview('reply.observed.currentLiveReply')).rejects.toBeInstanceOf(
      PrerequisiteNotReadyError,
    )
    expect(await receiptFor(EVENT_IDS['reply.observed.currentLiveReply'])).toBeNull()

    await deliverReview('review.created')
    await deliverReview('review.updated')
    await deliverReview('reply.observed.currentLiveReply')

    expect(await receiptFor(EVENT_IDS['reply.observed.currentLiveReply'])).toBe('applied')
    const state = await captureState()
    expect(state.heads).toEqual([
      expect.objectContaining({ current_cycle_number: 2, status: 'closed' }),
    ])
  })

  it('rebuilds one identical private-feedback projection for every named Guest order', async () => {
    const deliverGuest = async (name: InboxReplayGuestDelivery): Promise<void> => {
      if (name === 'guest.rating.submitted.ratingOnlyCorrection') {
        // Inbox registers no consumer for a rating-only correction; delivering
        // it is a structural assertion, not a projection command.
        return
      }
      await handleInboxGuestFeedbackSubmitted(
        guestDeps(SCOPE.feedbackItemId, () => true),
        submissionEnvelope(
          SCOPE.feedbackId,
          name === 'guest.feedback.submitted.redelivered'
            ? 'guest.feedback.submitted.redelivered'
            : 'guest.feedback.submitted',
        ),
      )
    }

    const registered: string[] = []
    const registry = {
      registerConsumer: (registration: Readonly<{ eventType: string }>) => {
        registered.push(registration.eventType)
      },
    } as unknown as ConsumerRegistry
    registerGuestFeedbackConsumer(
      registry,
      guestDeps(SCOPE.feedbackItemId, () => true),
    )
    expect(registered).toEqual(['guest.feedback.submitted', 'guest.feedback.retracted'])

    const observed = await replayEveryOrder<InboxReplayGuestDelivery>(
      INBOX_REPLAY_GUEST_ORDERS.map((order) => order),
      deliverGuest,
    )

    // Exactly one Inbox Item, one cycle, one target — the rating-only
    // correction and the redelivery add nothing.
    const converged = observed[0]!
    expect(converged.items).toHaveLength(1)
    expect(converged.cycles).toHaveLength(1)
    expect(converged.responseTargets).toHaveLength(1)
    expect(converged.outcomes).toEqual([])
  })

  it('never resurrects a purged private-feedback projection in any Guest withdrawal order', async () => {
    const deliverWithdrawal = async (
      name: InboxReplayWithdrawalDelivery,
    ): Promise<void> => {
      if (name === 'guest.rating.submitted.ratingOnlyCorrection') return
      // Current Guest truth for this feedback is "the body is gone".
      const deps = guestDeps(SCOPE.withdrawnFeedbackItemId, () => false)
      if (name === 'guest.feedback.submitted') {
        await handleInboxGuestFeedbackSubmitted(
          deps,
          submissionEnvelope(SCOPE.withdrawnFeedbackId),
        )
        return
      }
      await handleInboxGuestFeedbackRetracted(
        deps,
        retractionEnvelope(SCOPE.withdrawnFeedbackId),
      )
    }

    const observed = await replayEveryOrder<InboxReplayWithdrawalDelivery>(
      INBOX_REPLAY_WITHDRAWAL_ORDERS.map((order) => order),
      deliverWithdrawal,
    )
    expect(observed[0]!.items).toEqual([])
    expect(observed[0]!.cycles).toEqual([])
    expect(observed[0]!.outcomes).toEqual([])
    expect(await receiptFor(EVENT_IDS['guest.feedback.submitted'])).toBe('obsolete')
  })

  // The creation consumer reads the feedback, and only then inserts, in a
  // transaction of its own. A withdrawal delivered in between found no item,
  // recorded itself applied and left nothing behind, so the insert that
  // followed opened work for feedback the guest had already withdrawn
  // (docs/BETA.md §3: "guest withdrawal cancels it").
  it('opens no Inbox item when the withdrawal is handled between the creation consumer’s source check and its insert', async () => {
    await cleanProjection()
    const deps = guestDeps(SCOPE.feedbackItemId, () => true)
    const withdrawal = retractionEnvelope(SCOPE.feedbackId)
    const withdrawnAfterTheSourceCheck: GuestFeedbackConsumerDeps = {
      ...deps,
      feedbackLookup: {
        ...deps.feedbackLookup,
        getFeedbackSnippetById: async (feedbackId, organizationId) => {
          const seenBeforeTheWithdrawal =
            await deps.feedbackLookup.getFeedbackSnippetById(feedbackId, organizationId)
          await handleInboxGuestFeedbackRetracted(deps, withdrawal)
          return seenBeforeTheWithdrawal
        },
      },
    }

    await handleInboxGuestFeedbackSubmitted(
      withdrawnAfterTheSourceCheck,
      submissionEnvelope(SCOPE.feedbackId),
    )

    const state = await captureState()
    expect({ items: state.items, cycles: state.cycles }).toEqual({
      items: [],
      cycles: [],
    })
    expect(await receiptFor(EVENT_IDS['guest.feedback.submitted'])).toBe('obsolete')
    expect(await receiptFor(withdrawal.eventId)).toBe('applied')
  })

  // The submission a withdrawal takes back is named in its payload. Only a
  // submission of the withdrawal's own Organization is settled, so a wrong id
  // cannot stop another Organization's feedback from reaching its Inbox.
  it('leaves another Organization’s submission deliverable when a withdrawal names it', async () => {
    await cleanProjection()
    const otherOrganization = 'org-inbox-replay-matrix-00000002'
    const otherSubmissionEventId = '7d000000-0000-4000-8000-000000000301'
    await pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id,
         property_id, source_context, source_aggregate_id, created_at
       ) VALUES ($1, 'guest.feedback.submitted', 1, '{}'::jsonb, $2, $3, 'guest', $4, $5)`,
      [
        otherSubmissionEventId,
        otherOrganization,
        SCOPE.propertyId,
        SCOPE.feedbackId,
        AT.feedbackSubmittedAt,
      ],
    )
    try {
      const withdrawal = guestEnvelope(
        'guest.feedback.retracted',
        'guest.feedback.retracted',
        {
          ...guestFeedbackPayload(SCOPE.feedbackId),
          supersedesSourceEventId: otherSubmissionEventId,
        },
      )

      await handleInboxGuestFeedbackRetracted(
        guestDeps(SCOPE.feedbackItemId, () => false),
        withdrawal,
      )

      expect(await receiptFor(otherSubmissionEventId)).toBeNull()
      expect(await receiptFor(withdrawal.eventId)).toBe('applied')
    } finally {
      await pool.query('DELETE FROM outbox_events WHERE id = $1', [
        otherSubmissionEventId,
      ])
    }
  })

  it('closes a live private-feedback cycle on withdrawal and leaves no releasable slot or manager outcome', async () => {
    await cleanProjection()
    let bodyAvailable = true
    await handleInboxGuestFeedbackSubmitted(
      guestDeps(SCOPE.feedbackItemId, () => bodyAvailable),
      submissionEnvelope(SCOPE.feedbackId),
    )
    bodyAvailable = false
    await handleInboxGuestFeedbackRetracted(
      guestDeps(SCOPE.feedbackItemId, () => bodyAvailable),
      retractionEnvelope(SCOPE.feedbackId),
    )

    const state = await captureState()
    expect(state.heads).toEqual([
      expect.objectContaining({ current_cycle_number: 1, status: 'closed' }),
    ])
    expect(
      state.transitions.map(
        (row) => (row as { transition_reason: string }).transition_reason,
      ),
    ).toEqual(['feedback_submitted', 'guest_withdrawn'])
    expect(
      state.reminders.map(
        (row) => (row as { cancelled_at: Date | null }).cancelled_at !== null,
      ),
    ).toEqual([true, true])
    expect(state.outcomes).toEqual([])
    await expectNothingReleasable()
    await expect(
      createFeedbackHandlingStore(getDb(), allowAllCommandAuthority).getState(
        SCOPE.feedbackItemId,
        ORG,
      ),
    ).resolves.toMatchObject({ closeReason: 'guest_withdrawn', currentOutcome: null })
  })
})
