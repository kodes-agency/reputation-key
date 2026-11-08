import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  purgeAiDraftsForAuthorization,
  purgeAiDraftsForReview,
} from '#/shared/db/ai/ai-draft-purge'
import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import {
  createReplyWorkflowHarness,
  WORKFLOW_HOOK_TIMEOUT_MS,
  WORKFLOW_ORG,
  WORKFLOW_PROPERTY,
  WORKFLOW_REVIEW,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const TEXT = 'Thank you for sharing your experience.'
const DEADLOCK = '40P01'
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

/** A human-written reply approved for Google and not yet dispatched. */
async function authorizedReply() {
  await harness.commands.draft(TEXT)
  await harness.commands.submit()
  await harness.commands.approve()
  const reply = await harness.currentReply()
  expect(reply?.publicationState).toBe('authorized')
  if (!reply) throw new Error('The approved reply is missing')
  return reply
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
  throw new Error('The effect did not wait for the locked Review')
}

/**
 * Holds the Review, starts `effect` in its own transaction, and proves it waits
 * there without holding the Reply row: a Reply-first effect would invert the
 * order every manager command takes and recreate the deadlock.
 */
async function runBehindReviewLock(
  replyId: string,
  effect: (
    tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  ) => Promise<unknown>,
): Promise<void> {
  const blocker = await pool.connect()
  const probe = await pool.connect()
  let running: Promise<unknown> | undefined
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
    running = getDb().transaction(effect)
    void running.catch(() => undefined)
    await untilBlockedBy(pid)

    await probe.query('BEGIN')
    const locked = await probe.query<{ id: string }>(
      'SELECT id FROM replies WHERE id = $1 FOR UPDATE NOWAIT',
      [replyId],
    )
    expect(locked.rows.map((row) => row.id)).toEqual([replyId])
    await probe.query('ROLLBACK')
    await blocker.query('COMMIT')
    await running
  } finally {
    await blocker.query('ROLLBACK')
    await probe.query('ROLLBACK')
    await Promise.allSettled([running])
    blocker.release()
    probe.release()
  }
}

const isDeadlock = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: unknown }).code === DEADLOCK ||
    (error as { cause?: { code?: unknown } }).cause?.code === DEADLOCK)

describe.sequential('Reply effects lock the Review before the Reply', () => {
  it('fences in-flight publications after a restore behind the Review', async () => {
    const reply = await authorizedReply()

    await runBehindReviewLock(reply.id, (tx) =>
      replyScopeEffects.fenceReplyPublicationsAfterRestore(tx),
    )

    expect((await harness.currentReply())?.publicationState).toBe('cancelled')
  }, 30_000)

  it('cancels publications of a closing Organization behind the Review', async () => {
    const reply = await authorizedReply()

    await runBehindReviewLock(reply.id, (tx) =>
      replyScopeEffects.cancelRepliesForOrganizationClosing(tx, {
        organizationId: WORKFLOW_ORG,
        occurredAt: new Date(),
      }),
    )

    expect(await harness.currentReply()).toMatchObject({
      publicationState: 'cancelled',
      status: 'draft',
    })
  }, 30_000)

  it('scrubs the Reply content of a purged Organization behind the Review', async () => {
    const reply = await authorizedReply()

    await runBehindReviewLock(reply.id, (tx) =>
      replyScopeEffects.scrubOrganizationReplyContent(tx, {
        organizationId: WORKFLOW_ORG,
        occurredAt: new Date(),
      }),
    )

    expect((await harness.currentReply())?.text).toBe('')
  }, 30_000)

  it('cancels an undispatched batch behind the Review', async () => {
    const reply = await authorizedReply()
    let cancelled: Promise<number> | undefined
    const blocker = await pool.connect()
    const probe = await pool.connect()
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
      cancelled = harness.cancelUndispatched()
      void cancelled.catch(() => undefined)
      await untilBlockedBy(pid)

      await probe.query('BEGIN')
      const locked = await probe.query<{ id: string }>(
        'SELECT id FROM replies WHERE id = $1 FOR UPDATE NOWAIT',
        [reply.id],
      )
      expect(locked.rows).toHaveLength(1)
      await probe.query('ROLLBACK')
      await blocker.query('COMMIT')
      expect(await cancelled).toBe(1)
    } finally {
      await blocker.query('ROLLBACK')
      await probe.query('ROLLBACK')
      await Promise.allSettled([cancelled])
      blocker.release()
      probe.release()
    }
    expect((await harness.currentReply())?.publicationState).toBe('cancelled')
  }, 30_000)

  it('lets every writer finish when a restore fence meets a manager command', async () => {
    for (let round = 0; round < 5; round++) {
      await harness.reset()
      await authorizedReply()
      const results = await Promise.allSettled([
        getDb().transaction((tx) =>
          replyScopeEffects.fenceReplyPublicationsAfterRestore(tx),
        ),
        getDb().transaction((tx) =>
          replyScopeEffects.cancelRepliesForOrganizationClosing(tx, {
            organizationId: WORKFLOW_ORG,
            occurredAt: new Date(),
          }),
        ),
        harness.cancelUndispatched(),
      ])
      const deadlocked = results.filter(
        (result) => result.status === 'rejected' && isDeadlock(result.reason),
      )
      expect(deadlocked).toEqual([])
      expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    }
  }, 60_000)

  it('withdraws AI drafts without deadlocking a submit that measures the draft', async () => {
    for (const purge of [
      () =>
        getDb().transaction((tx) =>
          purgeAiDraftsForReview(
            tx,
            {
              organizationId: WORKFLOW_ORG,
              reviewId: WORKFLOW_REVIEW,
            },
            replyScopeEffects,
          ),
        ),
      () =>
        getDb().transaction((tx) =>
          purgeAiDraftsForAuthorization(
            tx,
            {
              organizationId: WORKFLOW_ORG,
              propertyId: WORKFLOW_PROPERTY,
            },
            replyScopeEffects,
          ),
        ),
    ]) {
      for (let round = 0; round < 3; round++) {
        await harness.reset()
        await harness.commands.adoptAiSuggestion(TEXT)
        const results = await Promise.allSettled([purge(), harness.commands.submit()])
        expect(
          results.filter(
            (result) => result.status === 'rejected' && isDeadlock(result.reason),
          ),
        ).toEqual([])
      }
    }
  }, 60_000)
})
