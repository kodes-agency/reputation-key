import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { withExecutionDeadline } from './execution-deadline.server'
import { createDatabase } from './index'

type Session = { pid: number; timeout_ms: number }

const SESSION = sql`select pg_backend_pid() as pid,
  (extract(epoch from current_setting('statement_timeout')::interval) * 1000)::int
    as timeout_ms`

describe('execution deadlines through PostgreSQL transactions', () => {
  let lease: TestLease | undefined
  let db: ReturnType<typeof createDatabase>
  let priorSession: Session

  beforeEach(async () => {
    // One physical connection makes every checkout reuse the guarded session.
    lease = await acquireTestLease(getEnv().DATABASE_URL, 1)
    db = createDatabase(lease.pool)
    await lease.pool.query("set statement_timeout = '8s'")
    await lease.pool.query('create temporary table deadline_writes (id int primary key)')
    const session = await db.execute<Session>(SESSION)
    priorSession = session.rows[0]!
    expect(priorSession.timeout_ms).toBe(8000)
  })

  afterEach(async () => {
    await lease?.release()
    lease = undefined
  })

  async function expectReusedSession(ids: readonly number[]) {
    const session = await db.execute<Session>(SESSION)
    expect(session.rows).toEqual([priorSession])
    const writes = await db.execute<{ id: number }>(
      sql`select id from deadline_writes order by id`,
    )
    expect(writes.rows).toEqual(ids.map((id) => ({ id })))
  }

  it('cancels a slow statement, rolls back earlier writes and restores the pooled timeout', async () => {
    const controller = new AbortController()

    await expect(
      withExecutionDeadline(
        { signal: controller.signal, expiresAt: Date.now() + 1000 },
        () =>
          db.transaction(async (tx) => {
            await tx.execute(sql`insert into deadline_writes values (1)`)
            await tx.execute(sql`select pg_sleep(3)`)
          }),
      ),
    ).rejects.toMatchObject({
      cause: { code: '57014', message: 'canceling statement due to statement timeout' },
    })

    await expectReusedSession([])
  })

  it('rolls back writes when the signal aborts even if the callback returns normally', async () => {
    const controller = new AbortController()
    const failure = new Error('execution deadline exceeded')
    let callbackReturned = false

    await expect(
      withExecutionDeadline(
        { signal: controller.signal, expiresAt: Date.now() + 1000 },
        () =>
          db.transaction(async (tx) => {
            await tx.execute(sql`insert into deadline_writes values (1)`)
            controller.abort(failure)
            callbackReturned = true
            return 'must not commit'
          }),
      ),
    ).rejects.toBe(failure)

    expect(callbackReturned).toBe(true)
    await expectReusedSession([])
  })

  it('commits successful writes and restores the prior timeout on the same pooled session', async () => {
    const controller = new AbortController()

    const result = await withExecutionDeadline(
      { signal: controller.signal, expiresAt: Date.now() + 1000 },
      () =>
        db.transaction(async (tx) => {
          const session = await tx.execute<Session>(SESSION)
          expect(session.rows[0]!.pid).toBe(priorSession.pid)
          expect(session.rows[0]!.timeout_ms).toBeGreaterThan(0)
          expect(session.rows[0]!.timeout_ms).toBeLessThanOrEqual(1000)
          await tx.execute(sql`insert into deadline_writes values (1)`)
          return 'committed'
        }),
    )

    expect(result).toBe('committed')
    await expectReusedSession([1])
  })

  it('restores the prior pooled timeout after the callback throws', async () => {
    const controller = new AbortController()
    const failure = new Error('transaction callback failed')

    await expect(
      withExecutionDeadline(
        { signal: controller.signal, expiresAt: Date.now() + 1000 },
        () =>
          db.transaction(async (tx) => {
            await tx.execute(sql`insert into deadline_writes values (1)`)
            throw failure
          }),
      ),
    ).rejects.toBe(failure)

    await expectReusedSession([])
  })
})
