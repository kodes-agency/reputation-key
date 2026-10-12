// An AI-assisted reply after its ten-minute adoption window, on PostgreSQL.
//
// The AI draft binding holds unedited AI text until a manager's Confirm &
// Publish is sent: submit, Confirm & Publish and the worker's claim refuse it
// once it is stale. It must not hold the reply itself. These tests run the real
// use cases, command store, publish worker and sweep
// (testing/reply-workflow-harness.ts) over a suggestion adopted through the
// real acceptance store, let the window pass, and check both halves: the three
// gates still refuse, and every other command still has somewhere to go.

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
const TYPED_TEXT = 'Thank you, Anna. We hope to see you again.'
const MINUTE_MS = 60_000
const STALE = { _tag: 'ReviewError', code: 'ai_suggestion_stale' }

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

    it('does not send AI text whose binding went stale after Confirm & Publish, and lets a manager send it again', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      await harness.commands.approve()
      const stale = await afterTheWindow()
      expect(stale).toMatchObject({ status: 'approved', publicationState: 'authorized' })

      // The worker's claim is the last gate: nothing leaves RepKey.
      await harness.runPublishJob(0, 'accepted')
      expect(harness.google.calls).toBe(0)
      expect(await storedReply()).toEqual(stale)

      // The cycle nobody could claim ends as "not sent". Trying again is the
      // manager's own command on text a manager confirmed in time.
      harness.advance(30 * MINUTE_MS)
      await harness.runSweep()
      expect(await storedReply()).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
      })

      const retried = await harness.commands.retry()
      expect(retried).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 2,
        text: AI_TEXT,
        aiGenerated: false,
      })
      await harness.runPublishJob(1, 'accepted')
      expect(harness.google.sent.map((sent) => sent.text)).toEqual([AI_TEXT])
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

    it('tries publishing again after the window when Google refused the first attempt', async () => {
      await adoptSuggestion()
      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(0, 'rejected')
      const failed = await afterTheWindow()
      expect(failed).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'terminal_rejection',
      })

      const retried = await harness.commands.retry()

      // A retry is a manager's command on text a manager already confirmed and
      // RepKey already sent once: the reply is theirs from here on.
      expect(retried).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 2,
        text: AI_TEXT,
        aiGenerated: false,
      })
      expect(await provenance(failed.id)).toEqual(HUMAN)
      await harness.runPublishJob(1, 'accepted')
      await harness.observeGoogle()
      expect(await storedReply()).toMatchObject({ status: 'published', text: AI_TEXT })
      expect(harness.google.live?.text).toBe(AI_TEXT)
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
