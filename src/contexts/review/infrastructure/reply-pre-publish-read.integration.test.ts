// The read of Google before a publish claim, on PostgreSQL.
//
// `reviews.reply` is an upsert: it creates the owner reply or replaces the one
// there. About 97% of replies on the beta are written on Google itself, and
// RepKey notices at the next sync. The publish worker therefore reads the review
// from Google before it claims, records what it saw through the writer sync
// uses, and lets the observation head do the rest. These tests run the real
// use cases, command store, observation store, sync writer and publish worker
// (testing/reply-workflow-harness.ts, with a stand-in Google that remembers what
// it was sent) through the sequences where Google already holds an answer.
//
// The stand-in Google is also the witness: a write that left while Google held
// a reply RepKey had not recorded is a violation (`google.violations`).

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

const APPROVED_TEXT = 'Thank you for staying with us.'
const EDITED_TEXT = 'Thank you for staying with us, and see you again soon.'
const TYPED_ON_GOOGLE = 'Thanks for your review! - The Front Desk'
const MINUTE_MS = 60_000

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

async function observationsOnRecord(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM google_reply_observations WHERE review_id = $1`,
    [WORKFLOW_REVIEW],
  )
  return rows[0]?.n ?? 0
}

/** What the Inbox reads to decide whose reply Google shows. */
async function googleReplyOnRecord() {
  const { rows } = await pool.query<{ text: string | null; provenance: string }>(
    `SELECT observation.normalized_text AS text, head.provenance
       FROM google_reply_observation_heads AS head
       JOIN google_reply_observations AS observation
         ON observation.id = head.observation_id
      WHERE head.review_id = $1`,
    [WORKFLOW_REVIEW],
  )
  return rows[0]
}

describe.sequential('the worker reads Google before it claims (PostgreSQL)', () => {
  it('writes when Google still shows no reply, and the read leaves the record as it was', async () => {
    await confirmReply()
    const observationsBefore = await observationsOnRecord()

    await harness.runPublishJob(0, 'accepted')

    expect(harness.google.sent).toMatchObject([{ text: APPROVED_TEXT, landed: true }])
    expect(await storedReply()).toMatchObject({
      status: 'approved',
      publicationState: 'pending_observation',
      publicationAttempts: 1,
    })
    // A read that restates the head appends nothing to it.
    expect(await observationsOnRecord()).toBe(observationsBefore)
    expect(harness.google.violations).toEqual([])
  })

  describe('a reply typed on Google since the last sync', () => {
    it('ends a cycle that has not sent as provider truth, and writes nothing', async () => {
      await confirmReply()
      harness.writeOnGoogle(TYPED_ON_GOOGLE)

      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.calls).toBe(0)
      expect(harness.google.live?.text).toBe(TYPED_ON_GOOGLE)
      expect(await storedReply()).toMatchObject({
        status: 'draft',
        publicationState: 'cancelled',
        text: APPROVED_TEXT,
        publicationAttempts: 0,
      })
      expect(await cancellationCauses()).toEqual(['provider_truth'])
      // The reply on record is now Google's own, as a sync would have recorded.
      expect(await googleReplyOnRecord()).toEqual({
        text: TYPED_ON_GOOGLE,
        provenance: 'external_or_unknown',
      })
      expect((await harness.evidence()).attempts).toEqual([])
      expect(harness.google.violations).toEqual([])
    })

    it('ends a requeued cycle the same way, where the observation store leaves it alone', async () => {
      await confirmReply()
      // The first execution claims and is refused inside RepKey: the cycle goes
      // back to authorized, tried once, for another execution of the same job.
      await harness.runPublishJob(0, 'not_sent')
      expect(await storedReply()).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationAttempts: 1,
      })
      harness.writeOnGoogle(TYPED_ON_GOOGLE)

      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.sent).toEqual([])
      expect(await storedReply()).toMatchObject({
        status: 'draft',
        publicationState: 'cancelled',
        publicationAttempts: 1,
      })
      expect(await cancellationCauses()).toEqual(['provider_truth'])
      expect((await harness.evidence()).attempts).toMatchObject([
        { publicationCycle: 1, attemptNumber: 1, outcome: 'superseded' },
      ])
      expect(harness.google.violations).toEqual([])
    })

    it('does not stop an edit of RepKey’s own live reply, which Google still shows as it was', async () => {
      await confirmReply()
      await harness.runPublishJob(0, 'accepted')
      await harness.observeGoogle()
      expect(await storedReply()).toMatchObject({ status: 'published' })
      harness.advance(60 * MINUTE_MS)
      await harness.commands.editPublished(EDITED_TEXT)

      await harness.runPublishJob(1, 'accepted')

      expect(harness.google.sent).toMatchObject([
        { publicationCycle: 1, text: APPROVED_TEXT },
        { publicationCycle: 2, text: EDITED_TEXT },
      ])
      expect(harness.google.violations).toEqual([])
    })

    it('stops an edit when someone replaced RepKey’s reply on Google first', async () => {
      await confirmReply()
      await harness.runPublishJob(0, 'accepted')
      await harness.observeGoogle()
      harness.advance(60 * MINUTE_MS)
      await harness.commands.editPublished(EDITED_TEXT)
      harness.writeOnGoogle(TYPED_ON_GOOGLE)

      await harness.runPublishJob(1, 'accepted')

      expect(harness.google.sent).toHaveLength(1)
      expect(await storedReply()).toMatchObject({
        status: 'draft',
        publicationState: 'cancelled',
        text: EDITED_TEXT,
      })
      expect(await cancellationCauses()).toEqual(['provider_truth'])
      expect(harness.google.violations).toEqual([])
    })
  })

  it('never writes over a reply it cannot read, and records nothing for it', async () => {
    await confirmReply()
    harness.writeOnGoogle(TYPED_ON_GOOGLE)
    harness.google.replyUnreadable = true
    const observationsBefore = await observationsOnRecord()

    await harness.runPublishJob(0, 'accepted')

    expect(harness.google.calls).toBe(0)
    expect(await storedReply()).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
    })
    expect(await cancellationCauses()).toEqual(['provider_truth'])
    expect(await observationsOnRecord()).toBe(observationsBefore)
  })

  it('ends the cycle as refused, with nothing sent, when Google no longer has the review', async () => {
    await confirmReply()
    harness.google.reviewGone = true

    await harness.runPublishJob(0, 'accepted')

    expect(harness.google.calls).toBe(0)
    expect(await storedReply()).toMatchObject({
      status: 'publish_failed',
      publicationState: 'terminal',
      publicationLastErrorClass: 'terminal_rejection',
    })
    expect((await harness.evidence()).facts['review.reply.publish_failed']).toBe(1)
  })

  describe('a read that fails', () => {
    it('leaves the cycle authorized and consumes no claim, so the next execution can publish', async () => {
      await confirmReply()
      harness.google.readFailure = 'transient'

      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.calls).toBe(0)
      expect(await storedReply()).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationAttempts: 0,
      })
      expect((await harness.evidence()).attempts).toEqual([])

      harness.google.readFailure = 'none'
      await harness.runPublishJob(0, 'accepted')

      expect(harness.google.sent).toMatchObject([{ text: APPROVED_TEXT, landed: true }])
      expect(harness.google.violations).toEqual([])
    })

    it('ends the cycle as not sent when the last execution cannot read Google either', async () => {
      await confirmReply()
      harness.google.readFailure = 'transient'

      await harness.runPublishJob(0, 'accepted', true)

      expect(harness.google.calls).toBe(0)
      expect(await storedReply()).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
      })
    })
  })
})
