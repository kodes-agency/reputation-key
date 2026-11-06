import { randomUUID } from 'node:crypto'
import type { Job } from 'bullmq'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createWorkItems, type WorkItems, type WorkRequest } from './work-items.server'
import { workItems } from './schema/work-items.schema'
import { reconcileWorkItems } from '#/shared/jobs/work-items.server'
import { createGatedJobHandler } from '#/shared/jobs/delayed-execution-gate'
import { createJobRegistry } from '#/shared/jobs/registry'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'

describe('durable work through PostgreSQL', () => {
  let lease: TestLease
  let store: WorkItems
  let now: Date
  let org: string
  let otherOrg: string
  let receipt: string
  const db = () => drizzle(lease.pool)
  const request = (overrides: Partial<WorkRequest> = {}): WorkRequest => ({
    organizationId: org,
    kind: 'test-work',
    subjectId: randomUUID(),
    idempotencyKey: randomUUID(),
    dueAt: now,
    recovery: 'retry',
    ...overrides,
  })
  const claimed = async (overrides: Partial<WorkRequest> = {}) => {
    const row = await store.schedule(request(overrides))
    const claim = await store.claim(org, row.id, 1_000)
    if (!claim?.leaseToken) throw new Error('Expected fixture lease')
    return { ...claim, leaseToken: claim.leaseToken }
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })
  beforeEach(() => {
    now = new Date('2026-11-06T10:00:00Z')
    org = randomUUID()
    otherOrg = randomUUID()
    receipt = randomUUID()
    store = createWorkItems(db(), () => now)
  })
  afterEach(async () => {
    resetDelayedExecutionPolicy()
    resetCapabilityPolicyStore()
    await db()
      .delete(workItems)
      .where(inArray(workItems.organizationId, [org, otherOrg]))
    await db().execute(sql`DELETE FROM idempotency_receipts WHERE scope = ${receipt}`)
  })
  afterAll(async () => {
    await lease?.release()
  })

  it('commits intent with the source transaction, and binds one key to one subject', async () => {
    const input = request()
    await expect(
      db().transaction(async (tx) => {
        await store.schedule(input, tx)
        throw new Error('source rolled back')
      }),
    ).rejects.toThrow('source rolled back')
    expect(await store.list(org)).toEqual([])
    const rows = await Promise.all([store.schedule(input), store.schedule(input)])
    expect(rows[0]?.id).toBe(rows[1]?.id)
    await expect(store.schedule({ ...input, subjectId: 'different' })).rejects.toThrow(
      'binding mismatch',
    )
    expect((await store.schedule({ ...input, organizationId: otherOrg })).id).not.toBe(
      rows[0]?.id,
    )
  })

  it('recovers a lost Redis job within a minute without charging a transport failure', async () => {
    const row = await store.schedule(request())
    const enqueue = vi.fn().mockRejectedValue(new Error('Redis lost'))
    await reconcileWorkItems({ reserveDispatch: store.reserveDispatch, enqueue })
    expect((await store.inspect(org, row.id))?.attempts).toBe(0)
    now = new Date(now.getTime() + 60_000)
    enqueue.mockResolvedValue(undefined)
    await reconcileWorkItems({ reserveDispatch: store.reserveDispatch, enqueue })
    expect(enqueue.mock.calls.map((call) => call[1])).toEqual([
      { workId: row.id },
      { workId: row.id },
    ])
    expect(enqueue.mock.calls.map((call) => call[2])).toEqual([
      `${row.id}-1`,
      `${row.id}-2`,
    ])
    expect((await store.inspect(org, row.id))?.attempts).toBe(0)
  })

  it.each(['insert-notification', 'sync-property-reviews'])(
    'completes %s from IDs-only reconciliation through the real policy gate',
    async (kind) => {
      initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
      initDelayedExecutionPolicy(
        createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
      )
      const row = await store.schedule(request({ kind }))
      const registry = createJobRegistry()
      registry.register(kind, async (job) => {
        expect(job.data).toEqual({ workId: row.id })
        const { workId } = job.data as { workId: string }
        const scope = await store.resolveDispatch(workId)
        if (!scope) throw new Error('Expected durable scope')
        const claim = await store.claim(scope.organizationId, workId, 1_000)
        if (!claim?.leaseToken) throw new Error('Expected dispatch lease')
        return store.complete(
          scope.organizationId,
          claim.id,
          claim.leaseToken,
          async (tx) => {
            await tx.execute(
              sql`INSERT INTO idempotency_receipts (scope, key) VALUES (${receipt}, 'gated-completion')`,
            )
          },
        )
      })
      const dispatch = createGatedJobHandler(
        'default',
        registry,
        async (_kind, data) => {
          const scope = data as { organizationId: string; subjectId: string }
          return scope.organizationId === org ? scope.subjectId : undefined
        },
        undefined,
        store.resolveDispatch,
      )
      const result = await reconcileWorkItems({
        reserveDispatch: store.reserveDispatch,
        enqueue: async (name, data, jobId) => {
          expect(await dispatch({ name, data, id: jobId, opts: {} } as Job)).toBe(true)
        },
      })
      expect(result).toEqual({ queued: 1, failed: 0 })
      expect(await store.inspect(org, row.id)).toMatchObject({
        state: 'succeeded',
        attempts: 1,
      })
      const effects = await db().execute(
        sql`SELECT 1 FROM idempotency_receipts WHERE scope = ${receipt} AND key = 'gated-completion'`,
      )
      expect(effects.rowCount).toBe(1)
      now = new Date(now.getTime() + 60_000)
      expect(await store.reserveDispatch()).toEqual([])
    },
  )

  it('refuses early and cross-tenant claims and gives duplicate deliveries one lease', async () => {
    const row = await store.schedule(request({ dueAt: new Date(now.getTime() + 1_000) }))
    expect(await store.claim(org, row.id, 1_000)).toBeUndefined()
    expect(await store.claim(otherOrg, row.id, 1_000)).toBeUndefined()
    expect(await store.inspect(otherOrg, row.id)).toBeUndefined()
    now = new Date(now.getTime() + 1_000)
    const claims = await Promise.all([
      store.claim(org, row.id, 1_000),
      store.claim(org, row.id, 1_000),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect((await store.inspect(org, row.id))?.attempts).toBe(1)
  })

  it('commits one database effect and receipt despite concurrent completion', async () => {
    const row = await claimed()
    const effect = async (tx: Parameters<Parameters<WorkItems['complete']>[3]>[0]) => {
      await tx.execute(sql`INSERT INTO idempotency_receipts (scope, key, payload)
        VALUES (${receipt}, 'counter', '{"count":1}'::jsonb)
        ON CONFLICT (scope, key) DO UPDATE SET payload = jsonb_build_object('count', (idempotency_receipts.payload->>'count')::integer + 1)`)
    }
    const results = await Promise.all([
      store.complete(org, row.id, row.leaseToken, effect),
      store.complete(org, row.id, row.leaseToken, effect),
    ])
    expect(results.sort()).toEqual([false, true])
    const count = await db().execute<{ count: number }>(
      sql`SELECT (payload->>'count')::integer AS count FROM idempotency_receipts WHERE scope = ${receipt}`,
    )
    expect(count.rows[0]?.count).toBe(1)
    expect((await store.inspect(org, row.id))?.state).toBe('succeeded')
  })

  it('rolls a failed effect back and rejects an expired or superseded lease', async () => {
    const row = await claimed()
    await expect(
      store.complete(org, row.id, row.leaseToken, async (tx) => {
        await tx.execute(
          sql`INSERT INTO idempotency_receipts (scope, key) VALUES (${receipt}, 'rollback')`,
        )
        throw new Error('effect failed')
      }),
    ).rejects.toThrow('effect failed')
    const result = await db().execute(
      sql`SELECT 1 FROM idempotency_receipts WHERE scope = ${receipt}`,
    )
    expect(result.rowCount).toBe(0)
    now = new Date(now.getTime() + 1_000)
    const effect = vi.fn()
    expect(await store.complete(org, row.id, row.leaseToken, effect)).toBe(false)
    await store.reserveDispatch()
    const next = await store.claim(org, row.id, 1_000)
    expect(next?.leaseToken).not.toBe(row.leaseToken)
    expect(await store.complete(org, row.id, row.leaseToken, effect)).toBe(false)
    expect(effect).not.toHaveBeenCalled()
  })

  it('quarantines poison work and retains attempt history on an explicit repair', async () => {
    const row = await claimed({ maxAttempts: 1 })
    await store.fail(org, row.id, row.leaseToken)
    expect((await store.inspect(org, row.id))?.state).toBe('quarantined')
    now = new Date(now.getTime() + 60_000)
    expect(await store.reserveDispatch()).toEqual([])
    const retried = await store.operate(
      org,
      row.id,
      'retry',
      'operator',
      'Cause repaired',
    )
    expect(retried).toMatchObject({
      state: 'pending',
      attempts: 1,
      operatorReason: 'Cause repaired',
    })
    expect(
      (
        await store.schedule({
          organizationId: org,
          kind: row.kind,
          idempotencyKey: row.idempotencyKey,
          subjectId: row.subjectId,
          dueAt: now,
          recovery: 'retry',
        })
      ).id,
    ).toBe(row.id)
  })

  it('never blindly resends an uncertain write or permits an operator retry', async () => {
    const row = await claimed({ recovery: 'read_back' })
    now = new Date(now.getTime() + 1_000)
    expect(await store.reserveDispatch()).toEqual([])
    expect((await store.inspect(org, row.id))?.state).toBe('uncertain')
    expect(
      await store.operate(org, row.id, 'retry', 'operator', 'Checked'),
    ).toBeUndefined()
    expect(await store.resolveUncertain(org, row.id, async () => 'unknown')).toBe(false)
    expect(await store.resolveUncertain(org, row.id, async () => 'applied')).toBe(true)
    expect((await store.inspect(org, row.id))?.state).toBe('succeeded')
    expect(await store.reserveDispatch()).toEqual([])
  })

  it('resends only after a definitive read-back says the effect was absent', async () => {
    const row = await claimed({ recovery: 'read_back' })
    await store.fail(org, row.id, row.leaseToken)
    expect(await store.resolveUncertain(org, row.id, async () => 'not_applied')).toBe(
      true,
    )
    expect(await store.reserveDispatch()).toMatchObject([{ id: row.id }])
  })

  it('does not hide a second tenant behind more than a page of due or locked rows', async () => {
    await db()
      .insert(workItems)
      .values(
        Array.from({ length: 120 }, (_, index) => ({
          ...request({ subjectId: String(index), idempotencyKey: String(index) }),
          dispatchAfter: now,
        })),
      )
    const healthy = await store.schedule(request({ organizationId: otherOrg }))
    const firstPass = await store.reserveDispatch()
    expect(firstPass.some((row) => row.id === healthy.id)).toBe(true)
    now = new Date(now.getTime() + 60_000)
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'SELECT id FROM work_items WHERE organization_id = $1 FOR UPDATE',
        [org],
      )
      expect(await store.reserveDispatch()).toMatchObject([{ id: healthy.id }])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('fairly recovers expired leases even behind more than a page of poison work', async () => {
    await db()
      .insert(workItems)
      .values(
        Array.from({ length: 120 }, (_, index) => ({
          ...request({ subjectId: String(index), idempotencyKey: String(index) }),
          dispatchAfter: now,
          state: 'running' as const,
          attempts: 8,
          leaseToken: randomUUID(),
          leaseExpiresAt: now,
        })),
      )
    const healthy = await claimed({ organizationId: org })
    await db()
      .update(workItems)
      .set({ organizationId: otherOrg })
      .where(eq(workItems.id, healthy.id))
    now = new Date(now.getTime() + 1_000)
    expect((await store.reserveDispatch()).some((row) => row.id === healthy.id)).toBe(
      true,
    )
    expect((await store.inspect(otherOrg, healthy.id))?.state).toBe('pending')
  })

  it('keeps active and completed work safe from operator transitions', async () => {
    const row = await claimed()
    expect(await store.operate(org, row.id, 'cancel', 'operator', 'Stop')).toBeUndefined()
    expect(
      await store.operate(otherOrg, row.id, 'discard', 'operator', 'Stop'),
    ).toBeUndefined()
    await store.complete(org, row.id, row.leaseToken, async () => {})
    expect(
      await store.operate(org, row.id, 'retry', 'operator', 'Repeat'),
    ).toBeUndefined()
    expect(
      await store.operate(org, row.id, 'discard', 'operator', 'Discard'),
    ).toBeUndefined()
    expect(
      await db()
        .select()
        .from(workItems)
        .where(and(eq(workItems.id, row.id), eq(workItems.state, 'succeeded'))),
    ).toHaveLength(1)
  })

  it('shows stuck work ahead of retained success receipts', async () => {
    await db()
      .insert(workItems)
      .values(
        Array.from({ length: 120 }, (_, index) => ({
          ...request({ subjectId: String(index), idempotencyKey: String(index) }),
          dispatchAfter: now,
          state: 'succeeded' as const,
          completedAt: now,
        })),
      )
    const stuck = await claimed({ maxAttempts: 1 })
    await store.fail(org, stuck.id, stuck.leaseToken)
    expect((await store.list(org))[0]?.id).toBe(stuck.id)
  })
})
