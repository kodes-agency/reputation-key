import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  purgeAiDraftsForAuthorization,
  purgeAiDraftsForReview,
} from '#/shared/db/ai/ai-draft-purge'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import type { Reply } from '../domain/types'
import {
  createReplyWorkflowHarness,
  WORKFLOW_HOOK_TIMEOUT_MS,
  WORKFLOW_ORG,
  WORKFLOW_PROPERTY,
  WORKFLOW_REVIEW,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const ORIGINAL = 'Thank you for sharing your experience.'
const FIRST_EDIT = 'Thank you for visiting. We hope to see you again.'
const SECOND_EDIT = 'We appreciate your review and hope to welcome you again.'
let lease: TestLease
let pool: Pool
let harness: ReplyWorkflowHarness

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  pool = lease.pool
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
  await lease.release()
}, WORKFLOW_HOOK_TIMEOUT_MS)

beforeEach(async () => {
  await harness.reset()
})

async function storedReply(): Promise<Reply> {
  const reply = await harness.currentReply()
  if (!reply) throw new Error('The draft is missing')
  return reply
}

async function currentMeasurement(reply: Reply): Promise<string | null> {
  const { rows } = await pool.query<{ generation_id: string | null }>(
    `SELECT generation_id FROM ai_draft_measurement_links
      WHERE reply_id = $1 AND reply_revision <= $2
      ORDER BY reply_revision DESC LIMIT 1`,
    [reply.id, reply.stateRevision],
  )
  return rows[0]?.generation_id ?? null
}

async function adoptedDraft() {
  await harness.commands.adoptAiSuggestion(ORIGINAL)
  const reply = await storedReply()
  const measurement = await currentMeasurement(reply)
  expect(measurement).not.toBeNull()
  return { reply, measurement }
}

async function untilBlockedBy(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE datname = current_database()
           AND $1 = ANY(pg_blocking_pids(pid))
       ) AS waiting`,
      [pid],
    )
    if (rows[0]?.waiting) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('The draft save did not wait for the locked Review')
}

describe.sequential('draft revision races on PostgreSQL', () => {
  it('lets exactly one of two saves from the same snapshot win and carries its measurement', async () => {
    const { reply, measurement } = await adoptedDraft()

    const results = await Promise.all([
      harness.replyRepo.saveDraft(reply, { text: FIRST_EDIT, fenceStateRevision: true }),
      harness.replyRepo.saveDraft(reply, { text: SECOND_EDIT, fenceStateRevision: true }),
    ])

    const winners = results.filter((result): result is Reply => result !== null)
    expect(winners).toHaveLength(1)
    expect(results.filter((result) => result === null)).toHaveLength(1)
    const current = await storedReply()
    expect(current.text).toBe(winners[0]?.text)
    expect(current.stateRevision).toBe(reply.stateRevision + 1)
    expect(current.aiGenerated).toBe(false)
    expect(await currentMeasurement(current)).toBe(measurement)
    expect(harness.google.sent).toEqual([])
  })

  it('refuses a stale save without clearing the winning edit or its measurement', async () => {
    const { reply, measurement } = await adoptedDraft()
    const saved = await harness.replyRepo.saveDraft(reply, {
      text: FIRST_EDIT,
      fenceStateRevision: true,
    })
    expect(saved).not.toBeNull()

    expect(
      await harness.replyRepo.saveDraft(reply, {
        text: SECOND_EDIT,
        fenceStateRevision: true,
        measurementGenerationId: null,
      }),
    ).toBeNull()

    const current = await storedReply()
    expect(current.text).toBe(FIRST_EDIT)
    expect(current.stateRevision).toBe(saved?.stateRevision)
    expect(await currentMeasurement(current)).toBe(measurement)
  })

  it('does not delete a draft that another manager edited after the delete snapshot', async () => {
    const { reply, measurement } = await adoptedDraft()
    await harness.replyRepo.saveDraft(reply, {
      text: FIRST_EDIT,
      fenceStateRevision: true,
    })

    expect(await harness.replyRepo.deleteDraft(reply)).toBe(false)

    const current = await storedReply()
    expect(current.text).toBe(FIRST_EDIT)
    expect(await currentMeasurement(current)).toBe(measurement)
  })

  it('waits for the Review before holding the Reply and completes alongside a Google observation', async () => {
    const { reply, measurement } = await adoptedDraft()
    const blocker = await pool.connect()
    const probe = await pool.connect()
    let save: Promise<Reply | null> | undefined
    let observe: Promise<void> | undefined
    try {
      await blocker.query('BEGIN')
      const { rows } = await blocker.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      )
      const pid = rows[0]?.pid
      if (pid === undefined) throw new Error('The blocker has no backend identity')
      await blocker.query(
        'SELECT id FROM reviews WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [WORKFLOW_REVIEW, WORKFLOW_ORG],
      )

      save = harness.replyRepo.saveDraft(reply, { text: FIRST_EDIT })
      void save.catch(() => undefined)
      await untilBlockedBy(pid)

      // NOWAIT observes the actual held row locks. A Reply-first save would
      // already hold this row while its revision trigger waited for the Review.
      await probe.query('BEGIN')
      const locked = await probe.query<{ id: string }>(
        'SELECT id FROM replies WHERE id = $1 FOR UPDATE NOWAIT',
        [reply.id],
      )
      expect(locked.rows.map((row) => row.id)).toEqual([reply.id])
      await probe.query('ROLLBACK')

      observe = harness.observeGoogle()
      void observe.catch(() => undefined)
      await blocker.query('COMMIT')
      const [saved] = await Promise.all([save, observe])
      expect(saved?.text).toBe(FIRST_EDIT)
      const current = await storedReply()
      expect(current.text).toBe(FIRST_EDIT)
      expect(await currentMeasurement(current)).toBe(measurement)
      expect(harness.google.sent).toEqual([])
    } finally {
      await blocker.query('ROLLBACK')
      await probe.query('ROLLBACK')
      await Promise.allSettled([save, observe])
      blocker.release()
      probe.release()
    }
  }, 30_000)

  it('withdraws AI drafts behind the Review fence without deadlocking a manager save', async () => {
    const { reply, measurement } = await adoptedDraft()
    const blocker = await pool.connect()
    const probe = await pool.connect()
    let purge: Promise<void> | undefined
    let save: Promise<Reply | null> | undefined
    try {
      await blocker.query('BEGIN')
      const { rows } = await blocker.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      )
      const pid = rows[0]?.pid
      if (pid === undefined) throw new Error('The blocker has no backend identity')
      await blocker.query(
        'SELECT id FROM reviews WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [WORKFLOW_REVIEW, WORKFLOW_ORG],
      )

      purge = getDb().transaction((tx) =>
        purgeAiDraftsForReview(
          tx,
          {
            organizationId: WORKFLOW_ORG,
            reviewId: WORKFLOW_REVIEW,
          },
          replyScopeEffects,
        ),
      )
      void purge.catch(() => undefined)
      await untilBlockedBy(pid)

      // A withdrawal must not hold the Reply and wait for its Review. That
      // would invert the manager writer's order and recreate the deadlock.
      await probe.query('BEGIN')
      const locked = await probe.query<{ id: string }>(
        'SELECT id FROM replies WHERE id = $1 FOR UPDATE NOWAIT',
        [reply.id],
      )
      expect(locked.rows.map((row) => row.id)).toEqual([reply.id])
      await probe.query('ROLLBACK')

      save = harness.replyRepo.saveDraft(reply, { text: FIRST_EDIT })
      void save.catch(() => undefined)
      await blocker.query('COMMIT')
      const [, saved] = await Promise.all([purge, save])
      const current = await harness.currentReply()
      if (saved === null) {
        expect(current).toBeNull()
      } else {
        expect(current).toMatchObject({ text: FIRST_EDIT, aiGenerated: false })
        expect(await currentMeasurement(saved)).toBe(measurement)
      }
      const retained = await pool.query<{ id: string }>(
        'SELECT id FROM ai_draft_measurements WHERE id = $1',
        [measurement],
      )
      expect(retained.rows.map((row) => row.id)).toEqual([measurement])
      expect(harness.google.sent).toEqual([])
    } finally {
      await blocker.query('ROLLBACK')
      await probe.query('ROLLBACK')
      await Promise.allSettled([purge, save])
      blocker.release()
      probe.release()
    }
  }, 30_000)

  it('takes the Review fence before erasing consent-bound measurements', async () => {
    const { measurement } = await adoptedDraft()
    const blocker = await pool.connect()
    const probe = await pool.connect()
    let purge: Promise<void> | undefined
    try {
      await blocker.query('BEGIN')
      const { rows } = await blocker.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      )
      const pid = rows[0]?.pid
      if (pid === undefined) throw new Error('The blocker has no backend identity')
      await blocker.query(
        'SELECT id FROM reviews WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [WORKFLOW_REVIEW, WORKFLOW_ORG],
      )
      purge = getDb().transaction((tx) =>
        purgeAiDraftsForAuthorization(
          tx,
          {
            organizationId: WORKFLOW_ORG,
            propertyId: WORKFLOW_PROPERTY,
          },
          replyScopeEffects,
        ),
      )
      void purge.catch(() => undefined)
      await untilBlockedBy(pid)

      // Submit takes Review/Reply before updating this measurement. A purge
      // holding the measurement while waiting for Review would invert that order.
      await probe.query('BEGIN')
      const locked = await probe.query<{ id: string }>(
        'SELECT id FROM ai_draft_measurements WHERE id = $1 FOR UPDATE NOWAIT',
        [measurement],
      )
      expect(locked.rows.map((row) => row.id)).toEqual([measurement])
      await probe.query('ROLLBACK')
      await blocker.query('COMMIT')
      await purge
      expect(await harness.currentReply()).toBeNull()
      const erased = await pool.query(
        'SELECT id FROM ai_draft_measurements WHERE id = $1',
        [measurement],
      )
      expect(erased.rows).toEqual([])
    } finally {
      await blocker.query('ROLLBACK')
      await probe.query('ROLLBACK')
      await Promise.allSettled([purge])
      blocker.release()
      probe.release()
    }
  }, 30_000)
})
