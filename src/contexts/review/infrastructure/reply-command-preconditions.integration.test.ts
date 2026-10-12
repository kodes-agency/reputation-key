// Reply command preconditions on PostgreSQL.
//
// Each reply command may start only from the states it names. These tests run
// the real use cases, command store, publish worker and reconciliation sweep
// (testing/reply-workflow-harness.ts) through the five sequences in which a
// command used to be accepted from a state that belonged to another command,
// and through the direct store calls a second entry point could make.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { getEnv } from '#/shared/config/env'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { Reply } from '../domain/types'
import {
  reviewReplyApproved,
  reviewReplyPublicationCancelled,
  reviewReplyPublicationRequested,
  reviewReplyPublished,
  reviewReplyPublishFailed,
} from '../domain/events'
import { PUBLICATION_RECOVERY_RECONCILE_DELAY_MS } from '../domain/reply-publication-workflow'
import {
  createReplyWorkflowHarness,
  WORKFLOW_HOOK_TIMEOUT_MS,
  WORKFLOW_MANAGER,
  WORKFLOW_ORG,
  WORKFLOW_PROPERTY,
  WORKFLOW_REVIEW,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const APPROVED_TEXT = 'Thank you for staying with us.'
const LATER_TEXT = 'A different reply nobody approved.'
const MINUTE_MS = 60_000
/** Past the last rung of the 72-hour read ladder of an uncertain attempt. */
const LADDER_END_MINUTES = 4_800
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
  await harness.seed()
}, WORKFLOW_HOOK_TIMEOUT_MS)

afterAll(async () => {
  await harness.remove()
  clearEventSchemas()
  await pool.end()
}, WORKFLOW_HOOK_TIMEOUT_MS)

beforeEach(async () => {
  await harness.reset()
})

/** A reply a manager has confirmed: approved, authorized, its job queued. */
async function confirmReply(text = APPROVED_TEXT): Promise<Reply> {
  await harness.commands.draft(text)
  await harness.commands.submit()
  return harness.commands.approve()
}

async function storedReply(): Promise<Reply> {
  const reply = await harness.currentReply()
  if (!reply) throw new Error('The reply is gone')
  return reply
}

/** What a manager's screen shows of a reply: which one, at which revision. */
const screenOf = (reply: Reply) => ({ id: reply.id, stateRevision: reply.stateRevision })

const nextIntent = (reply: Reply) =>
  reviewReplyPublicationRequested({
    replyId: reply.id,
    reviewId: reply.reviewId,
    propertyId: WORKFLOW_PROPERTY,
    organizationId: WORKFLOW_ORG,
    userId: WORKFLOW_MANAGER,
    publicationCycle: reply.publicationCycle + 1,
    sourceEpoch: 0,
    materialReviewRevision: 1,
    baseObservationRevision: 0,
    occurredAt: harness.clock(),
  })

const approvedFact = (reply: Reply) =>
  reviewReplyApproved({
    replyId: reply.id,
    reviewId: reply.reviewId,
    propertyId: WORKFLOW_PROPERTY,
    organizationId: WORKFLOW_ORG,
    userId: WORKFLOW_MANAGER,
    authorId: WORKFLOW_MANAGER,
    occurredAt: harness.clock(),
  })

describe.sequential('reply command preconditions (PostgreSQL)', () => {
  describe('saving a draft', () => {
    it.each([
      ['authorized', async () => {}],
      [
        'sending',
        async () => {
          await harness.runPublishJob(0, 'timeout_lost')
        },
      ],
      [
        'pending_observation',
        async () => {
          await harness.runPublishJob(0, 'accepted')
        },
      ],
    ])(
      'refuses a reply whose publication is %s and leaves its text alone',
      async (publicationState, advancePublication) => {
        await confirmReply()
        await advancePublication()
        const before = await storedReply()
        expect(before).toMatchObject({ status: 'approved', publicationState })

        await expect(harness.commands.draft(LATER_TEXT)).rejects.toMatchObject(REFUSED)

        expect(await storedReply()).toEqual(before)
      },
    )

    it('never lets a reply be recorded as published with text Google did not receive', async () => {
      await confirmReply()
      await harness.runPublishJob(0, 'accepted')

      // A stale composer tab autosaves over the reply Google has just accepted.
      await harness.commands.draft(LATER_TEXT).catch(() => undefined)
      harness.advance(30 * MINUTE_MS)
      await harness.runSweep()
      await harness.observeGoogle()

      expect(harness.google.live?.text).toBe(APPROVED_TEXT)
      expect(await storedReply()).toMatchObject({
        status: 'published',
        publicationState: 'published',
        text: APPROVED_TEXT,
      })
    })

    it('loses a direct store write once the reply has been confirmed', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      const draft = await storedReply()
      await harness.commands.submit()
      await harness.commands.approve()
      const confirmed = await storedReply()

      // The snapshot a second entry point read before the approval, and the
      // confirmed row itself: neither is a draft the store may rewrite.
      await expect(
        harness.replyRepo.saveDraft(draft, { text: LATER_TEXT }),
      ).resolves.toBeNull()
      await expect(
        harness.replyRepo.saveDraft(confirmed, { text: LATER_TEXT }),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(confirmed)
    })
  })

  describe('Confirm & Publish', () => {
    it('refuses a reply whose last attempt may already be on Google', async () => {
      await confirmReply()
      await harness.runPublishJob(0, 'timeout_landed', true)
      const uncertain = await storedReply()
      expect(uncertain).toMatchObject({
        status: 'publish_failed',
        publicationState: 'ambiguous',
      })

      await expect(harness.commands.approve()).rejects.toMatchObject(REFUSED)

      expect(await storedReply()).toEqual(uncertain)
      expect(harness.jobs).toHaveLength(1)
      expect((await harness.evidence()).authorizations).toHaveLength(1)
    })

    it('loses a direct store authorization of an uncertain reply, with or without an approval fact', async () => {
      await confirmReply()
      await harness.runPublishJob(0, 'timeout_landed', true)
      const uncertain = await storedReply()

      await expect(
        harness.commandStore.markPublicationAuthorized(
          uncertain,
          {
            status: 'approved',
            approvedBy: WORKFLOW_MANAGER,
            approvedAt: harness.clock(),
          },
          {
            lifecycleEvent: approvedFact(uncertain),
            publicationIntent: nextIntent(uncertain),
          },
        ),
      ).resolves.toBeNull()
      await expect(
        harness.commandStore.markPublicationAuthorized(
          uncertain,
          { status: 'approved' },
          { lifecycleEvent: null, publicationIntent: nextIntent(uncertain) },
        ),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(uncertain)
      expect((await harness.evidence()).authorizations).toHaveLength(1)
    })

    /** A second manager rejects the pending reply, rewrites it and submits it
     * again: the same status and the same cycle, with different text. */
    async function replacePendingReply(): Promise<Reply> {
      await harness.commands.reject()
      await harness.commands.draft(LATER_TEXT)
      await harness.commands.submit()
      return storedReply()
    }

    it('refuses a reply that was rejected, rewritten and resubmitted since the manager’s screen showed it', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.submit()
      const onScreen = await storedReply()
      const replaced = await replacePendingReply()
      expect(replaced).toMatchObject({
        status: 'pending_approval',
        publicationCycle: onScreen.publicationCycle,
        text: LATER_TEXT,
      })

      // The confirm dialog still shows APPROVED_TEXT.
      await expect(harness.commands.approve(screenOf(onScreen))).rejects.toMatchObject({
        ...REFUSED,
        message: 'Reply status changed concurrently',
      })

      expect(await storedReply()).toEqual(replaced)
      expect(harness.jobs).toHaveLength(0)
      expect((await harness.evidence()).authorizations).toEqual([])
    })

    it('refuses a new reply that replaced a deleted one and stands at the same state revision', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.submit()
      const onScreen = await storedReply()

      // A second manager rejects it, deletes it, writes another and submits it.
      // A new reply row starts its revisions again: created, then submitted.
      await harness.commands.reject()
      await harness.commands.delete()
      await harness.commands.draft(LATER_TEXT)
      await harness.commands.submit()
      const replacement = await storedReply()
      expect(replacement.id).not.toBe(onScreen.id)
      expect(replacement).toMatchObject({
        status: 'pending_approval',
        stateRevision: onScreen.stateRevision,
        text: LATER_TEXT,
      })

      // The confirm dialog still shows APPROVED_TEXT.
      await expect(harness.commands.approve(screenOf(onScreen))).rejects.toMatchObject({
        ...REFUSED,
        message: 'Reply status changed concurrently',
      })
      // A second entry point that decided on the reply it read loses as well:
      // that reply is gone, and the write names it.
      await expect(
        harness.commandStore.markPublicationAuthorized(
          onScreen,
          { status: 'approved' },
          {
            lifecycleEvent: approvedFact(onScreen),
            publicationIntent: nextIntent(onScreen),
          },
        ),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(replacement)
      expect(harness.jobs).toHaveLength(0)
      expect((await harness.evidence()).authorizations).toEqual([])
    })

    it('confirms the reply the screen shows, and a caller with no screen confirms the stored one', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.submit()
      const onScreen = await storedReply()

      await expect(harness.commands.approve(screenOf(onScreen))).resolves.toMatchObject({
        status: 'approved',
        text: APPROVED_TEXT,
      })

      await harness.reset()
      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.submit()
      await expect(harness.commands.approve()).resolves.toMatchObject({
        status: 'approved',
        text: APPROVED_TEXT,
      })
    })

    it('loses a direct store authorization decided on a reply that has been replaced since it was read', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.submit()
      const read = await storedReply()
      const replaced = await replacePendingReply()

      await expect(
        harness.commandStore.markPublicationAuthorized(
          read,
          { status: 'approved' },
          { lifecycleEvent: approvedFact(read), publicationIntent: nextIntent(read) },
        ),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(replaced)
      expect((await harness.evidence()).authorizations).toEqual([])
    })
  })

  describe('Try publishing again', () => {
    it('refuses a reply that is still waiting for approval', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.submit()
      const pending = await storedReply()

      await expect(harness.commands.retry()).rejects.toMatchObject(REFUSED)

      expect(await storedReply()).toEqual(pending)
      expect(harness.jobs).toHaveLength(0)
      expect((await harness.evidence()).facts).toEqual({ 'review.reply.submitted': 1 })
    })

    it('loses a direct store authorization that approves without the approval fact', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.submit()
      const pending = await storedReply()

      await expect(
        harness.commandStore.markPublicationAuthorized(
          pending,
          { status: 'approved' },
          { lifecycleEvent: null, publicationIntent: nextIntent(pending) },
        ),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(pending)
    })

    it('loses a direct store retry whose snapshot calls an uncertain reply settled', async () => {
      await confirmReply()
      // The request left and no answer came back; no read found the reply, and
      // the 72-hour ladder of automatic checks ended without learning more.
      await harness.runPublishJob(0, 'timeout_lost', true)
      harness.advance(LADDER_END_MINUTES * MINUTE_MS)
      await harness.runSweep()
      const uncertain = await storedReply()
      expect(uncertain).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'ambiguous',
      })

      // A second entry point that read "retryable" where the row says
      // "ambiguous" would pass the retry's own rule on its snapshot. Its
      // intent is otherwise in order: it names the Google reads the sweep made.
      const calledSettled: Reply = {
        ...uncertain,
        publicationLastErrorClass: 'retryable',
      }
      const head = await pool.query<{ observation_revision: number }>(
        `SELECT observation_revision::int AS observation_revision
           FROM google_reply_observation_heads WHERE review_id = $1`,
        [WORKFLOW_REVIEW],
      )
      expect(head.rows[0]?.observation_revision).toBeGreaterThan(0)
      await expect(
        harness.commandStore.markPublicationAuthorized(
          calledSettled,
          { status: 'approved' },
          {
            lifecycleEvent: null,
            publicationIntent: {
              ...nextIntent(calledSettled),
              baseObservationRevision: head.rows[0]!.observation_revision,
            },
          },
        ),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(uncertain)
      expect((await harness.evidence()).authorizations).toHaveLength(1)
    })

    it('still sends a reply again after a failure that reached nobody', async () => {
      await confirmReply()
      await harness.runPublishJob(0, 'not_sent', true)
      expect(await storedReply()).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
      })

      await expect(harness.commands.retry()).resolves.toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 2,
        approvedBy: WORKFLOW_MANAGER,
      })
    })
  })

  describe('the reconciliation sweep', () => {
    it('does not report "not sent" for a cycle a worker claimed after the sweep read it', async () => {
      await confirmReply()
      harness.advance(PUBLICATION_RECOVERY_RECONCILE_DELAY_MS + MINUTE_MS)

      // The worker claims the row and its request is on the wire while the
      // sweep, holding the row as it was read, reaches it.
      const write = harness.holdNextWrite()
      let job: Promise<boolean> | undefined
      await harness.runSweep(async () => {
        job = harness.runPublishJob(0, 'accepted')
        await write.reached
      })
      write.release()
      await job

      expect(harness.google.live?.text).toBe(APPROVED_TEXT)
      expect(await storedReply()).toMatchObject({
        status: 'approved',
        publicationState: 'pending_observation',
      })
      expect((await harness.evidence()).facts).not.toHaveProperty(
        'review.reply.publish_failed',
      )
    })

    it('still ends a due cycle nobody claimed as not sent', async () => {
      await confirmReply()
      harness.advance(PUBLICATION_RECOVERY_RECONCILE_DELAY_MS + MINUTE_MS)

      await harness.runSweep()

      expect(await storedReply()).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
      })
      expect((await harness.evidence()).facts['review.reply.publish_failed']).toBe(1)
    })

    it('loses a terminal settlement and a cancellation decided on a row a worker has since claimed', async () => {
      const authorized = await confirmReply()
      await harness.runPublishJob(0, 'timeout_landed')
      const claimed = await storedReply()
      expect(claimed).toMatchObject({ status: 'approved', publicationState: 'sending' })
      const now = harness.clock()

      await expect(
        harness.commandStore.markPublicationTerminal(
          authorized,
          'retryable',
          reviewReplyPublishFailed({
            replyId: authorized.id,
            reviewId: WORKFLOW_REVIEW,
            propertyId: WORKFLOW_PROPERTY,
            organizationId: WORKFLOW_ORG,
            authorId: WORKFLOW_MANAGER,
            outcome: 'not_sent',
            occurredAt: now,
          }),
          now,
        ),
      ).resolves.toBeNull()
      await expect(
        harness.commandStore.cancelPublications([
          {
            reply: authorized,
            event: reviewReplyPublicationCancelled({
              replyId: authorized.id,
              reviewId: WORKFLOW_REVIEW,
              propertyId: WORKFLOW_PROPERTY,
              organizationId: WORKFLOW_ORG,
              authorId: WORKFLOW_MANAGER,
              cause: 'disconnect',
              occurredAt: now,
            }),
            now,
          },
        ]),
      ).resolves.toBe(0)

      expect(await storedReply()).toEqual(claimed)
      expect((await harness.evidence()).attempts).toMatchObject([
        { publicationCycle: 1, attemptNumber: 1, outcome: 'sending' },
      ])
    })
  })

  describe('recording a reply as published', () => {
    it('loses for a draft and for a reply awaiting approval: nothing is published that was never sent', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      const draft = await storedReply()
      const now = harness.clock()
      const publishedFact = (reply: Reply) =>
        reviewReplyPublished({
          replyId: reply.id,
          reviewId: WORKFLOW_REVIEW,
          propertyId: WORKFLOW_PROPERTY,
          organizationId: WORKFLOW_ORG,
          userId: null,
          authorId: WORKFLOW_MANAGER,
          occurredAt: now,
        })

      await expect(
        harness.commandStore.markPublished(
          draft,
          { status: 'published', publishedAt: now },
          publishedFact(draft),
          now,
        ),
      ).resolves.toBeNull()
      await harness.commands.submit()
      const pending = await storedReply()
      await expect(
        harness.commandStore.markPublished(
          pending,
          { status: 'published', publishedAt: now },
          publishedFact(pending),
          now,
        ),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(pending)
      expect((await harness.evidence()).facts).toEqual({ 'review.reply.submitted': 1 })
    })
  })

  describe('deleting a reply', () => {
    it('refuses, in words, a draft that was confirmed for publishing before, and keeps its evidence', async () => {
      await confirmReply()
      expect(await harness.cancelUndispatched()).toBe(1)
      const cancelled = await storedReply()
      expect(cancelled).toMatchObject({ status: 'draft', publicationState: 'cancelled' })

      await expect(harness.commands.delete()).rejects.toMatchObject({
        ...REFUSED,
        message: expect.stringContaining('confirmed for publishing'),
      })

      expect(await storedReply()).toEqual(cancelled)
      expect((await harness.evidence()).authorizations).toHaveLength(1)
    })

    it('refuses a rejected reply that was confirmed for publishing before', async () => {
      await confirmReply()
      await harness.cancelUndispatched()
      await harness.commands.submit()
      await harness.commands.reject()
      const rejected = await storedReply()
      expect(rejected).toMatchObject({ status: 'rejected', publicationCycle: 1 })

      await expect(harness.commands.delete()).rejects.toMatchObject(REFUSED)

      expect(await storedReply()).toEqual(rejected)
    })

    it('deletes a draft and a rejected reply that were never confirmed', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.delete()
      expect(await harness.currentReply()).toBeNull()

      await harness.commands.draft(APPROVED_TEXT)
      await harness.commands.submit()
      await harness.commands.reject()
      await harness.commands.delete()
      expect(await harness.currentReply()).toBeNull()
    })

    it('does not delete a reply that was submitted after the caller read it', async () => {
      await harness.commands.draft(APPROVED_TEXT)
      const draft = await storedReply()
      await harness.commands.submit()
      const pending = await storedReply()

      await expect(harness.replyRepo.deleteDraft(draft)).resolves.toBe(false)

      expect(await storedReply()).toEqual(pending)
    })
  })
})
