// An AI-assisted reply after its ten-minute adoption window, on PostgreSQL.
//
// The AI draft binding holds unedited AI text until a worker has claimed it for
// sending once: submit, Confirm & Publish and that first claim refuse it once
// it is stale. It must not hold the reply itself. These tests run the real use
// cases, command store, publish worker and sweep
// (testing/reply-workflow-harness.ts) over a suggestion adopted through the
// real acceptance store, let the window pass, and check both halves: the three
// gates still refuse, and every other command still has somewhere to go.
//
// A claim the gate refuses withdraws the reply as the AI draft purge would:
// what that purge and the commands make of each other is in
// reply-ai-withdrawal.integration.test.ts.

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
  reviewReplyPublicationRequested,
  reviewReplyRejected,
  reviewReplySubmitted,
} from '../domain/events'
import {
  createReplyWorkflowHarness,
  WORKFLOW_HOOK_TIMEOUT_MS,
  WORKFLOW_MANAGER,
  WORKFLOW_ORG,
  WORKFLOW_PROPERTY,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const AI_TEXT = 'Thank you for sharing your experience.'
const OTHER_AI_TEXT = 'We are glad you enjoyed your stay with us.'
const TYPED_TEXT = 'Thank you, Anna. We hope to see you again.'
const MINUTE_MS = 60_000
const STALE = { _tag: 'ReviewError', code: 'ai_suggestion_stale' }
/** What a refused claim leaves: an empty draft that claims no AI authorship. */
const WITHDRAWN = {
  status: 'draft',
  publicationState: 'cancelled',
  text: '',
  aiGenerated: false,
}

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

async function storedReply(): Promise<Reply> {
  const reply = await harness.currentReply()
  if (!reply) throw new Error('The reply is gone')
  return reply
}

/** What the row itself says about where its text came from. */
async function provenance(replyId: string) {
  const { rows } = await pool.query<{
    authorship: string
    origin_operation_id: string | null
    ai_draft_expires_at: Date | null
  }>(
    `SELECT authorship, origin_operation_id, ai_draft_expires_at
       FROM replies WHERE id = $1`,
    [replyId],
  )
  return rows[0]
}

/** What the AI operation a reply was adopted from says became of its text. */
async function adoptionOf(operationId: string | null | undefined) {
  const { rows } = await pool.query<{ reply_adoption_disposition: string | null }>(
    `SELECT reply_adoption_disposition FROM ai_operations WHERE id = $1`,
    [operationId],
  )
  return rows[0]?.reply_adoption_disposition
}

const HUMAN = {
  authorship: 'human',
  origin_operation_id: null,
  ai_draft_expires_at: null,
}

/** A manager adopts the suggestion unedited; its binding is current. */
async function adoptSuggestion(): Promise<Reply> {
  const reply = await harness.commands.adoptAiSuggestion(AI_TEXT)
  expect(reply).toMatchObject({ status: 'draft', text: AI_TEXT, aiGenerated: true })
  expect(await harness.ai.bindingOf(reply.id)).toBe('current')
  return reply
}

/** The window passes: the stored reply, now with a stale binding. */
async function afterTheWindow(): Promise<Reply> {
  expect(await harness.ai.letWindowPass()).toBe(1)
  const reply = await storedReply()
  expect(await harness.ai.bindingOf(reply.id)).toBe('stale')
  return reply
}

const fact = (reply: Reply) => ({
  replyId: reply.id,
  reviewId: reply.reviewId,
  propertyId: WORKFLOW_PROPERTY,
  organizationId: WORKFLOW_ORG,
  userId: WORKFLOW_MANAGER,
  occurredAt: harness.clock(),
})

describe.sequential('AI-assisted reply after its adoption window (PostgreSQL)', () => {
  describe('the gates that stay', () => {
    it('refuses to submit a stale AI draft, by the use case and by the store', async () => {
      await adoptSuggestion()
      const stale = await afterTheWindow()

      await expect(harness.commands.submit()).rejects.toMatchObject(STALE)
      await expect(
        harness.commandStore.submitReply(
          stale,
          { status: 'pending_approval', submittedAt: harness.clock() },
          reviewReplySubmitted(fact(stale)),
        ),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(stale)
    })

    it('refuses to confirm and publish a stale AI reply, by the use case and by the store', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      const stale = await afterTheWindow()
      expect(stale.status).toBe('pending_approval')

      await expect(harness.commands.approve()).rejects.toMatchObject(STALE)
      await expect(
        harness.commandStore.markPublicationAuthorized(
          stale,
          { status: 'approved' },
          {
            lifecycleEvent: reviewReplyApproved({
              ...fact(stale),
              authorId: WORKFLOW_MANAGER,
            }),
            publicationIntent: reviewReplyPublicationRequested({
              ...fact(stale),
              publicationCycle: stale.publicationCycle + 1,
              sourceEpoch: 0,
              materialReviewRevision: 1,
              baseObservationRevision: 0,
            }),
          },
        ),
      ).resolves.toBeNull()

      expect(await storedReply()).toEqual(stale)
      expect((await harness.evidence()).authorizations).toEqual([])
    })

    it('does not send AI text whose binding went stale after Confirm & Publish: the refused claim withdraws it', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      await harness.commands.approve()
      const stale = await afterTheWindow()
      expect(stale).toMatchObject({ status: 'approved', publicationState: 'authorized' })

      // The worker's claim is the last gate: nothing leaves RepKey, and the
      // cycle does not wait for the sweep. The reply is a draft again with
      // the AI's text removed, as the purge would have left it at the next
      // sync, and one cancellation fact tells the people waiting.
      await harness.runPublishJob(0, 'accepted')
      expect(harness.google.calls).toBe(0)
      expect(await storedReply()).toMatchObject({ ...WITHDRAWN, id: stale.id })
      const after = await harness.evidence()
      expect(after.attempts).toEqual([])
      expect(after.authorizations).toHaveLength(1)
      expect(after.facts['review.reply.publication_cancelled']).toBe(1)
      expect(after.facts['review.reply.publish_failed']).toBeUndefined()

      // There is nothing to submit until a manager writes a reply into it.
      await expect(harness.commands.submit()).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_reply',
      })
      await harness.commands.draft(TYPED_TEXT)
      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(1, 'accepted')
      expect(harness.google.sent.map((sent) => sent.text)).toEqual([TYPED_TEXT])
    })

    it('does not send it on Try publishing again either, when the sweep ended a cycle nobody claimed', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      await harness.commands.approve()
      await afterTheWindow()

      // No worker ran in time: the sweep ends the cycle as "not sent".
      harness.advance(30 * MINUTE_MS)
      await harness.runSweep()
      expect(await storedReply()).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
        aiGenerated: true,
      })

      // Trying again authorizes a cycle and reads no binding. The claim of
      // that cycle does: this text was never claimed while it was current.
      const retried = await harness.commands.retry()
      expect(retried).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 2,
        aiGenerated: true,
      })
      await harness.runPublishJob(1, 'accepted')

      expect(harness.google.calls).toBe(0)
      expect(await storedReply()).toMatchObject({ ...WITHDRAWN, publicationCycle: 2 })
      expect((await harness.evidence()).attempts).toEqual([])
    })
  })

  describe('what the window no longer blocks', () => {
    it('lets a manager type over a stale AI draft, which makes the reply theirs', async () => {
      const adopted = await adoptSuggestion()
      await afterTheWindow()

      const typed = await harness.commands.draft(TYPED_TEXT)

      expect(typed).toMatchObject({
        id: adopted.id,
        status: 'draft',
        text: TYPED_TEXT,
        aiGenerated: false,
      })
      expect(await provenance(adopted.id)).toEqual(HUMAN)
      // A human-authored draft has no window: it goes the normal way.
      await harness.commands.submit()
      await expect(harness.commands.approve()).resolves.toMatchObject({
        status: 'approved',
        text: TYPED_TEXT,
      })
    })

    it('lets an approver reject a pending AI reply after its window, and its author rework it', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      const stale = await afterTheWindow()

      await expect(harness.commands.reject()).resolves.toMatchObject({
        status: 'rejected',
        text: AI_TEXT,
      })
      // "Edit & resubmit" saves the same text again: a manager took it over.
      const reworked = await harness.commands.draft(AI_TEXT)
      expect(reworked).toMatchObject({ status: 'draft', aiGenerated: false })
      expect(await provenance(stale.id)).toEqual(HUMAN)
      await expect(harness.commands.submit()).resolves.toMatchObject({
        status: 'pending_approval',
      })
    })

    it('rejects through the store too: a second entry point is not blocked by the window', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      const stale = await afterTheWindow()

      await expect(
        harness.commandStore.rejectReply(
          stale,
          { status: 'rejected', rejectedBy: WORKFLOW_MANAGER, rejectionReason: null },
          reviewReplyRejected({
            ...fact(stale),
            authorId: WORKFLOW_MANAGER,
            reason: null,
          }),
        ),
      ).resolves.toMatchObject({ status: 'rejected' })
    })

    it('tries publishing again after the window when Google refused the first attempt, and the text stays the AI’s', async () => {
      const adopted = await adoptSuggestion()
      const adoptedFrom = await provenance(adopted.id)
      await harness.commands.submit()
      await harness.commands.approve()
      // Claimed and sent while its binding was current: it passed its last gate.
      await harness.runPublishJob(0, 'rejected')
      const failed = await afterTheWindow()
      expect(failed).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'terminal_rejection',
      })
      const disposition = await adoptionOf(adoptedFrom?.origin_operation_id)

      const retried = await harness.commands.retry()

      // A retry changes no text, so it changes no label: the reply is still
      // the suggestion a manager adopted, and the export goes on saying so.
      expect(retried).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 2,
        text: AI_TEXT,
        aiGenerated: true,
      })
      expect(await provenance(failed.id)).toMatchObject({
        authorship: 'ai_assisted',
        origin_operation_id: adoptedFrom?.origin_operation_id,
      })
      expect(adoptedFrom?.origin_operation_id).toEqual(expect.any(String))
      expect(await adoptionOf(adoptedFrom?.origin_operation_id)).toBe(disposition)

      // The claim of the new cycle does not ask the binding again.
      expect(await harness.ai.bindingOf(failed.id)).toBe('stale')
      await harness.runPublishJob(1, 'accepted')
      await harness.observeGoogle()
      expect(await storedReply()).toMatchObject({
        status: 'published',
        text: AI_TEXT,
        aiGenerated: true,
      })
      expect(harness.google.live?.text).toBe(AI_TEXT)
      expect(harness.google.violations).toEqual([])
    })

    it('sends a queued attempt again after the window: the text was claimed once already', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      await harness.commands.approve()
      // The first execution claims it and is refused inside RepKey; the job is
      // queued for another execution of the same cycle.
      await harness.runPublishJob(0, 'not_sent')
      const queuedAgain = await afterTheWindow()
      expect(queuedAgain).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationAttempts: 1,
      })

      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.sent.map((sent) => sent.text)).toEqual([AI_TEXT])
      expect(await storedReply()).toMatchObject({
        status: 'approved',
        publicationState: 'pending_observation',
        publicationAttempts: 2,
        aiGenerated: true,
      })
    })

    it('does not count a claim of other text: a newly adopted suggestion passes the gate for itself', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(0, 'not_sent')
      expect(await harness.cancelUndispatched()).toBe(1)
      // The same reply row, with another suggestion's words.
      const second = await harness.commands.adoptAiSuggestion(OTHER_AI_TEXT)
      expect(second).toMatchObject({ status: 'draft', text: OTHER_AI_TEXT })
      await harness.commands.submit()
      await harness.commands.approve()
      await afterTheWindow()

      await harness.runPublishJob(1, 'accepted')

      expect(harness.google.sent).toEqual([])
      expect(await storedReply()).toMatchObject(WITHDRAWN)
    })

    it('edits a published AI reply after the window, and records the edit as the manager’s text', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(0, 'accepted')
      await harness.observeGoogle()
      const published = await afterTheWindow()
      // Publishing did not relabel it: the text is still the AI's, unedited.
      expect(published).toMatchObject({ status: 'published', aiGenerated: true })

      const edited = await harness.commands.editPublished(TYPED_TEXT)

      expect(edited).toMatchObject({
        status: 'approved',
        publicationCycle: 2,
        text: TYPED_TEXT,
        aiGenerated: false,
      })
      expect(await provenance(published.id)).toEqual(HUMAN)
      await harness.runPublishJob(1, 'accepted')
      await harness.observeGoogle()
      expect(await storedReply()).toMatchObject({ status: 'published', text: TYPED_TEXT })
    })

    it('lets a manager rewrite an AI reply whose confirmed publication was cancelled', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      await harness.commands.approve()
      expect(await harness.cancelUndispatched()).toBe(1)
      const cancelled = await afterTheWindow()
      expect(cancelled).toMatchObject({ status: 'draft', publicationState: 'cancelled' })

      // Unedited, it is still AI text and still stale: submitting it is refused.
      await expect(harness.commands.submit()).rejects.toMatchObject(STALE)

      await expect(harness.commands.draft(TYPED_TEXT)).resolves.toMatchObject({
        status: 'draft',
        text: TYPED_TEXT,
        aiGenerated: false,
      })
      await expect(harness.commands.submit()).resolves.toMatchObject({
        status: 'pending_approval',
      })
    })
  })
})
