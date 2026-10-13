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
// These tests run the real use cases, command stores and publish worker
// (testing/reply-workflow-harness.ts). Google is the witness: `google.sent` is
// every reply write that left RepKey.

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
const REFUSED = { _tag: 'ReviewError', code: 'invalid_transition' }

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
      await expect(harness.commands.approve()).rejects.toMatchObject(REFUSED)

      expect(harness.jobs).toHaveLength(0)
      expect(harness.google.sent).toEqual([])
      expect((await harness.evidence()).authorizations).toEqual([])
    })

    it('is refused a confirmation that was opened before the edit and pressed after it', async () => {
      const pending = await submitReply()
      const onScreen = { id: pending.id, stateRevision: pending.stateRevision }

      await syncSeesTheGuestEdit()

      await expect(harness.commands.approve(onScreen)).rejects.toMatchObject(REFUSED)
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

        await expect(harness.commands.retry()).rejects.toMatchObject(REFUSED)
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
