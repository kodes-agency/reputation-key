// A guest edit and the replies written before it, on PostgreSQL.
//
// A reply written for one Material Review Revision does not answer the next
// (docs/BETA.md §3 "Inbox", ADR 0055 decision 11). Review already cancelled an
// open publication and withdrew unedited AI text when a guest edit arrived. A
// reply a manager had written was left as it stood, so one click could still
// publish it under the edited review: Confirm & Publish on a reply awaiting
// approval, or Try publishing again on one whose publication had failed, under
// the approval it got for the earlier review.
//
// These tests run the real use cases, command stores, publish worker and
// reconciliation sweep (testing/reply-workflow-harness.ts). Google is the
// witness: `google.sent` is every reply write that left RepKey.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { getEnv } from '#/shared/config/env'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { Reply } from '../domain/types'
import {
  createReplyWorkflowHarness,
  WORKFLOW_HOOK_TIMEOUT_MS,
  WORKFLOW_MANAGER,
  WORKFLOW_ORG,
  WORKFLOW_PROPERTY,
  WORKFLOW_REVIEW,
  type GoogleWriteOutcome,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const APOLOGY = 'We are sorry the room was not clean. Please give us another chance.'
/** The guest comes back and rewrites the one-star review as five stars. */
const GUEST_EDIT = {
  rating: 5,
  text: 'They put everything right. Wonderful stay.',
} as const
/** Past the last rung of the 72-hour read ladder. */
const PAST_THE_READ_LADDER_MS = 80 * 60 * 60 * 1000

// `invalid_transition` is shared by unrelated refusals, so each is matched on
// the sentence of the command that refused.
const refusal = (message: string) => ({
  _tag: 'ReviewError',
  code: 'invalid_transition',
  message,
})
const NOT_AWAITING_APPROVAL = refusal(
  'Only a reply that is waiting for approval can be confirmed and published',
)
const NOT_A_FAILED_REPLY = refusal(
  'Only a reply that failed to publish can be sent again',
)
const NOTHING_TO_CHECK = refusal('This reply has nothing to check on Google.')

let pool: Pool
let harness: ReplyWorkflowHarness

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 5 })
  clearEventSchemas()
  registerAllEventSchemas()
  harness = await createReplyWorkflowHarness({
    pool,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    logger: createMockLogger(),
  })
}, WORKFLOW_HOOK_TIMEOUT_MS)

afterAll(async () => {
  await harness.remove()
  clearEventSchemas()
  await pool.end()
}, WORKFLOW_HOOK_TIMEOUT_MS)

// Every test edits the Review, so each starts from a Review nobody has edited.
beforeEach(async () => {
  await harness.seed()
}, WORKFLOW_HOOK_TIMEOUT_MS)

async function storedReply(): Promise<Reply> {
  const reply = await harness.currentReply()
  if (!reply) throw new Error('The reply is gone')
  return reply
}

/** A manager writes the reply and puts it up for approval. */
async function submitReply(text = APOLOGY): Promise<Reply> {
  await harness.commands.draft(text)
  return harness.commands.submit()
}

/** A reply a manager confirmed whose publication then failed, settled as not
 * on Google: the last execution was refused inside RepKey, or Google said no. */
async function failedReply(outcome: GoogleWriteOutcome): Promise<Reply> {
  await submitReply()
  await harness.commands.approve()
  await harness.runPublishJob(0, outcome, true)
  return storedReply()
}

/**
 * A reply a manager confirmed whose one execution ended without an answer, and
 * whose automatic checks then ran out: "Google status unconfirmed"
 * (`publish_failed`, `terminal`, last error `ambiguous`).
 *
 * `timeout_lost`: the request left RepKey and nothing came back.
 * `crashed`: the worker died after its claim and no request left. The sweep
 * settles such an attempt as not sent as soon as it can read the dispatch
 * evidence, so it gets this far only when every lookup on the way failed.
 */
async function unconfirmedReply(outcome: 'timeout_lost' | 'crashed'): Promise<Reply> {
  await submitReply()
  await harness.commands.approve()
  await harness.runPublishJob(0, outcome, true)
  harness.advance(PAST_THE_READ_LADDER_MS)
  if (outcome === 'crashed') await harness.withDispatchEvidenceDown(harness.runSweep)
  else await harness.runSweep()
  const unconfirmed = await storedReply()
  expect(unconfirmed).toMatchObject({
    status: 'publish_failed',
    publicationState: 'terminal',
    publicationLastErrorClass: 'ambiguous',
  })
  return unconfirmed
}

/** One sync pass after the guest's edit: the Review's new revision, then what
 * Google shows as its reply, read at that revision as sync reads it. */
async function syncSeesTheGuestEdit(): Promise<void> {
  await harness.observeGuestEdit(GUEST_EDIT)
  await harness.observeGoogle()
}

/** The cancellation facts recorded for the workflow's Organization. */
async function cancellationFacts() {
  const result = await pool.query<{
    reply_id: string
    review_id: string
    property_id: string
    author_id: string | null
    cause: string
  }>(
    `SELECT payload->>'replyId' AS reply_id,
            payload->>'reviewId' AS review_id,
            payload->>'propertyId' AS property_id,
            payload->>'authorId' AS author_id,
            payload->>'cause' AS cause
       FROM outbox_events
      WHERE organization_id = $1
        AND event_type = 'review.reply.publication_cancelled'
      ORDER BY created_at, id`,
    [WORKFLOW_ORG],
  )
  return result.rows
}

const sourceChangedFact = (reply: Reply) => ({
  reply_id: reply.id,
  review_id: WORKFLOW_REVIEW,
  property_id: WORKFLOW_PROPERTY,
  author_id: WORKFLOW_MANAGER,
  cause: 'source_changed',
})

describe.sequential('a guest edit and the replies written before it (PostgreSQL)', () => {
  describe('a reply awaiting approval', () => {
    it('returns to draft with the text its manager wrote, and the people waiting on it are told', async () => {
      const pending = await submitReply()
      expect(pending).toMatchObject({ status: 'pending_approval' })

      await syncSeesTheGuestEdit()

      expect(await storedReply()).toMatchObject({
        id: pending.id,
        status: 'draft',
        text: APOLOGY,
        aiGenerated: false,
        publicationState: null,
        publicationCycle: 0,
        submittedBy: WORKFLOW_MANAGER,
      })
      expect(await cancellationFacts()).toEqual([sourceChangedFact(pending)])
    })

    it('cannot be confirmed for the edited review: nothing written before the edit goes to Google', async () => {
      await submitReply()
      await syncSeesTheGuestEdit()

      // A second manager presses Confirm & Publish with the edited review on screen.
      await expect(harness.commands.approve()).rejects.toMatchObject(
        NOT_AWAITING_APPROVAL,
      )

      expect(harness.jobs).toHaveLength(0)
      expect(harness.google.sent).toEqual([])
      expect((await harness.evidence()).authorizations).toEqual([])
    })

    it('is refused a confirmation that was opened before the edit and pressed after it', async () => {
      const pending = await submitReply()
      const onScreen = { id: pending.id, stateRevision: pending.stateRevision }

      await syncSeesTheGuestEdit()

      await expect(harness.commands.approve(onScreen)).rejects.toMatchObject(
        NOT_AWAITING_APPROVAL,
      )
      expect(harness.google.sent).toEqual([])
    })

    it('is published once a manager submits and confirms it again, for the review as it is now', async () => {
      await submitReply()
      await syncSeesTheGuestEdit()

      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.sent).toMatchObject([{ text: APOLOGY, landed: true }])
      const authorized = await pool.query<{ material_review_revision: number }>(
        `SELECT material_review_revision::int AS material_review_revision
           FROM reply_publication_authorizations WHERE organization_id = $1`,
        [WORKFLOW_ORG],
      )
      expect(authorized.rows).toEqual([{ material_review_revision: 2 }])
    })

    it('returns to draft when it had been submitted again after a cancelled publication, and keeps that record', async () => {
      await submitReply()
      await harness.commands.approve()
      await harness.cancelUndispatched()
      const resubmitted = await harness.commands.submit()
      expect(resubmitted).toMatchObject({
        status: 'pending_approval',
        publicationState: 'cancelled',
      })

      await syncSeesTheGuestEdit()

      expect(await storedReply()).toMatchObject({
        status: 'draft',
        text: APOLOGY,
        publicationState: 'cancelled',
        publicationCycle: 1,
      })
      expect(await cancellationFacts()).toMatchObject([
        { cause: 'disconnect' },
        sourceChangedFact(resubmitted),
      ])
      expect((await harness.evidence()).authorizations).toHaveLength(1)
    })
  })

  describe('a reply whose publication failed and is settled as not on Google', () => {
    it.each([
      ['RepKey never sent it', 'not_sent', 'retryable'],
      ['Google refused it', 'rejected', 'terminal_rejection'],
    ] as const)(
      'returns to draft when %s, so Try publishing again cannot send it under its old approval',
      async (_why, outcome, failureClass) => {
        const failed = await failedReply(outcome)
        expect(failed).toMatchObject({
          status: 'publish_failed',
          publicationState: 'terminal',
          publicationLastErrorClass: failureClass,
        })
        const before = await harness.evidence()
        const sentBefore = [...harness.google.sent]

        await syncSeesTheGuestEdit()

        expect(await storedReply()).toMatchObject({
          id: failed.id,
          status: 'draft',
          text: APOLOGY,
          publicationState: 'cancelled',
          publicationLastErrorClass: null,
          reconcileDueAt: null,
          publicationCycle: 1,
        })
        expect(await cancellationFacts()).toEqual([sourceChangedFact(failed)])
        // What the failed cycle recorded stays as it was: it is the evidence.
        const after = await harness.evidence()
        expect(after.authorizations).toEqual(before.authorizations)
        expect(after.attempts).toEqual(before.attempts)

        await expect(harness.commands.retry()).rejects.toMatchObject(NOT_A_FAILED_REPLY)
        expect(harness.jobs).toHaveLength(1)
        expect(harness.google.sent).toEqual(sentBefore)
      },
    )

    it('is published again only through a new submission and a new approval', async () => {
      await failedReply('not_sent')
      await syncSeesTheGuestEdit()

      await harness.commands.draft('Thank you for coming back to tell us.')
      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(1, 'accepted')

      expect(harness.google.sent).toMatchObject([
        { publicationCycle: 2, text: 'Thank you for coming back to tell us.' },
      ])
    })
  })

  describe('a reply whose publication failed with no answer, once its automatic checks have ended', () => {
    it('returns to draft with its text, and the attempt nobody can confirm any more is closed', async () => {
      const unconfirmed = await unconfirmedReply('timeout_lost')
      const before = await harness.evidence()
      expect(before.attempts).toMatchObject([
        { publicationCycle: 1, attemptNumber: 1, outcome: 'ambiguous' },
      ])

      await syncSeesTheGuestEdit()

      expect(await storedReply()).toMatchObject({
        id: unconfirmed.id,
        status: 'draft',
        text: APOLOGY,
        publicationState: 'cancelled',
        publicationLastErrorClass: null,
        reconcileDueAt: null,
        publicationCycle: 1,
      })
      expect(await cancellationFacts()).toEqual([sourceChangedFact(unconfirmed)])
      const after = await harness.evidence()
      expect(after.authorizations).toEqual(before.authorizations)
      expect(after.attempts).toEqual([{ ...before.attempts[0], outcome: 'superseded' }])
    })

    it('is published again through a new submission and a new approval, for the review as it is now', async () => {
      await unconfirmedReply('timeout_lost')
      await syncSeesTheGuestEdit()

      await harness.commands.draft('Thank you for coming back to tell us.')
      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(1, 'accepted')

      expect(harness.google.sent).toMatchObject([
        { publicationCycle: 1, text: APOLOGY, landed: false },
        { publicationCycle: 2, text: 'Thank you for coming back to tell us.' },
      ])
      // No write left while an earlier one was still of unknown outcome.
      expect(harness.google.violations).toEqual([])
      const authorized = await pool.query<{ material_review_revision: number }>(
        `SELECT material_review_revision::int AS material_review_revision
           FROM reply_publication_authorizations
          WHERE organization_id = $1 ORDER BY publication_cycle`,
        [WORKFLOW_ORG],
      )
      expect(authorized.rows).toEqual([
        { material_review_revision: 1 },
        { material_review_revision: 2 },
      ])
    })

    // The attempt never left RepKey, so the proof Try publishing again and
    // Check Google again look for is there to be found after the edit.
    it('is refused Try publishing again, which would send it under the approval it got before the edit', async () => {
      await unconfirmedReply('crashed')
      await syncSeesTheGuestEdit()

      await expect(harness.commands.retry()).rejects.toMatchObject(NOT_A_FAILED_REPLY)

      expect(harness.jobs).toHaveLength(1)
      expect(harness.google.sent).toEqual([])
      expect((await harness.evidence()).authorizations).toHaveLength(1)
    })

    it('is refused Check Google again, which would settle it as never sent for a retry to send', async () => {
      await unconfirmedReply('crashed')
      await syncSeesTheGuestEdit()

      await expect(harness.commands.checkGoogle()).rejects.toMatchObject(NOTHING_TO_CHECK)
      await expect(harness.commands.retry()).rejects.toMatchObject(NOT_A_FAILED_REPLY)

      expect(await storedReply()).toMatchObject({
        status: 'draft',
        text: APOLOGY,
        publicationState: 'cancelled',
      })
      expect(harness.jobs).toHaveLength(1)
      expect(harness.google.sent).toEqual([])
    })
  })

  describe('replies a guest edit leaves as they are', () => {
    it("keeps a manager's draft as a draft, text and all, and tells nobody", async () => {
      const draft = await harness.commands.draft(APOLOGY)

      await syncSeesTheGuestEdit()

      expect(await storedReply()).toEqual(draft)
      expect(await cancellationFacts()).toEqual([])
    })

    it('keeps a rejected reply rejected', async () => {
      await submitReply()
      const rejected = await harness.commands.reject()

      await syncSeesTheGuestEdit()

      expect(await storedReply()).toEqual(rejected)
      expect(await cancellationFacts()).toEqual([])
    })

    it('keeps a published reply published', async () => {
      await submitReply()
      await harness.commands.approve()
      await harness.runPublishJob(0, 'accepted')
      await harness.observeGoogle()
      const published = await storedReply()
      expect(published).toMatchObject({
        status: 'published',
        publicationState: 'published',
      })

      await harness.observeGuestEdit(GUEST_EDIT)

      expect(await storedReply()).toEqual(published)
      expect(await cancellationFacts()).toEqual([])
    })

    it('keeps a reply awaiting approval when the observation changes nothing the guest wrote', async () => {
      const pending = await submitReply()

      // The reviewer's display name changed: sync records the observation
      // through the same store, and it is not a Material Review Revision.
      await harness.observeReviewChange({ reviewerName: 'Jane D.' })

      expect(await storedReply()).toEqual(pending)
      expect(await cancellationFacts()).toEqual([])
    })
  })
})
