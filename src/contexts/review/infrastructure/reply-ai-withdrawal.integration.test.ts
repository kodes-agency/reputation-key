// The reply commands and the AI draft purge on one reply, on PostgreSQL.
//
// Two rules meet on an AI-assisted reply. Each reply command starts only from
// the states it names and carries that as the compare-and-set of its write
// (reply-write-guards.ts). The AI draft purge
// (src/shared/db/ai/ai-draft-purge.ts) withdraws unedited AI text that may no
// longer be published: it deletes a reply nobody confirmed, and empties one
// that has publication evidence behind it. The purge writes SQL of its own, in
// other contexts' transactions, and knows nothing of the guards.
//
// These tests run the real use cases, command store, publish worker and purge
// (testing/reply-workflow-harness.ts) and check that the two compose: what the
// commands make of a reply the purge emptied, what a command that read the
// reply before the purge does after it, what a command does that has to wait
// for the purge's locks, and that the worker's claim and the purge agree on
// which AI text may still leave RepKey.

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
  WORKFLOW_ORG,
  WORKFLOW_PROPERTY,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const AI_TEXT = 'Thank you for sharing your experience.'
const OTHER_AI_TEXT = 'We are glad you enjoyed your stay with us.'
const TYPED_TEXT = 'Thank you, Anna. We hope to see you again.'
const MINUTE_MS = 60_000
const LOCK_POLL_MS = 20
const LOCK_WAIT_MS = 10_000

const INVALID_TRANSITION = { _tag: 'ReviewError', code: 'invalid_transition' }
const CHANGED_CONCURRENTLY = {
  ...INVALID_TRANSITION,
  message: 'Reply status changed concurrently',
}

/** What a withdrawal leaves of a reply that has publication evidence: an empty
 * draft that claims no AI authorship, with its cancelled cycle on record. */
const WITHDRAWN = {
  status: 'draft',
  publicationState: 'cancelled',
  text: '',
  aiGenerated: false,
  reconcileDueAt: null,
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

/** The cause of every cancellation fact recorded so far, oldest first. */
async function cancellationCauses(): Promise<string[]> {
  const { rows } = await pool.query<{ cause: string }>(
    `SELECT payload->>'cause' AS cause FROM outbox_events
      WHERE organization_id = $1
        AND event_type = 'review.reply.publication_cancelled'
      ORDER BY created_at, id`,
    [WORKFLOW_ORG],
  )
  return rows.map((row) => row.cause)
}

/** A manager adopts the suggestion unedited and submits it. */
async function pendingAiReply(): Promise<Reply> {
  await harness.commands.adoptAiSuggestion(AI_TEXT)
  return harness.commands.submit()
}

/** The same, confirmed: `approved` / `authorized`, waiting for the worker. */
async function confirmedAiReply(): Promise<Reply> {
  await pendingAiReply()
  const confirmed = await harness.commands.approve()
  expect(confirmed).toMatchObject({
    status: 'approved',
    publicationState: 'authorized',
    text: AI_TEXT,
    aiGenerated: true,
  })
  return confirmed
}

/** The same, back in draft after a disconnect cancelled its cycle: still the
 * AI's text, and its binding still current. */
async function cancelledAiDraft(): Promise<Reply> {
  await confirmedAiReply()
  expect(await harness.cancelUndispatched()).toBe(1)
  const draft = await storedReply()
  expect(draft).toMatchObject({
    status: 'draft',
    publicationState: 'cancelled',
    text: AI_TEXT,
    aiGenerated: true,
  })
  expect(await harness.ai.bindingOf(draft.id)).toBe('current')
  return draft
}

/** The worker's claim, with the fences its job was queued under. */
function claim(reply: Reply, jobIndex = 0): Promise<Reply | null> {
  const job = harness.jobs[jobIndex]
  if (!job) throw new Error('No publish job was queued')
  return harness.commandStore.markPublicationSending(reply, {
    propertyId: WORKFLOW_PROPERTY,
    sourceEpoch: job.data.sourceEpoch ?? 0,
    materialReviewRevision: job.data.materialReviewRevision ?? 1,
    baseObservationRevision: job.data.baseObservationRevision ?? 0,
    providerOperationKey: `reply-ai-withdrawal:${reply.id}:${reply.publicationCycle}`,
  })
}

/** Backends of this database that are queued on a lock right now. */
async function lockWaiters(): Promise<number> {
  const { rows } = await pool.query<{ waiting: number }>(
    `SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`,
  )
  return rows[0]?.waiting ?? 0
}

async function untilSomethingWaitsOnALock(): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS
  while ((await lockWaiters()) === 0) {
    if (Date.now() > deadline) throw new Error('Nothing queued on the purge’s locks')
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
  }
}

/**
 * Run `command` against a purge that has written and not yet committed: the
 * purge holds the reply row and, through the reply revision trigger, its
 * Review row. The command queues on one of them, the purge commits, and the
 * command goes on against what the purge left. Returns what the command did.
 */
async function whileThePurgeHoldsItsLocks<T>(command: () => Promise<T>): Promise<T> {
  const purged = Promise.withResolvers<void>()
  const commit = Promise.withResolvers<void>()
  const purge = harness.ai.changeInput(async () => {
    purged.resolve()
    await commit.promise
  })
  purge.catch(purged.reject)
  await purged.promise
  const outcome = command()
  // A rejection is the test's to read; it must not surface before then.
  outcome.catch(() => undefined)
  try {
    await untilSomethingWaitsOnALock()
  } finally {
    commit.resolve()
    await purge
  }
  return outcome
}

describe.sequential('reply commands and the AI draft purge (PostgreSQL)', () => {
  describe('a confirmed reply the purge emptied', () => {
    it('is an empty draft that no command puts forward, and that keeps its publication record', async () => {
      const confirmed = await confirmedAiReply()

      await harness.ai.changeInput()

      const withdrawn = await storedReply()
      expect(withdrawn).toMatchObject({
        ...WITHDRAWN,
        id: confirmed.id,
        publicationCycle: 1,
      })
      expect(await cancellationCauses()).toEqual(['ai_draft_withdrawn'])
      const before = await harness.evidence()
      expect(before.authorizations).toHaveLength(1)

      // Blank text is not a reply (Invariant 5): nothing submits it.
      await expect(harness.commands.submit()).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_reply',
        message: 'Reply text cannot be empty',
      })
      // It is a draft, so the publication commands have nothing to start from.
      await expect(harness.commands.approve()).rejects.toMatchObject(INVALID_TRANSITION)
      await expect(harness.commands.reject()).rejects.toMatchObject(INVALID_TRANSITION)
      await expect(harness.commands.retry()).rejects.toMatchObject(INVALID_TRANSITION)
      await expect(harness.commands.editPublished(TYPED_TEXT)).rejects.toMatchObject(
        INVALID_TRANSITION,
      )
      // Its authorization is evidence, and the evidence keeps the reply.
      await expect(harness.commands.delete()).rejects.toMatchObject({
        ...INVALID_TRANSITION,
        message: expect.stringContaining('keeps it with its publication record'),
      })
      // The job queued for the cancelled cycle finds a draft and sends nothing.
      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.calls).toBe(0)
      expect(await harness.evidence()).toEqual(before)
    })

    it('takes the reply a manager types into it, and publishes that', async () => {
      const confirmed = await confirmedAiReply()
      await harness.ai.changeInput()

      const typed = await harness.commands.draft(TYPED_TEXT)

      expect(typed).toMatchObject({
        id: confirmed.id,
        status: 'draft',
        publicationState: 'cancelled',
        text: TYPED_TEXT,
        aiGenerated: false,
      })
      await harness.commands.submit()
      await expect(harness.commands.approve()).resolves.toMatchObject({
        status: 'approved',
        publicationCycle: 2,
      })
      await harness.runPublishJob(1, 'accepted')
      await harness.observeGoogle()
      expect(await storedReply()).toMatchObject({ status: 'published', text: TYPED_TEXT })
      expect(harness.google.sent.map((sent) => sent.text)).toEqual([TYPED_TEXT])
      expect(harness.google.violations).toEqual([])
    })

    it('takes a newly adopted suggestion, which is held by its own binding', async () => {
      const confirmed = await confirmedAiReply()
      await harness.ai.changeInput()

      const adopted = await harness.commands.adoptAiSuggestion(OTHER_AI_TEXT)

      expect(adopted).toMatchObject({
        id: confirmed.id,
        status: 'draft',
        text: OTHER_AI_TEXT,
        aiGenerated: true,
      })
      expect(await harness.ai.bindingOf(adopted.id)).toBe('current')
      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(1, 'accepted')
      expect(harness.google.sent.map((sent) => sent.text)).toEqual([OTHER_AI_TEXT])
      expect(harness.google.violations).toEqual([])
    })
  })

  describe('the purge and the publish worker', () => {
    it('gives nothing to a worker that read the reply before the purge', async () => {
      const readByTheWorker = await confirmedAiReply()

      await harness.ai.changeInput()

      await expect(claim(readByTheWorker)).resolves.toBeNull()
      const after = await harness.evidence()
      expect(after.reply).toMatchObject(WITHDRAWN)
      expect(after.attempts).toEqual([])
      // One notice, the purge's: the refused claim adds none.
      expect(await cancellationCauses()).toEqual(['ai_draft_withdrawn'])
    })

    it('gives nothing to a worker whose claim had to wait for the purge', async () => {
      await confirmedAiReply()

      await whileThePurgeHoldsItsLocks(() => harness.runPublishJob(0, 'accepted'))

      expect(harness.google.calls).toBe(0)
      const after = await harness.evidence()
      expect(after.reply).toMatchObject(WITHDRAWN)
      expect(after.attempts).toEqual([])
      expect(await cancellationCauses()).toEqual(['ai_draft_withdrawn'])
    })

    it('leaves a reply the worker is sending, and its text, to the worker', async () => {
      await confirmedAiReply()
      const write = harness.holdNextWrite()
      const sending = harness.runPublishJob(0, 'accepted')
      await write.reached

      // The request has left RepKey: the text may be on Google.
      await harness.ai.changeInput()

      expect(await storedReply()).toMatchObject({
        status: 'approved',
        publicationState: 'sending',
        text: AI_TEXT,
        aiGenerated: true,
      })
      expect(await cancellationCauses()).toEqual([])
      write.release()
      await sending
      await harness.observeGoogle()
      expect(await storedReply()).toMatchObject({ status: 'published', text: AI_TEXT })
      expect(harness.google.live?.text).toBe(AI_TEXT)
    })

    it('withdraws a cycle that was waiting for its next execution, and that execution sends nothing', async () => {
      await confirmedAiReply()
      // Claimed once and refused inside RepKey: queued for another execution.
      await harness.runPublishJob(0, 'not_sent')
      expect(await storedReply()).toMatchObject({
        publicationState: 'authorized',
        publicationAttempts: 1,
      })

      await harness.ai.changeInput()
      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.sent).toEqual([])
      const after = await harness.evidence()
      expect(after.reply).toMatchObject({ ...WITHDRAWN, publicationAttempts: 1 })
      expect(after.attempts.map((attempt) => attempt.outcome)).toEqual(['superseded'])
    })
  })

  describe('a claim the AI text gate refuses', () => {
    it('withdraws the reply as the purge would, and says so: the next sync has nothing left to remove', async () => {
      await confirmedAiReply()
      expect(await harness.ai.letWindowPass()).toBe(1)

      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.calls).toBe(0)
      const withdrawn = await harness.evidence()
      expect(withdrawn.reply).toMatchObject({ ...WITHDRAWN, publicationCycle: 1 })
      expect(withdrawn.attempts).toEqual([])
      // The notice the people waiting get is the one that is true: the AI
      // draft was removed. Not "this property can no longer publish".
      expect(await cancellationCauses()).toEqual(['ai_draft_withdrawn'])

      // The purge a sync runs for replies past their window finds a reply
      // that is already what it would have left, and records nothing.
      await harness.ai.observeReviewAgain()
      expect(await harness.evidence()).toEqual(withdrawn)
    })
  })

  describe('AI text that was claimed once, after something it was generated from changed', () => {
    it('is not sent by Try publishing again: the claim of the new cycle withdraws it', async () => {
      await confirmedAiReply()
      // Claimed while its binding was current, and refused by Google.
      await harness.runPublishJob(0, 'rejected')
      expect(harness.google.calls).toBe(1)
      // The purge leaves a publication that ran to its end alone.
      await harness.ai.changeInput()
      const failed = await storedReply()
      expect(failed).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        text: AI_TEXT,
        aiGenerated: true,
      })
      expect(await harness.ai.bindingOf(failed.id)).toBe('stale')

      // A failed reply has no other command, so the retry authorizes a cycle.
      await expect(harness.commands.retry()).resolves.toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 2,
      })
      await harness.runPublishJob(1, 'accepted')

      // The words passed every gate once. That excuses the ten minutes, not a
      // changed input: nothing more leaves RepKey.
      expect(harness.google.calls).toBe(1)
      expect(harness.google.live).toBeNull()
      expect(await storedReply()).toMatchObject({ ...WITHDRAWN, publicationCycle: 2 })
      expect(await cancellationCauses()).toEqual(['ai_draft_withdrawn'])
      expect(harness.google.violations).toEqual([])
    })

    it('is still sent when only its ten minutes have passed', async () => {
      await confirmedAiReply()
      await harness.runPublishJob(0, 'rejected')
      expect(await harness.ai.letWindowPass()).toBe(1)

      await harness.commands.retry()
      await harness.runPublishJob(1, 'accepted')

      expect(harness.google.live?.text).toBe(AI_TEXT)
      expect(harness.google.violations).toEqual([])
    })
  })

  describe('the purge and Confirm & Publish', () => {
    it('refuses a confirmation left open over a reply the purge deleted, and over the reply written in its place', async () => {
      const pending = await pendingAiReply()
      const onScreen = { id: pending.id, stateRevision: pending.stateRevision }

      await harness.ai.changeInput()

      expect(await harness.currentReply()).toBeNull()
      expect(await cancellationCauses()).toEqual(['ai_draft_withdrawn'])
      await expect(harness.commands.approve(onScreen)).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'reply_not_found',
      })
      // Another reply, pending at the very revision the screen showed.
      await harness.commands.draft(TYPED_TEXT)
      const rewritten = await harness.commands.submit()
      expect(rewritten.id).not.toBe(pending.id)
      expect(rewritten.stateRevision).toBe(pending.stateRevision)
      await expect(harness.commands.approve(onScreen)).rejects.toMatchObject(
        CHANGED_CONCURRENTLY,
      )
      expect((await harness.evidence()).authorizations).toEqual([])
    })

    it('refuses a confirmation that had to wait for the purge', async () => {
      const pending = await pendingAiReply()
      const onScreen = { id: pending.id, stateRevision: pending.stateRevision }

      const confirmation = whileThePurgeHoldsItsLocks(() =>
        harness.commands.approve(onScreen),
      )

      await expect(confirmation).rejects.toMatchObject(CHANGED_CONCURRENTLY)
      const after = await harness.evidence()
      expect(after.reply).toBeNull()
      expect(after.authorizations).toEqual([])
      expect(after.facts['review.reply.approved']).toBeUndefined()
      expect(harness.jobs).toEqual([])
    })

    it('refuses a confirmation of a resubmitted reply the purge emptied', async () => {
      await cancelledAiDraft()
      const pending = await harness.commands.submit()
      expect(pending).toMatchObject({
        status: 'pending_approval',
        publicationState: 'cancelled',
      })

      await harness.ai.changeInput()

      await expect(
        harness.commands.approve({
          id: pending.id,
          stateRevision: pending.stateRevision,
        }),
      ).rejects.toMatchObject(INVALID_TRANSITION)
      expect(await storedReply()).toMatchObject(WITHDRAWN)
      expect((await harness.evidence()).authorizations).toHaveLength(1)
    })
  })

  describe('the purge and a draft save', () => {
    it('refuses a save from a composer that still shows the confirmed reply', async () => {
      const confirmed = await confirmedAiReply()
      await harness.ai.changeInput()

      await expect(
        harness.replyRepo.saveDraft(confirmed, { text: TYPED_TEXT }),
      ).resolves.toBeNull()

      expect(await storedReply()).toMatchObject(WITHDRAWN)
    })

    it('writes a save that had to wait for the purge into the emptied reply, as the manager’s text', async () => {
      const draft = await cancelledAiDraft()

      const saved = await whileThePurgeHoldsItsLocks(() =>
        harness.commands.draft(TYPED_TEXT),
      )

      expect(saved).toMatchObject({
        id: draft.id,
        status: 'draft',
        publicationState: 'cancelled',
        text: TYPED_TEXT,
        aiGenerated: false,
      })
      expect(await storedReply()).toMatchObject({ text: TYPED_TEXT, aiGenerated: false })
    })

    it('keeps a reply the manager typed over before the purge ran', async () => {
      await cancelledAiDraft()
      await harness.commands.draft(TYPED_TEXT)

      await harness.ai.changeInput()

      expect(await storedReply()).toMatchObject({
        status: 'draft',
        text: TYPED_TEXT,
        aiGenerated: false,
      })
    })
  })

  describe('the purge and Submit', () => {
    // The emptying leaves the draft a draft, in the same cancelled cycle, so
    // only the state revision tells the reply Submit read from what is left.
    // (ai-draft-purge.integration.test.ts pins the same through the store.)
    it('does not submit, as an empty reply, a draft the purge emptied while Submit waited', async () => {
      await cancelledAiDraft()
      const before = (await harness.evidence()).facts['review.reply.submitted']

      const submitted = whileThePurgeHoldsItsLocks(() => harness.commands.submit())

      await expect(submitted).rejects.toMatchObject(CHANGED_CONCURRENTLY)
      const after = await harness.evidence()
      expect(after.reply).toMatchObject(WITHDRAWN)
      expect(after.facts['review.reply.submitted']).toBe(before)
    })
  })

  describe('a reply nobody confirmed', () => {
    it('is deleted by the purge, and the review takes a new draft', async () => {
      const pending = await pendingAiReply()

      await harness.ai.changeInput()

      expect(await harness.currentReply()).toBeNull()
      await expect(harness.commands.reject()).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'reply_not_found',
      })
      const anew = await harness.commands.draft(TYPED_TEXT)
      expect(anew).toMatchObject({ status: 'draft', publicationState: null })
      expect(anew.id).not.toBe(pending.id)
    })

    it('is left alone by a sync while its binding is current, and deleted by one once its window has passed', async () => {
      await harness.commands.adoptAiSuggestion(AI_TEXT)

      await harness.ai.observeReviewAgain()
      expect(await storedReply()).toMatchObject({ text: AI_TEXT, aiGenerated: true })

      harness.advance(10 * MINUTE_MS)
      expect(await harness.ai.letWindowPass()).toBe(1)
      await harness.ai.observeReviewAgain()
      expect(await harness.currentReply()).toBeNull()
    })
  })
})
