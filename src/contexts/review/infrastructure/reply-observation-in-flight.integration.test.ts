// A read of Google while an edit-and-republish is in flight, on PostgreSQL.
//
// A published reply is edited and the worker sends the edit. Until Google
// shows it, a read of the review answers with the reply that was there before:
// RepKey's own earlier publication. That happens in two orders. The read was
// taken before the write landed and is recorded after the claim (a sync
// fetches a page, then applies it review by review): that needs nothing of
// Google, only the two transactions in that order. Or the read is made after
// Google accepted the write, and Google's read path is still behind it. The
// first sweep read comes one to five minutes after the write, and a first
// reply is known to take minutes to show; whether an edit does too has not
// been measured against Google, so the stand-in is told to be behind.
//
// Either way the earlier reply is no competing reply, and it says nothing
// about the edit. These tests run the real use cases, command store,
// observation store, publish worker and reconciliation sweep
// (testing/reply-workflow-harness.ts) through each order and each reader of
// Google, and compare what RepKey records with what the stand-in Google holds.

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
  WORKFLOW_REVIEW,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const FIRST_TEXT = 'Thanks!'
const EDITED_TEXT = 'Thank you, Anna!'
const OTHER_TEXT = 'A reply someone posted directly on Google.'
const MINUTE_MS = 60_000
/** Review CONTEXT, Invariant 9: the propagation grace is fifteen minutes. */
const PAST_THE_GRACE_MINUTES = 16
/** Past the last rung of the 72-hour read ladder of an uncertain attempt. */
const LADDER_END_MINUTES = 4_800
/** The publish job of the edit: the first one published the reply. */
const EDIT_JOB = 1

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

/** A reply that is published and confirmed, then edited: the edit is
 * authorized as cycle 2 and its job is queued. */
async function editPublishedReply(): Promise<void> {
  await harness.commands.draft(FIRST_TEXT)
  await harness.commands.submit()
  await harness.commands.approve()
  await harness.runPublishJob(0, 'accepted')
  await harness.observeGoogle()
  expect(await storedReply()).toMatchObject({ status: 'published', text: FIRST_TEXT })
  harness.advance(60 * MINUTE_MS)
  await harness.commands.editPublished(EDITED_TEXT)
}

/** What the Inbox reads to decide whose reply Google shows: the head
 * observation, and the reply it was matched to. */
async function googleReplyOnRecord() {
  const head = await pool.query<{
    text: string | null
    provenance: string
    matched_reply_id: string | null
  }>(
    `SELECT observation.normalized_text AS text, head.provenance,
            observation.matched_reply_id
       FROM google_reply_observation_heads AS head
       JOIN google_reply_observations AS observation
         ON observation.id = head.observation_id
      WHERE head.review_id = $1`,
    [WORKFLOW_REVIEW],
  )
  return head.rows[0]
}

async function observationsOnRecord(): Promise<number> {
  const observations = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM google_reply_observations WHERE review_id = $1`,
    [WORKFLOW_REVIEW],
  )
  return observations.rows[0]?.n ?? 0
}

async function cancellationCauses(): Promise<ReadonlyArray<string>> {
  const facts = await pool.query<{ cause: string }>(
    `SELECT payload->>'cause' AS cause FROM outbox_events
      WHERE organization_id = $1
        AND event_type = 'review.reply.publication_cancelled'`,
    [WORKFLOW_ORG],
  )
  return facts.rows.map((row) => row.cause)
}

/**
 * The edit is still on its way and nothing was decided about it: the reply is
 * the manager's confirmed edit, its attempt is open, nobody was told it was
 * cancelled, and the reply on record for Google is still RepKey's own earlier
 * one (so the Inbox goes on showing the manager their reply, not a read-only
 * copy of "someone else's").
 */
async function expectEditStillInFlight(
  publicationState: 'sending' | 'pending_observation',
): Promise<void> {
  const reply = await storedReply()
  expect(reply).toMatchObject({
    status: 'approved',
    publicationState,
    publicationCycle: 2,
    text: EDITED_TEXT,
  })
  expect(reply.reconcileDueAt).not.toBeNull()
  expect((await harness.evidence()).attempts).toMatchObject([
    { publicationCycle: 1, outcome: 'confirmed' },
    {
      publicationCycle: 2,
      outcome: publicationState === 'sending' ? 'sending' : 'provider_outcome_pending',
    },
  ])
  expect(await cancellationCauses()).toEqual([])
  expect(await googleReplyOnRecord()).toEqual({
    text: FIRST_TEXT,
    provenance: 'repkey_confirmed',
    matched_reply_id: reply.id,
  })
  // The read restated what was on record, so it added nothing to it: the one
  // observation is the first reply's confirmation, with its one fact.
  expect(await observationsOnRecord()).toBe(1)
  expect((await harness.evidence()).facts['review.reply.observed']).toBe(1)
}

/** RepKey records what Google shows: the edit, published, and its own. */
async function expectEditPublished(): Promise<void> {
  const reply = await storedReply()
  expect(harness.google.live?.text).toBe(EDITED_TEXT)
  expect(reply).toMatchObject({
    status: 'published',
    publicationState: 'published',
    publicationCycle: 2,
    text: EDITED_TEXT,
    reconcileDueAt: null,
  })
  expect((await harness.evidence()).attempts).toMatchObject([
    { publicationCycle: 1, outcome: 'confirmed' },
    { publicationCycle: 2, outcome: 'confirmed' },
  ])
  expect(await cancellationCauses()).toEqual([])
  expect(await googleReplyOnRecord()).toEqual({
    text: EDITED_TEXT,
    provenance: 'repkey_confirmed',
    matched_reply_id: reply.id,
  })
  // One request for the first reply, one for the edit: nothing was sent twice.
  expect(harness.google.sent.map((sent) => sent.text)).toEqual([FIRST_TEXT, EDITED_TEXT])
}

describe.sequential('a read of Google while an edit is in flight (PostgreSQL)', () => {
  describe('a read made after Google accepted the edit, that still shows the earlier reply', () => {
    it('keeps the edit waiting at the sweep, and publishes it once Google shows it', async () => {
      await editPublishedReply()
      const reads = harness.holdGoogleReads()
      await harness.runPublishJob(EDIT_JOB, 'accepted')

      harness.advance(2 * MINUTE_MS)
      await harness.runSweep()

      await expectEditStillInFlight('pending_observation')

      reads.release()
      harness.advance(5 * MINUTE_MS)
      await harness.runSweep()

      await expectEditPublished()
    })

    it('answers Check Google again with "not showing yet" and leaves the edit in flight', async () => {
      await editPublishedReply()
      const reads = harness.holdGoogleReads()
      await harness.runPublishJob(EDIT_JOB, 'accepted')

      const checked = await harness.commands.checkGoogle()

      expect(checked.outcome).toBe('not_on_google')
      expect(checked.nextAutomaticCheckAt).not.toBeNull()
      await expectEditStillInFlight('pending_observation')

      reads.release()
      await expect(harness.commands.checkGoogle()).resolves.toMatchObject({
        outcome: 'live_on_google',
      })
      await expectEditPublished()
    })

    it('keeps an edit whose answer never came back uncertain at the worker’s read-back', async () => {
      await editPublishedReply()
      const reads = harness.holdGoogleReads()
      // The request left and Google took it; no answer reached the worker.
      await harness.runPublishJob(EDIT_JOB, 'timeout_landed')
      expect(await storedReply()).toMatchObject({ publicationState: 'sending' })

      // The job's next execution reads back only.
      await harness.runPublishJob(EDIT_JOB, 'accepted')

      expect(harness.google.calls).toBe(2)
      await expectEditStillInFlight('sending')

      reads.release()
      harness.advance(2 * MINUTE_MS)
      await harness.runSweep()

      await expectEditPublished()
    })

    it('calls an edit that does not show within the grace unconfirmed, never cancelled, and still publishes it when it shows', async () => {
      await editPublishedReply()
      const reads = harness.holdGoogleReads()
      await harness.runPublishJob(EDIT_JOB, 'accepted')

      harness.advance(PAST_THE_GRACE_MINUTES * MINUTE_MS)
      await harness.runSweep()

      const unconfirmed = await storedReply()
      expect(unconfirmed).toMatchObject({
        status: 'publish_failed',
        publicationState: 'ambiguous',
        text: EDITED_TEXT,
      })
      expect(unconfirmed.reconcileDueAt).not.toBeNull()
      expect(await cancellationCauses()).toEqual([])
      expect((await harness.evidence()).facts['review.reply.publish_failed']).toBe(1)

      reads.release()
      harness.advance(30 * MINUTE_MS)
      await harness.runSweep()

      await expectEditPublished()
    })
  })

  describe('a read taken before the edit reached Google, recorded after the claim', () => {
    it('does not cancel the edit Google has accepted since', async () => {
      await editPublishedReply()
      const page = await harness.fetchGoogleSnapshot()
      await harness.runPublishJob(EDIT_JOB, 'accepted')

      await page.apply()

      await expectEditStillInFlight('pending_observation')

      await harness.observeGoogle()
      await expectEditPublished()
    })

    it('does not cancel the edit while its request is on the wire, and the worker’s acknowledgement still lands', async () => {
      await editPublishedReply()
      const page = await harness.fetchGoogleSnapshot()
      const write = harness.holdNextWrite()
      const job = harness.runPublishJob(EDIT_JOB, 'accepted')
      await write.reached

      await page.apply()

      await expectEditStillInFlight('sending')

      write.release()
      await job
      await expectEditStillInFlight('pending_observation')

      await harness.observeGoogle()
      await expectEditPublished()
    })
  })

  describe('a reply the observation head no longer attributes to RepKey', () => {
    it('is still known as RepKey’s own by its confirmed attempt: an edit after a guest edit is not cancelled by it', async () => {
      await harness.commands.draft(FIRST_TEXT)
      await harness.commands.submit()
      await harness.commands.approve()
      await harness.runPublishJob(0, 'accepted')
      await harness.observeGoogle()
      // The guest rewrites the review. The reply that answered the earlier
      // one is carried over: recorded again for the new revision, as a reply
      // Google shows, no longer as the one RepKey confirmed.
      await harness.observeGuestEdit({ rating: 3, text: 'On second thought, average.' })
      await harness.observeGoogle()
      expect(await googleReplyOnRecord()).toEqual({
        text: FIRST_TEXT,
        provenance: 'external_or_unknown',
        matched_reply_id: null,
      })

      await harness.commands.editPublished(EDITED_TEXT)
      const reads = harness.holdGoogleReads()
      await harness.runPublishJob(EDIT_JOB, 'accepted')
      harness.advance(2 * MINUTE_MS)
      await harness.runSweep()

      expect(await storedReply()).toMatchObject({
        status: 'approved',
        publicationState: 'pending_observation',
        text: EDITED_TEXT,
      })
      expect(await cancellationCauses()).toEqual([])

      reads.release()
      harness.advance(5 * MINUTE_MS)
      await harness.runSweep()

      const published = await storedReply()
      expect(published).toMatchObject({ status: 'published', text: EDITED_TEXT })
      expect(await googleReplyOnRecord()).toEqual({
        text: EDITED_TEXT,
        provenance: 'repkey_confirmed',
        matched_reply_id: published.id,
      })
    })
  })

  describe('what still ends an edit in flight', () => {
    it('is stopped by a reply that is neither the edit nor the earlier one', async () => {
      await editPublishedReply()
      await harness.runPublishJob(EDIT_JOB, 'accepted')
      // Somebody replaces the reply on Google itself.
      harness.google.live = { text: OTHER_TEXT, updatedAt: harness.clock() }

      await harness.observeGoogle()

      expect(await storedReply()).toMatchObject({
        status: 'draft',
        publicationState: 'cancelled',
        text: EDITED_TEXT,
        reconcileDueAt: null,
      })
      expect((await harness.evidence()).attempts).toMatchObject([
        { publicationCycle: 1, outcome: 'confirmed' },
        { publicationCycle: 2, outcome: 'superseded' },
      ])
      expect(await cancellationCauses()).toEqual(['provider_truth'])
      expect(await googleReplyOnRecord()).toEqual({
        text: OTHER_TEXT,
        provenance: 'external_or_unknown',
        matched_reply_id: null,
      })
    })

    it('ends as unconfirmed when the edit never reached Google: nothing is sent twice, and the earlier reply stays RepKey’s own', async () => {
      await editPublishedReply()
      // The request left and no answer came back; Google never took it.
      await harness.runPublishJob(EDIT_JOB, 'timeout_lost')
      await harness.runPublishJob(EDIT_JOB, 'accepted')
      await expectEditStillInFlight('sending')

      // Past the grace the send is ambiguous; past the ladder the checks end.
      harness.advance(LADDER_END_MINUTES * MINUTE_MS)
      await harness.runSweep()
      harness.advance(30 * MINUTE_MS)
      await harness.runSweep()

      const reply = await storedReply()
      expect(reply).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'ambiguous',
        text: EDITED_TEXT,
        reconcileDueAt: null,
      })
      expect(await cancellationCauses()).toEqual([])
      expect(harness.google.live?.text).toBe(FIRST_TEXT)
      expect(harness.google.sent.map((sent) => sent.landed)).toEqual([true, false])
      expect(await googleReplyOnRecord()).toEqual({
        text: FIRST_TEXT,
        provenance: 'repkey_confirmed',
        matched_reply_id: reply.id,
      })
      await expect(harness.commands.retry()).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_transition',
      })
    })
  })
})
